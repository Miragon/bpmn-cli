/**
 * `retype`: change an element's kind keeping id, name, docs, extension
 * elements, vendor attrs, flows, boundary events, lane membership.
 *
 * CONTRACT (implemented in the "mutation" work package):
 *  - descriptor-driven: create the new type, copy every own property known to
 *    the new type, re-parent moved children, swap in the parent collection at
 *    the same index, re-point EVERY reference in the tree (sourceRef/targetRef,
 *    incoming/outgoing are copied, attachedToRef, flowNodeRef, default,
 *    dataObjectRef, processRef, messageFlows...). Dropped properties ->
 *    W_PROPERTY_DROPPED (contained children with ids are cascade-removed and
 *    reported). Such removed content (e.g. the flow elements of a sub-process
 *    retyped to a task) is also recorded per document (takeDroppedContent):
 *    the write pipeline refuses it with E_WOULD_DROP_CONTENT unless --force,
 *    so an agent never deletes a whole subtree by asking for another kind.
 *  - allowed: task <-> task/subProcess/callActivity (activity family),
 *    gateway <-> gateway (also from an unsupported complexGateway to a
 *    supported gateway), event <-> event of the same position (start/end/
 *    intermediate catch|throw/boundary), plus trigger changes via applyTrigger.
 *    Other combinations -> E_INVALID_RETYPE.
 *  - same kind & trigger -> no-op note; with trigger options the existing
 *    trigger details are merged with the given ones ("trigger options updated").
 *  - a non-interrupting flag the new trigger cannot carry is cleared with
 *    W_PROPERTY_DROPPED; trigger options on a non-event -> W_OPTION_IGNORED.
 *  - message flows touching an event must still fit its new kind/trigger
 *    (E_INVALID_TRIGGER otherwise, the same rule `connect` applies).
 *  - a sub-process that stops being one loses its child diagram (DI), so a
 *    --no-layout write never leaves a BPMNPlane rooted at a task.
 *  - vendor attributes and extension elements are kept as they are (like the
 *    BPMN content, they may still be wanted, and dropping them would lose
 *    data); camunda attributes / extension elements the Camunda descriptor
 *    does not allow on the new kind (camunda:assignee on a serviceTask,
 *    camunda:topic on a userTask, a camunda:taskListener outside a userTask)
 *    are named in one W_PROPERTY_INAPPLICABLE warning with the commands that
 *    remove them; the same for zeebe content by the Zeebe descriptor
 *    (zeebe:assignmentDefinition on a serviceTask, zeebe:taskDefinition on a
 *    userTask). (Not W_PROPERTY_DROPPED: nothing was dropped.) In a Camunda 7
 *    or 8 file the profile names each of them as well (W_C7_MISPLACED_ATTRIBUTE,
 *    W_C7_MISPLACED_EXTENSION, W_C8_MISPLACED_ATTRIBUTE, W_C8_MISPLACED_EXTENSION);
 *    withoutProfileDuplicates() drops the summary then, so
 *    a write reports every item once. Retyped to a userTask in a Camunda 8
 *    file, the task gets zeebe:userTask (ops/platform.ts).
 */
import type { Doc } from '../document.js';
import { modelError, type Warning } from '../errors.js';
import { KindError, kindLabel, kindOf, parseKind, triggerOf, type KindDef, type Trigger } from '../kinds.js';
import { findReferences, is, many, removeFrom, walk, type El } from '../model.js';
import { allowedOn, attrAppliesTo, isC7Uri, ZEEBE_URI } from '../platform/descriptor.js';
import { zeebeAllowedOn, zeebeAttr, zeebeNestedOnly } from '../platform/zeebe.js';
import { subjectOf, type ProfileFinding } from '../platform/finding.js';
import { ChangeSet } from '../result.js';
import { applyTrigger } from './events.js';
import { zeebeUserTaskDefault } from './platform.js';
import { cascadeRemove } from './remove.js';
import {
  assertMessageFlowsFit,
  changeOf,
  currentTrigger,
  descriptorOf,
  idOf,
  interruptingOnly,
  isEl,
  messageFlowConflicts,
  ownValue,
  vendorAttributes,
  warnNonInterruptingDropped,
  type PropDescriptor,
} from './set.js';
import type { RetypeOp, TriggerOptions } from './types.js';

const ACTIVITY_FAMILIES = new Set(['task', 'subProcess', 'callActivity']);

/** Content a retype removed because the new kind cannot hold it. */
export interface DroppedContent {
  /** the retyped element */
  element: string;
  /** its new kind */
  kind: string;
  /** ids of every removed element (children, nested content, their flows) */
  removed: string[];
}

const droppedContent = new WeakMap<Doc, DroppedContent[]>();

/** Returns and forgets the content retypes removed from `doc` since the last call. */
export function takeDroppedContent(doc: Doc): DroppedContent[] {
  const drops = droppedContent.get(doc) ?? [];
  droppedContent.delete(doc);
  return drops;
}

function recordDroppedContent(doc: Doc, drop: DroppedContent): void {
  droppedContent.set(doc, [...(droppedContent.get(doc) ?? []), drop]);
}

const TRIGGER_OPTION_KEYS: Array<keyof TriggerOptions> = [
  'timer',
  'timerKind',
  'message',
  'error',
  'errorCode',
  'signal',
  'escalation',
  'escalationCode',
  'when',
  'link',
  'nonInterrupting',
];

/**
 * The kind an element is retyped from. An unsupported gateway (complexGateway,
 * reported as E_UNSUPPORTED_KIND) counts as a gateway, so the validator's
 * advice to retype it to a supported gateway works.
 */
function sourceKind(el: El): KindDef | undefined {
  const def = kindOf(el);
  if (def || !is(el, 'bpmn:Gateway')) return def;
  const local = el.$type.split(':')[1] ?? el.$type;
  return { kind: local.charAt(0).toLowerCase() + local.slice(1), type: el.$type, family: 'gateway', aliases: [], prefix: 'Gateway', description: '' };
}

function eventPosition(def: KindDef): string {
  return def.kind === 'intermediateCatchEvent' || def.kind === 'intermediateThrowEvent' ? 'intermediate' : def.kind;
}

/** Why `from` cannot become `to`, or undefined when the retype is allowed. */
function incompatibility(from: KindDef, to: KindDef): string | undefined {
  if (ACTIVITY_FAMILIES.has(from.family) && ACTIVITY_FAMILIES.has(to.family)) return undefined;
  if (from.family === 'gateway' && to.family === 'gateway') return undefined;
  if (from.family === 'event' && to.family === 'event') {
    return eventPosition(from) === eventPosition(to) ? undefined : `a ${from.kind} sits at a different position in the flow than a ${to.kind}`;
  }
  return `${from.family} and ${to.family} are different families`;
}

function triggerOptions(op: RetypeOp): TriggerOptions {
  const opts: Record<string, unknown> = {};
  for (const k of TRIGGER_OPTION_KEYS) if (op[k] !== undefined) opts[k] = op[k];
  return opts as TriggerOptions;
}

function resolveTrigger(el: El, to: KindDef, requested: Trigger | undefined): Trigger | undefined {
  if (to.family !== 'event') return undefined;
  if (requested) return requested;
  const current = triggerOf(el) ?? 'none';
  const allowed = to.triggers ?? [];
  if (allowed.includes(current)) return current;
  throw modelError('E_INVALID_TRIGGER', `Trigger "${current}" is not allowed on ${to.kind}; say which trigger the ${to.kind} should have`, {
    element: idOf(el),
    hint: `Use \`bpmn retype ${idOf(el)} ${to.kind}:<trigger>\` with one of: ${allowed.join(', ')}.`,
  });
}

/** Changes the kind of an element (see module contract). */
export function retypeElement(doc: Doc, op: RetypeOp): ChangeSet {
  const cs = new ChangeSet();
  const el = doc.require(op.id);
  const id = idOf(el);
  const from = sourceKind(el);
  if (!from) {
    throw modelError('E_INVALID_RETYPE', `${el.$type} ${id} cannot be retyped`, {
      element: id,
      hint: 'Only tasks, sub-processes, call activities, gateways and events can be retyped.',
    });
  }
  let parsed;
  try {
    parsed = parseKind(op.kind);
  } catch (err) {
    if (err instanceof KindError) throw modelError('E_UNKNOWN_KIND', err.message, { element: id, candidates: err.candidates, hint: 'Run `bpmn kinds` for the list of kinds.' });
    throw err;
  }
  const to = parsed.def;
  const reason = incompatibility(from, to);
  if (reason) {
    throw modelError('E_INVALID_RETYPE', `Cannot retype ${kindLabel(el)} ${id} to ${to.kind}: ${reason}`, {
      element: id,
      hint: 'Remove the element and add a new one of the wanted kind instead (`bpmn remove <id>`, then `bpmn add <kind> ...`).',
    });
  }
  const oldLabel = kindLabel(el);
  const trigger = resolveTrigger(el, to, parsed.trigger);
  const given = triggerOptions(op);
  const givenKeys = Object.keys(given) as Array<keyof TriggerOptions>;
  const isEvent = to.family === 'event';
  if (!isEvent && givenKeys.length) {
    cs.warn({
      code: 'W_OPTION_IGNORED',
      message: `Trigger options (${givenKeys.join(', ')}) are ignored for ${to.kind} ${id}`,
      element: id,
      hint: 'Trigger options apply to events only.',
    });
  }
  const hasTriggerOptions = isEvent && givenKeys.length > 0;
  const oldTrigger = triggerOf(el);
  const sameTrigger = trigger === oldTrigger;
  if (from === to && sameTrigger && !hasTriggerOptions) {
    cs.note(`${id} is already a ${oldLabel}; nothing changed${oldLabel.includes(':') ? ' (to drop the trigger use `<kind>:none` or `bpmn set <file> <id> trigger=none`)' : ''}`);
    return cs;
  }
  if (to.kind === 'eventSubProcess' && (doc.incoming(el).length || doc.outgoing(el).length)) {
    throw modelError('E_INVALID_RETYPE', `${id} has sequence flows; event sub-processes cannot be connected by sequence flows`, {
      element: id,
      candidates: [...doc.incoming(el), ...doc.outgoing(el)].map(idOf),
      hint: `Remove its flows first: \`bpmn remove ${[...doc.incoming(el), ...doc.outgoing(el)].map(idOf).join(' ')}\`.`,
    });
  }

  // read the old trigger state before the swap moves the definitions over
  const existing = isEvent ? currentTrigger(el) : undefined;
  const conflictsBefore = new Set(messageFlowConflicts(doc, el).map((c) => idOf(c.flow)));
  const target = to.type === el.$type ? el : swapType(doc, el, to, cs);
  applyKindProps(target, from, to);
  if (target !== el) {
    const inapplicable = inapplicableCamundaContent(doc, target, to);
    if (inapplicable) cs.warn(inapplicable);
    if (zeebeUserTaskDefault(doc, target)) cs.note(`${id} is a Camunda user task now (zeebe:userTask added, like Camunda Modeler)`);
  }
  let dropNonInterrupting = false;
  if (trigger !== undefined && (!sameTrigger || hasTriggerOptions)) {
    // same trigger: update its details (keep what was not given); new trigger: build from the given options
    const opts: TriggerOptions = sameTrigger ? { ...existing?.opts, ...given } : { ...given };
    if (sameTrigger && given.timer !== undefined && given.timerKind === undefined) delete opts.timerKind;
    if (existing?.opts.nonInterrupting && given.nonInterrupting === undefined && interruptingOnly(target, trigger)) {
      opts.nonInterrupting = false;
      dropNonInterrupting = true;
    }
    for (const w of applyTrigger(doc, target, trigger, opts)) cs.warn(w);
  }
  if (isEvent) assertMessageFlowsFit(doc, target, conflictsBefore);
  if (dropNonInterrupting && trigger !== undefined) warnNonInterruptingDropped(cs, target, trigger);
  doc.invalidate();
  const detail =
    from === to && sameTrigger
      ? `trigger options updated (${givenKeys.map((k) => `${k}=${String(given[k])}`).join(' ')})`
      : `retyped from ${oldLabel} to ${kindLabel(target)}`;
  cs.change(changeOf(target, detail));
  return cs;
}

/** `camunda:<local>` when `name` is prefixed with a prefix bound to the camunda (or Operaton's) namespace. */
function camundaName(doc: Doc, name: string): string | undefined {
  const idx = name.indexOf(':');
  if (idx <= 0 || !isC7Uri(doc.namespaceUri(name.slice(0, idx)))) return undefined;
  return `camunda:${name.slice(idx + 1)}`;
}

/** The local name when `name` is prefixed with a prefix bound to the zeebe namespace. */
function zeebeLocal(doc: Doc, name: string): string | undefined {
  const idx = name.indexOf(':');
  if (idx <= 0 || doc.namespaceUri(name.slice(0, idx)) !== ZEEBE_URI) return undefined;
  return name.slice(idx + 1);
}

/**
 * W_PROPERTY_INAPPLICABLE naming the camunda / zeebe attributes and extension
 * elements the new kind cannot use (they stay), by the Camunda 7 and the
 * Camunda 8 (zeebe) descriptor.
 */
function inapplicableCamundaContent(doc: Doc, el: El, to: KindDef): Warning | undefined {
  const attrs = Object.keys(vendorAttributes(el)).filter((key) => {
    const name = camundaName(doc, key);
    if (name) return attrAppliesTo(name, el) === false;
    const z = zeebeLocal(doc, key);
    const def = z ? zeebeAttr(z) : undefined;
    return !!def && !def.owners.some((o) => is(el, o));
  });
  const exts: string[] = [];
  for (const ext of el.get<El | undefined>('extensionElements')?.get<El[] | undefined>('values') ?? []) {
    const name = camundaName(doc, ext.$type);
    const z = name ? undefined : zeebeLocal(doc, ext.$type);
    const misplaced = name ? allowedOn(name, el) === false : z ? zeebeAllowedOn(z, el) === false && !zeebeNestedOnly(z) : false;
    if (misplaced && !exts.includes(ext.$type)) exts.push(ext.$type);
  }
  const names = [...attrs, ...exts];
  if (!names.length) return undefined;
  const id = idOf(el);
  const fixes = [
    ...(attrs.length ? [`\`bpmn set <file> ${id} ${attrs.map((a) => `${a}=`).join(' ')}\``] : []),
    ...exts.map((t) => `\`bpmn ext remove <file> ${id} ${t}\``),
  ];
  const warning: Warning = {
    code: 'W_PROPERTY_INAPPLICABLE',
    message: `${names.join(', ')} of ${id} ${names.length > 1 ? 'have' : 'has'} no effect on a ${to.kind} (kept as ${names.length > 1 ? 'they are' : 'it is'})`,
    element: id,
    hint: `The ${names.every((n) => zeebeLocal(doc, n)) ? 'Zeebe (Camunda 8)' : names.some((n) => zeebeLocal(doc, n)) ? 'Camunda 7 and Zeebe' : 'Camunda'} descriptor does not allow ${names.length > 1 ? 'them' : 'it'} on a ${to.kind}; remove with ${fixes.join(' and ')}, or retype back.`,
  };
  // what the Camunda 7 profile reports item by item (subjects of its misplaced-content findings), see withoutProfileDuplicates
  Object.defineProperty(warning, COVERS, { value: [...attrs.map((a) => `attr:${a}`), ...exts.map((t) => `ext:${t.slice(t.indexOf(':') + 1)}`)], enumerable: false });
  return warning;
}

/** The profile findings that name one misplaced camunda / zeebe attribute or extension element each. */
const MISPLACED = ['W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_EXTENSION', 'W_C8_MISPLACED_ATTRIBUTE', 'W_C8_MISPLACED_EXTENSION'];

/** Hidden list of profile subjects an operation warning repeats (not serialised). */
const COVERS: unique symbol = Symbol('covered-profile-subjects');

/** Marks an operation warning as repeating the given misplaced-content profile subjects (`ext:<local>`, `attr:<name>`): dropped when the profile reports them all. */
export function coversProfileSubjects<W extends Warning>(warning: W, subjects: string[]): W {
  Object.defineProperty(warning, COVERS, { value: subjects, enumerable: false });
  return warning;
}

/**
 * The warnings of a mutation without the ones its platform-profile findings
 * already report: after a retype in a Camunda 7 file the profile names every
 * camunda attribute / extension element the new kind cannot use
 * (W_C7_MISPLACED_ATTRIBUTE / W_C7_MISPLACED_EXTENSION, with severity and a
 * remove command each), so the summary W_PROPERTY_INAPPLICABLE is dropped
 * when those findings cover everything it names. Without the profile
 * (`--platform none`, a file that is not Camunda 7) it stays. For the
 * pipeline / printMutation: `changes.warnings = withoutProfileDuplicates(changes.warnings, validation.warnings)`.
 */
export function withoutProfileDuplicates(warnings: Warning[], validation: readonly Warning[]): Warning[] {
  return warnings.filter((w) => {
    const covers = (w as Warning & { [COVERS]?: string[] })[COVERS];
    if (!covers?.length) return true;
    const reported = new Set(validation.filter((v) => v.element === w.element && MISPLACED.includes(v.code)).map((v) => subjectOf(v as ProfileFinding)));
    return !covers.every((s) => reported.has(s));
  });
}

/** Applies / clears the kind-specific creation props (e.g. triggeredByEvent for event sub-processes). */
function applyKindProps(el: El, from: KindDef, to: KindDef): void {
  for (const k of Object.keys(from.props ?? {})) if (!(to.props && k in to.props) && descriptorOf(el).propertiesByName?.[k]) el.set(k, undefined);
  for (const [k, v] of Object.entries(to.props ?? {})) el.set(k, v);
}

/* ------------------------------------------------------------------ */
/* type swap                                                            */
/* ------------------------------------------------------------------ */

function copyProp(next: El, p: PropDescriptor, value: unknown): void {
  if (p.isMany && Array.isArray(value)) {
    const list = many(next, p.name);
    for (const child of value) {
      list.push(child as El);
      if (!p.isReference && isEl(child)) child.$parent = next;
    }
    return;
  }
  next.set(p.name, value);
  if (!p.isReference && isEl(value)) value.$parent = next;
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} element(s)`;
  if (isEl(value)) return idOf(value) || value.$type;
  return String(value);
}

function dropProp(doc: Doc, el: El, p: PropDescriptor, value: unknown, to: KindDef, cs: ChangeSet): void {
  const detail = describeValue(value);
  if (!p.isReference) {
    const children = (Array.isArray(value) ? value : [value]).filter((c): c is El => isEl(c) && !!c.get<string | undefined>('id'));
    const before = cs.removed.length;
    for (const child of children) cascadeRemove(doc, child, cs);
    const removed = cs.removed.slice(before).map((c) => c.id);
    if (removed.length) recordDroppedContent(doc, { element: idOf(el), kind: to.kind, removed });
  }
  cs.warn({
    code: 'W_PROPERTY_DROPPED',
    message: `${p.name} of ${idOf(el)} (${detail}) was dropped: a ${to.kind} has no ${p.name}`,
    element: idOf(el),
    ...(p.name === 'default' ? { hint: 'The flow still exists but is no longer marked as default.' } : {}),
  });
}

function dropDiagram(doc: Doc, diagram: El | undefined): void {
  if (!diagram || !is(diagram, 'bpmndi:BPMNDiagram')) return;
  removeFrom(doc.definitions, 'diagrams', diagram);
  for (const e of walk(diagram)) {
    const id = e.get<string | undefined>('id');
    if (id) doc.ids.release(id);
  }
}

function replaceInParent(parent: El, el: El, next: El): void {
  for (const p of descriptorOf(parent).properties ?? []) {
    if (p.isReference) continue;
    const v = ownValue(parent, p.name);
    if (Array.isArray(v)) {
      const i = v.indexOf(el);
      if (i !== -1) {
        v[i] = next;
        next.$parent = parent;
        return;
      }
    } else if (v === el) {
      parent.set(p.name, next);
      next.$parent = parent;
      return;
    }
  }
}

/** Creates the new element, moves every compatible property over and re-points all references. */
function swapType(doc: Doc, el: El, to: KindDef, cs: ChangeSet): El {
  const next = doc.moddle.create(to.type, { id: idOf(el) });
  const nextProps = descriptorOf(next).propertiesByName ?? {};
  for (const p of descriptorOf(el).properties ?? []) {
    if (p.name === 'id') continue;
    const value = ownValue(el, p.name);
    if (value === undefined || value === null || (Array.isArray(value) && !value.length)) continue;
    if (p.name === 'triggeredByEvent') continue; // kind prop, re-applied by applyKindProps
    if (nextProps[p.name]) copyProp(next, p, value);
    else dropProp(doc, el, p, value, to, cs);
  }
  Object.assign(next.$attrs, el.$attrs);
  const parent = el.$parent as El | undefined;
  if (parent) replaceInParent(parent, el, next);
  for (const ref of findReferences(doc.definitions, el)) {
    if (is(ref.holder, 'bpmndi:BPMNPlane') && !is(next, 'bpmn:SubProcess')) {
      // the child diagram of a (collapsed) sub-process: only processes, sub-processes and
      // collaborations may root a plane, so it must go instead of being re-pointed
      dropDiagram(doc, ref.holder.$parent as El | undefined);
      continue;
    }
    if (ref.isMany) {
      const list = many(ref.holder, ref.prop);
      const i = list.indexOf(el);
      if (i !== -1) list[i] = next;
    } else {
      ref.holder.set(ref.prop, next);
    }
  }
  doc.invalidate();
  return next;
}
