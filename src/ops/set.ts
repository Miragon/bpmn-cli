/**
 * `set`: key=value properties. Keys are what `show <id>` prints.
 *
 * CONTRACT (implemented in the "mutation" work package):
 *  Generic keys (any element): id (rename incl. every reference and
 *    calledElement strings), name, documentation|doc, any attribute-typed
 *    moddle property of the element's type by its property name (validated via
 *    descriptors, enums checked; e.g. isExecutable, isForCompensation,
 *    completionQuantity, processType, script, scriptFormat, implementation,
 *    calledElement, instantiate, gatewayDirection...), vendor attributes with
 *    a prefix (`camunda:assignee`, `zeebe:formKey`; the xmlns is declared
 *    automatically for known prefixes, E_UNKNOWN_NAMESPACE otherwise).
 *  Flows: condition, language, default (true|false), source, target (redirect).
 *    default=true removes the flow's condition (W_CONDITION_DROPPED) and
 *    reports a previous default flow losing the marker; default=true together
 *    with a condition is rejected (E_INVALID_VALUE).
 *  Events: trigger (kind suffix, e.g. `message`), timer, message, error,
 *    errorCode, signal, escalation, escalationCode, when, link,
 *    nonInterrupting (true|false)  -> via events.ts. nonInterrupting=true is
 *    refused for triggers that always interrupt (error/cancel/compensate,
 *    untyped start events, starts outside an event sub-process); a trigger
 *    change to such a trigger clears an existing flag with W_PROPERTY_DROPPED.
 *    Details of the current trigger are changed in place (the event
 *    definition keeps its id and vendor content; a new timer value is
 *    classified again); a trigger kind change reports dropped vendor content
 *    of the old definition (W_PROPERTY_DROPPED, see events.ts).
 *    A trigger change that would leave a message flow at an event that can no
 *    longer send/receive it is refused (E_INVALID_TRIGGER), like `connect` would.
 *  Activities: loop (none|standard|parallel|sequential), cardinality,
 *    completion (completionCondition).
 *  Sub-processes: expanded (true|false) -> recorded in `expansionRequests`
 *    (the pipeline merges it into the layouter options); triggeredByEvent.
 *  Flow nodes: lane (lane id or empty to remove).
 *  Text annotations: text.
 *  `key=` (empty value) and --unset remove the property.
 *  Unknown keys -> E_UNKNOWN_KEY listing the settable keys for that element.
 *  Export SET_KEYS: per family, the documented keys with a one-line description
 *  (used by `bpmn kinds`).
 *
 * This module also hosts the small helpers every mutation shares
 * (`changeOf`, `descriptorOf`, `ownValue`, `idOf`).
 */
import type { Doc } from '../document.js';
import { modelError, usageError } from '../errors.js';
import { kindLabel, kindOf, normalizeTrigger, triggerOf, type Trigger } from '../kinds.js';
import { diExpansionState } from '../layout.js';
import { addTo, is, many, walk, type El } from '../model.js';
import { ChangeSet, type Change } from '../result.js';
import { assignLane } from './containers.js';
import { applyTrigger } from './events.js';
import { flowChange, redirectFlow, setDefaultFlow, setFlowCondition } from './flows.js';
import type { SetOp, TriggerOptions } from './types.js';

/* ------------------------------------------------------------------ */
/* shared helpers                                                       */
/* ------------------------------------------------------------------ */

/** A moddle property descriptor (the subset the mutations rely on). */
export interface PropDescriptor {
  name: string;
  type: string;
  isAttr?: boolean;
  isReference?: boolean;
  isMany?: boolean;
  isBody?: boolean;
  default?: unknown;
}

export interface TypeDescriptor {
  isGeneric?: boolean;
  properties?: PropDescriptor[];
  propertiesByName?: Record<string, PropDescriptor>;
}

/** Typed access to an element's moddle descriptor. */
export function descriptorOf(el: El): TypeDescriptor {
  return el.$descriptor as unknown as TypeDescriptor;
}

/** Reads an own property without triggering moddle's lazy collection creation. */
export function ownValue(el: El, prop: string): unknown {
  return Object.prototype.hasOwnProperty.call(el, prop) ? (el as unknown as Record<string, unknown>)[prop] : undefined;
}

export function idOf(el: El): string {
  return el.get<string | undefined>('id') ?? '';
}

/** True for moddle elements (typed or generic). */
export function isEl(v: unknown): v is El {
  return !!v && typeof v === 'object' && typeof (v as El).$type === 'string';
}

/** Canonical kind label for change-set entries (kinds table first, then lowerCamel type). */
export function changeKind(el: El): string {
  if (kindOf(el)) return kindLabel(el);
  if (is(el, 'bpmn:SequenceFlow')) return 'sequenceFlow';
  if (is(el, 'bpmn:MessageFlow')) return 'messageFlow';
  if (is(el, 'bpmn:DataAssociation')) return 'dataAssociation';
  if (is(el, 'bpmn:Association')) return 'association';
  const local = el.$type.split(':')[1] ?? el.$type;
  return local.charAt(0).toLowerCase() + local.slice(1);
}

/** ChangeSet entry for an element. */
export function changeOf(el: El, detail?: string): Change {
  const name = el.get<string | undefined>('name');
  return { id: idOf(el), kind: changeKind(el), ...(name ? { name } : {}), ...(detail ? { detail } : {}) };
}

/* ------------------------------------------------------------------ */
/* expansion requests (sub-process expanded/collapsed)                  */
/* ------------------------------------------------------------------ */

/** Sub-process expansion requested via `set <id> expanded=...`, per document. */
export const expansionRequests = new WeakMap<Doc, Map<string, boolean>>();

/** Records that a sub-process should be laid out expanded (true) or collapsed (false). */
export function requestExpansion(doc: Doc, id: string, expanded: boolean): void {
  let map = expansionRequests.get(doc);
  if (!map) {
    map = new Map();
    expansionRequests.set(doc, map);
  }
  map.set(id, expanded);
}

/** The expansion requests recorded for a document, as layouter options. */
export function requestedExpansion(doc: Doc): { expand: string[]; collapse: string[] } {
  const expand: string[] = [];
  const collapse: string[] = [];
  for (const [id, expanded] of expansionRequests.get(doc) ?? []) (expanded ? expand : collapse).push(id);
  return { expand, collapse };
}

/* ------------------------------------------------------------------ */
/* key documentation                                                    */
/* ------------------------------------------------------------------ */

export interface SetKeyDoc {
  key: string;
  appliesTo: string;
  description: string;
}

const APPLIES_TO: Record<string, (el: El) => boolean> = {
  any: () => true,
  sequenceFlow: (el) => is(el, 'bpmn:SequenceFlow'),
  flowNode: (el) => is(el, 'bpmn:FlowNode'),
  event: (el) => is(el, 'bpmn:Event'),
  activity: (el) => is(el, 'bpmn:Activity'),
  subProcess: (el) => is(el, 'bpmn:SubProcess'),
  textAnnotation: (el) => is(el, 'bpmn:TextAnnotation'),
};

export const SET_KEYS: SetKeyDoc[] = [
  { key: 'id', appliesTo: 'any', description: 'Rename the element; every reference (flows, lanes, boundary hosts, calledElement) follows' },
  { key: 'name', appliesTo: 'any', description: 'Display name (empty value removes it)' },
  { key: 'doc', appliesTo: 'any', description: 'Documentation text (alias: documentation; empty removes it)' },
  { key: '<prefix>:<attr>', appliesTo: 'any', description: 'Vendor attribute, e.g. camunda:assignee=alice or zeebe:modelerTemplate=x (xmlns declared automatically for known prefixes)' },
  { key: '<property>', appliesTo: 'any', description: 'Any attribute of the BPMN type by property name, e.g. isExecutable, calledElement, scriptFormat, script, implementation, isForCompensation, completionQuantity, gatewayDirection, instantiate' },
  { key: 'condition', appliesTo: 'sequenceFlow', description: 'Condition expression (empty removes it; clears the default marker of the flow)' },
  { key: 'language', appliesTo: 'sequenceFlow', description: 'Expression language of the condition' },
  { key: 'default', appliesTo: 'sequenceFlow', description: 'true|false: make this flow the default flow of its source gateway/activity (removes its condition; a previous default flow loses the marker)' },
  { key: 'default', appliesTo: 'flowNode', description: 'Id of the default outgoing flow of a gateway/activity (empty clears it)' },
  { key: 'source', appliesTo: 'sequenceFlow', description: 'Redirect the flow: new source node id' },
  { key: 'target', appliesTo: 'sequenceFlow', description: 'Redirect the flow: new target node id' },
  { key: 'trigger', appliesTo: 'event', description: 'Event trigger: none|message|timer|error|signal|escalation|conditional|link|compensate|terminate|cancel' },
  { key: 'timer', appliesTo: 'event', description: 'ISO 8601 timer: R/PT1H (cycle), PT5M (duration) or a date; implies trigger=timer' },
  { key: 'message', appliesTo: 'event', description: 'Message name (a root bpmn:Message is created when missing); implies trigger=message' },
  { key: 'error', appliesTo: 'event', description: 'Error name (root bpmn:Error created when missing); implies trigger=error' },
  { key: 'errorCode', appliesTo: 'event', description: 'errorCode of the referenced bpmn:Error' },
  { key: 'signal', appliesTo: 'event', description: 'Signal name; implies trigger=signal' },
  { key: 'escalation', appliesTo: 'event', description: 'Escalation name; implies trigger=escalation' },
  { key: 'escalationCode', appliesTo: 'event', description: 'escalationCode of the referenced bpmn:Escalation' },
  { key: 'when', appliesTo: 'event', description: 'Condition expression of a conditional event; implies trigger=conditional' },
  { key: 'link', appliesTo: 'event', description: 'Link name of a link event; implies trigger=link' },
  { key: 'nonInterrupting', appliesTo: 'event', description: 'true|false: boundary events (cancelActivity) and event sub-process start events (isInterrupting); never for error/cancel/compensate triggers or untyped start events' },
  { key: 'loop', appliesTo: 'activity', description: 'none|standard|parallel|sequential (parallel/sequential = multi-instance)' },
  { key: 'cardinality', appliesTo: 'activity', description: 'Multi-instance loop cardinality expression (creates a parallel multi-instance loop when none exists)' },
  { key: 'completion', appliesTo: 'activity', description: 'Multi-instance completion condition expression' },
  { key: 'expanded', appliesTo: 'subProcess', description: 'true|false: draw the sub-process expanded (default) or collapsed' },
  { key: 'triggeredByEvent', appliesTo: 'subProcess', description: 'true|false: event sub-process' },
  { key: 'lane', appliesTo: 'flowNode', description: 'Lane id the node belongs to (empty removes lane membership)' },
  { key: 'text', appliesTo: 'textAnnotation', description: 'Annotation text' },
];

const EVENT_KEYS = new Set(['trigger', 'timer', 'message', 'error', 'errorCode', 'signal', 'escalation', 'escalationCode', 'when', 'link', 'nonInterrupting']);

const TRIGGER_OF_KEY: Record<string, Trigger> = {
  timer: 'timer',
  message: 'message',
  error: 'error',
  errorCode: 'error',
  signal: 'signal',
  escalation: 'escalation',
  escalationCode: 'escalation',
  when: 'conditional',
  link: 'link',
};

/** Properties that must not be set generically (they have a dedicated command / key). */
const BLOCKED_PROPS: Record<string, string> = {
  attachedToRef: 'use `bpmn move <id> --on <activityId>`',
  sourceRef: 'use source=<nodeId>',
  targetRef: 'use target=<nodeId>',
  processRef: 'a participant is bound to its process on creation',
  bpmnElement: 'diagram interchange is generated automatically',
};

const PRIMITIVE_TYPES = new Set(['String', 'Boolean', 'Integer', 'Real']);

/* ------------------------------------------------------------------ */
/* descriptor helpers                                                   */
/* ------------------------------------------------------------------ */

function enumLiterals(doc: Doc, type: string): string[] | undefined {
  const [prefix, local] = type.split(':');
  if (!prefix || !local) return undefined;
  let pkg: { enumerations?: Array<{ name: string; literalValues?: Array<{ name: string }> }> } | undefined;
  try {
    pkg = doc.moddle.getPackage(prefix) as typeof pkg;
  } catch {
    return undefined;
  }
  const found = pkg?.enumerations?.find((e) => e.name === local);
  return found?.literalValues?.map((l) => l.name);
}

/** True when a descriptor property can be set from a string (primitive, enum or id-referencing attribute). */
function isSettableProp(doc: Doc, p: PropDescriptor): boolean {
  if (p.isMany || BLOCKED_PROPS[p.name]) return false;
  if (p.isReference) return !!p.isAttr;
  return PRIMITIVE_TYPES.has(p.type) || !!enumLiterals(doc, p.type);
}

function genericKeys(doc: Doc, el: El): string[] {
  return (descriptorOf(el).properties ?? []).filter((p) => p.name !== 'id' && isSettableProp(doc, p)).map((p) => p.name);
}

/** Every key `set` accepts for this element (documented keys + type attributes). */
export function settableKeys(doc: Doc, el: El): string[] {
  const keys = new Set<string>();
  for (const k of SET_KEYS) {
    if (k.key.startsWith('<')) continue;
    if (APPLIES_TO[k.appliesTo]?.(el)) keys.add(k.key);
  }
  for (const k of genericKeys(doc, el)) keys.add(k);
  keys.add('<prefix>:<attr>');
  return [...keys];
}

/* ------------------------------------------------------------------ */
/* value parsing                                                        */
/* ------------------------------------------------------------------ */

function invalidValue(el: El, key: string, message: string, hint?: string) {
  return modelError('E_INVALID_VALUE', `Invalid value for ${key} on ${idOf(el)}: ${message}`, { element: idOf(el), ...(hint ? { hint } : {}) });
}

function parseBool(el: El, key: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(v)) return true;
  if (['false', 'no', '0', 'off'].includes(v)) return false;
  throw invalidValue(el, key, `"${value}" is not a boolean`, `Use ${key}=true or ${key}=false.`);
}

function coerceValue(doc: Doc, el: El, p: PropDescriptor, value: string): unknown {
  if (p.isReference) return doc.require(value, p.type, p.name);
  switch (p.type) {
    case 'String':
      return value;
    case 'Boolean':
      return parseBool(el, p.name, value);
    case 'Integer': {
      if (!/^-?\d+$/.test(value.trim())) throw invalidValue(el, p.name, `"${value}" is not an integer`);
      return Number(value);
    }
    case 'Real': {
      const n = Number(value);
      if (!value.trim() || Number.isNaN(n)) throw invalidValue(el, p.name, `"${value}" is not a number`);
      return n;
    }
    default: {
      const literals = enumLiterals(doc, p.type) ?? [];
      const hit = literals.find((l) => l.toLowerCase() === value.trim().toLowerCase());
      if (!hit) throw invalidValue(el, p.name, `"${value}" is not one of ${literals.join('|')}`);
      return hit;
    }
  }
}

function unknownKey(doc: Doc, el: El, key: string, reason?: string) {
  const keys = settableKeys(doc, el);
  return modelError('E_UNKNOWN_KEY', `Unknown key "${key}" for ${kindLabel(el)} ${idOf(el)}${reason ? ` (${reason})` : ''}`, {
    element: idOf(el),
    candidates: keys,
    hint: `Settable keys for this element: ${keys.join(', ')}.`,
  });
}

function normalizeKey(key: string): string {
  const k = key.trim();
  if (k === 'documentation') return 'doc';
  if (k.toLowerCase().startsWith('bpmn:')) return k.slice(5);
  return k;
}

function expression(doc: Doc, body: string, parent: El, language?: string): El {
  const expr = doc.moddle.create('bpmn:FormalExpression', { body, ...(language ? { language } : {}) });
  expr.$parent = parent;
  return expr;
}

/* ------------------------------------------------------------------ */
/* entry point                                                          */
/* ------------------------------------------------------------------ */

/** Applies `op.values` (key=value) and `op.unset` (key=) to one element. */
export function setProperties(doc: Doc, op: SetOp): ChangeSet {
  const cs = new ChangeSet();
  const el = doc.require(op.id);
  const entries: Array<[string, string]> = [
    ...Object.entries(op.values ?? {}).map(([k, v]) => [normalizeKey(k), v === undefined || v === null ? '' : String(v)] as [string, string]),
    ...(op.unset ?? []).map((k) => [normalizeKey(k), ''] as [string, string]),
  ];
  if (!entries.length) {
    throw usageError('Nothing to set: pass key=value pairs (or --unset <key>)', { element: op.id, hint: `Settable keys: ${settableKeys(doc, el).join(', ')}` });
  }
  const eventKeys = new Map<string, string>();
  const conditionKeys = new Map<string, string>();
  if (is(el, 'bpmn:SequenceFlow')) {
    const wantsDefault = entries.some(([k, v]) => k === 'default' && v && parseBool(el, k, v));
    const wantsCondition = entries.some(([k, v]) => k === 'condition' && v);
    if (wantsDefault && wantsCondition) {
      throw invalidValue(el, 'default', 'default=true and condition cannot be combined: a default flow has no condition', 'Set one of them, or condition= (empty) together with default=true.');
    }
  }
  for (const [key, value] of entries) {
    if (EVENT_KEYS.has(key) && is(el, 'bpmn:Event')) {
      eventKeys.set(key, value);
      continue;
    }
    if ((key === 'condition' || key === 'language') && is(el, 'bpmn:SequenceFlow')) {
      conditionKeys.set(key, value);
      continue;
    }
    applyKey(doc, el, key, value, cs);
  }
  if (conditionKeys.size) applyCondition(doc, el, conditionKeys, cs);
  if (eventKeys.size) applyEventKeys(doc, el, eventKeys, cs);
  doc.invalidate();
  return cs;
}

function applyKey(doc: Doc, el: El, key: string, value: string, cs: ChangeSet): void {
  const detail = value ? `${key}=${value}` : `${key} removed`;
  switch (key) {
    case 'id': {
      if (!value) throw invalidValue(el, key, 'an id cannot be empty');
      const old = idOf(el);
      renameId(doc, el, value);
      cs.change(changeOf(el, `renamed from ${old}`));
      return;
    }
    case 'name':
      el.set('name', value || undefined);
      break;
    case 'doc':
      setDocumentation(doc, el, value);
      break;
    case 'default':
      setDefaultKey(doc, el, value, cs);
      break;
    case 'source':
    case 'target': {
      if (!is(el, 'bpmn:SequenceFlow')) throw unknownKey(doc, el, key, 'applies to sequence flows');
      if (!value) throw invalidValue(el, key, 'a flow always needs a source and a target');
      const node = doc.require(value, 'bpmn:FlowNode');
      redirectFlow(doc, el, key === 'source' ? { source: node } : { target: node });
      cs.change({ ...flowChange(el), detail: `${flowChange(el).detail} (${key} changed)` });
      return;
    }
    case 'loop':
    case 'cardinality':
    case 'completion':
      if (!is(el, 'bpmn:Activity')) throw unknownKey(doc, el, key, 'applies to activities');
      setLoopKey(doc, el, key, value, cs);
      break;
    case 'expanded': {
      if (!is(el, 'bpmn:SubProcess')) throw unknownKey(doc, el, key, 'applies to sub-processes');
      requestExpansion(doc, idOf(el), value ? parseBool(el, key, value) : true);
      break;
    }
    case 'lane': {
      if (!is(el, 'bpmn:FlowNode')) throw unknownKey(doc, el, key, 'applies to flow nodes');
      assignLane(doc, el, value ? doc.require(value, 'bpmn:Lane', 'lane') : undefined, cs);
      break;
    }
    default:
      if (key.includes(':')) setVendorAttribute(doc, el, key, value);
      else setModelProperty(doc, el, key, value);
  }
  cs.change(changeOf(el, detail));
}

/* ------------------------------------------------------------------ */
/* individual keys                                                      */
/* ------------------------------------------------------------------ */

function setDocumentation(doc: Doc, el: El, value: string): void {
  const docs = many(el, 'documentation');
  if (!value) {
    docs.splice(0, docs.length);
    return;
  }
  const first = docs[0];
  if (first) first.set('text', value);
  else addTo(el, 'documentation', doc.moddle.create('bpmn:Documentation', { text: value }));
}

/**
 * Makes `flow` the default flow of its source, reporting what that implies:
 * the flow's own condition is removed (W_CONDITION_DROPPED) and a previous
 * default flow of the source loses its marker (reported as a change).
 */
function makeDefaultFlow(doc: Doc, flow: El, cs: ChangeSet): void {
  const source = flow.get<El>('sourceRef');
  const previous = source.get<El | undefined>('default');
  const condition = flow.get<El | undefined>('conditionExpression')?.get<string | undefined>('body');
  setDefaultFlow(doc, flow, true);
  if (condition) {
    cs.warn({
      code: 'W_CONDITION_DROPPED',
      message: `Condition "${condition}" of ${idOf(flow)} was removed: a default flow has no condition`,
      element: idOf(flow),
      hint: 'Default flows are taken when no other condition matches; set the condition on another outgoing flow if it is still needed.',
    });
  }
  if (previous && previous !== flow) cs.change(changeOf(previous, `no longer the default flow of ${idOf(source)}`));
}

function setDefaultKey(doc: Doc, el: El, value: string, cs: ChangeSet): void {
  if (is(el, 'bpmn:SequenceFlow')) {
    if (value && parseBool(el, 'default', value)) makeDefaultFlow(doc, el, cs);
    else setDefaultFlow(doc, el, false);
    return;
  }
  if (!descriptorOf(el).propertiesByName?.['default']) {
    throw unknownKey(doc, el, 'default', 'only exclusive/inclusive gateways, activities and sequence flows have a default');
  }
  if (!value) {
    el.set('default', undefined);
    return;
  }
  const flow = doc.require(value, 'bpmn:SequenceFlow', 'sequence flow');
  if (flow.get<El | undefined>('sourceRef') !== el) {
    throw modelError('E_NOT_OUTGOING', `${value} is not an outgoing flow of ${idOf(el)}`, {
      element: idOf(el),
      related: [value],
      candidates: doc.outgoing(el).map(idOf),
      hint: `Outgoing flows of ${idOf(el)}: ${doc.outgoing(el).map(idOf).join(', ') || 'none'}.`,
    });
  }
  makeDefaultFlow(doc, flow, cs);
}

function setLoopKey(doc: Doc, el: El, key: string, value: string, cs: ChangeSet): void {
  const current = el.get<El | undefined>('loopCharacteristics');
  const isMulti = is(current, 'bpmn:MultiInstanceLoopCharacteristics');
  if (key === 'loop') {
    const mode = (value || 'none').trim().toLowerCase();
    if (mode === 'none') {
      el.set('loopCharacteristics', undefined);
    } else if (mode === 'standard') {
      if (!is(current, 'bpmn:StandardLoopCharacteristics')) {
        const loop = doc.moddle.create('bpmn:StandardLoopCharacteristics');
        loop.$parent = el;
        el.set('loopCharacteristics', loop);
      }
    } else if (mode === 'parallel' || mode === 'sequential') {
      const multi = isMulti ? current! : createMultiInstance(doc, el);
      multi.set('isSequential', mode === 'sequential');
    } else {
      throw invalidValue(el, key, `"${value}" is not one of none|standard|parallel|sequential`);
    }
    return;
  }
  const prop = key === 'cardinality' ? 'loopCardinality' : 'completionCondition';
  if (!value) {
    if (isMulti) current!.set(prop, undefined);
    return;
  }
  if (current && !isMulti) {
    throw invalidValue(el, key, `${key} needs a multi-instance loop, but ${idOf(el)} has a standard loop`, 'Set loop=parallel or loop=sequential first.');
  }
  let multi = current;
  if (!multi) {
    multi = createMultiInstance(doc, el);
    cs.note(`${idOf(el)}: created a parallel multi-instance loop for ${key}`);
  }
  multi.set(prop, expression(doc, value, multi));
}

function createMultiInstance(doc: Doc, el: El): El {
  const multi = doc.moddle.create('bpmn:MultiInstanceLoopCharacteristics');
  multi.$parent = el;
  el.set('loopCharacteristics', multi);
  return multi;
}

function setVendorAttribute(doc: Doc, el: El, key: string, value: string): void {
  const idx = key.indexOf(':');
  const prefix = key.slice(0, idx);
  const local = key.slice(idx + 1);
  if (!prefix || !local || prefix === 'xmlns') throw unknownKey(doc, el, key, 'vendor attributes look like prefix:name');
  if (!value) {
    delete el.$attrs[key];
    return;
  }
  doc.declareNamespace(prefix);
  el.$attrs[key] = value;
}

function setModelProperty(doc: Doc, el: El, key: string, value: string): void {
  const p = descriptorOf(el).propertiesByName?.[key];
  if (!p || key === 'id') throw unknownKey(doc, el, key);
  const blocked = BLOCKED_PROPS[key];
  if (blocked) throw unknownKey(doc, el, key, blocked);
  if (!isSettableProp(doc, p)) throw unknownKey(doc, el, key, `${key} is not an attribute`);
  if (!value) {
    el.set(key, undefined);
    return;
  }
  el.set(key, coerceValue(doc, el, p, value));
}

function applyCondition(doc: Doc, flow: El, keys: Map<string, string>, cs: ChangeSet): void {
  const existing = flow.get<El | undefined>('conditionExpression');
  const condition = keys.has('condition') ? keys.get('condition') : existing?.get<string | undefined>('body');
  const language = keys.has('language') ? keys.get('language') || undefined : existing?.get<string | undefined>('language');
  if (!condition) {
    if (language && keys.has('language')) {
      throw modelError('E_NO_CONDITION', `${idOf(flow)} has no condition to set a language on`, { element: idOf(flow), hint: 'Set condition=<expression> too.' });
    }
    setFlowCondition(doc, flow, undefined);
    cs.change(changeOf(flow, 'condition removed'));
    return;
  }
  setFlowCondition(doc, flow, condition, language);
  cs.change(changeOf(flow, `condition=${condition}${language ? ` (${language})` : ''}`));
}

/* ------------------------------------------------------------------ */
/* events                                                               */
/* ------------------------------------------------------------------ */

/** The trigger of an event plus its details, as `set`/`add` options (read from the model). */
export function currentTrigger(el: El): { trigger: Trigger; opts: TriggerOptions } {
  const trigger = triggerOf(el) ?? 'none';
  const opts: TriggerOptions = {};
  const def = (el.get<El[] | undefined>('eventDefinitions') ?? [])[0];
  const body = (p: string): string | undefined => def?.get<El | undefined>(p)?.get<string | undefined>('body');
  const ref = (p: string): El | undefined => def?.get<El | undefined>(p);
  const named = (p: string): string | undefined => ref(p)?.get<string | undefined>('name') ?? ref(p)?.get<string | undefined>('id');
  if (def) {
    switch (trigger) {
      case 'timer': {
        const cycle = body('timeCycle');
        const duration = body('timeDuration');
        const date = body('timeDate');
        if (cycle) Object.assign(opts, { timer: cycle, timerKind: 'cycle' });
        else if (duration) Object.assign(opts, { timer: duration, timerKind: 'duration' });
        else if (date) Object.assign(opts, { timer: date, timerKind: 'date' });
        break;
      }
      case 'message':
        opts.message = named('messageRef');
        break;
      case 'error':
        opts.error = named('errorRef');
        opts.errorCode = ref('errorRef')?.get<string | undefined>('errorCode');
        break;
      case 'signal':
        opts.signal = named('signalRef');
        break;
      case 'escalation':
        opts.escalation = named('escalationRef');
        opts.escalationCode = ref('escalationRef')?.get<string | undefined>('escalationCode');
        break;
      case 'conditional':
        opts.when = body('condition');
        break;
      case 'link':
        opts.link = def.get<string | undefined>('name');
        break;
      default:
        break;
    }
  }
  if (is(el, 'bpmn:BoundaryEvent') && el.get<boolean | undefined>('cancelActivity') === false) opts.nonInterrupting = true;
  if (is(el, 'bpmn:StartEvent') && el.get<boolean | undefined>('isInterrupting') === false) opts.nonInterrupting = true;
  for (const k of Object.keys(opts) as Array<keyof TriggerOptions>) if (opts[k] === undefined) delete opts[k];
  return { trigger, opts };
}

const ALWAYS_INTERRUPTING: Trigger[] = ['error', 'cancel', 'compensate'];

/**
 * True when an event with this trigger can never be non-interrupting:
 * error/cancel/compensate boundary events, error/compensate and untyped
 * start events, and every event that is neither a boundary nor a start event.
 */
export function interruptingOnly(el: El, trigger: Trigger): boolean {
  if (is(el, 'bpmn:BoundaryEvent')) return ALWAYS_INTERRUPTING.includes(trigger);
  if (is(el, 'bpmn:StartEvent')) return ALWAYS_INTERRUPTING.includes(trigger) || trigger === 'none';
  return true;
}

/** W_PROPERTY_DROPPED for a non-interrupting flag that a trigger change had to clear. */
export function warnNonInterruptingDropped(cs: ChangeSet, el: El, trigger: Trigger): void {
  const position = is(el, 'bpmn:BoundaryEvent') ? 'boundary' : 'start';
  cs.warn({
    code: 'W_PROPERTY_DROPPED',
    message: `nonInterrupting of ${idOf(el)} was dropped: ${trigger === 'none' ? 'untyped' : trigger} ${position} events are always interrupting`,
    element: idOf(el),
    hint: `${idOf(el)} now interrupts${position === 'boundary' ? ' its host activity' : ' the enclosing process'}; pick a message, timer, signal, escalation or conditional trigger to keep it non-interrupting.`,
  });
}

/** Throws unless `el` may be non-interrupting with the given trigger. */
function assertNonInterruptingAllowed(doc: Doc, el: El, trigger: Trigger): void {
  if (is(el, 'bpmn:BoundaryEvent')) {
    if (ALWAYS_INTERRUPTING.includes(trigger)) {
      throw modelError('E_INVALID_TRIGGER', `${trigger} boundary events are always interrupting (${idOf(el)})`, {
        element: idOf(el),
        hint: 'Only message, timer, signal, escalation and conditional boundary events can be non-interrupting.',
      });
    }
    return;
  }
  if (is(el, 'bpmn:StartEvent')) {
    const scope = doc.scopeOf(el);
    if (!scope || !is(scope, 'bpmn:SubProcess') || !scope.get<boolean | undefined>('triggeredByEvent')) {
      throw modelError('E_INVALID_TRIGGER', `Start event ${idOf(el)} is not inside an event sub-process and cannot be non-interrupting`, {
        element: idOf(el),
        hint: 'Only start events of an eventSubProcess can be non-interrupting.',
      });
    }
    if (interruptingOnly(el, trigger)) {
      throw modelError('E_INVALID_TRIGGER', `A${trigger === 'none' ? 'n untyped' : ` ${trigger}`} start event cannot be non-interrupting (${idOf(el)})`, {
        element: idOf(el),
        hint: 'Only message, timer, signal, escalation and conditional start events can be non-interrupting.',
      });
    }
    return;
  }
  throw invalidValue(el, 'nonInterrupting', 'only boundary events and start events of event sub-processes can be non-interrupting');
}

function setNonInterrupting(doc: Doc, el: El, value: boolean): void {
  if (value) assertNonInterruptingAllowed(doc, el, triggerOf(el) ?? 'none');
  if (is(el, 'bpmn:BoundaryEvent')) el.set('cancelActivity', !value);
  else if (is(el, 'bpmn:StartEvent')) el.set('isInterrupting', !value);
  else assertNonInterruptingAllowed(doc, el, 'none');
}

/**
 * Message flows touching `event` that its current kind/trigger cannot serve
 * (the rules `connect` applies when creating one): only untyped or message
 * events take part, throw events send, catch events receive.
 */
export function messageFlowConflicts(doc: Doc, event: El): Array<{ flow: El; why: string }> {
  if (!is(event, 'bpmn:Event')) return [];
  const trigger = triggerOf(event) ?? 'none';
  const out: Array<{ flow: El; why: string }> = [];
  for (const flow of doc.messageFlows()) {
    const sends = flow.get<El | undefined>('sourceRef') === event;
    const receives = flow.get<El | undefined>('targetRef') === event;
    if (!sends && !receives) continue;
    let why: string | undefined;
    if (trigger !== 'none' && trigger !== 'message') why = `a ${trigger} event cannot ${sends ? 'send' : 'receive'} messages`;
    else if (sends && !is(event, 'bpmn:ThrowEvent')) why = 'catching events cannot send messages';
    else if (receives && !is(event, 'bpmn:CatchEvent')) why = 'throwing events cannot receive messages';
    if (why) out.push({ flow, why });
  }
  return out;
}

/**
 * After a kind/trigger change: throws E_INVALID_TRIGGER when a message flow
 * that fitted `event` before (`before` = conflicting flow ids beforehand) no
 * longer does, so the model never ends up with a message flow `connect` would refuse.
 */
export function assertMessageFlowsFit(doc: Doc, event: El, before: Set<string>): void {
  const broken = messageFlowConflicts(doc, event).filter((c) => !before.has(idOf(c.flow)));
  const first = broken[0];
  if (!first) return;
  const src = first.flow.get<El | undefined>('sourceRef');
  const tgt = first.flow.get<El | undefined>('targetRef');
  throw modelError(
    'E_INVALID_TRIGGER',
    `${kindLabel(event)} ${idOf(event)} would break message flow ${idOf(first.flow)} (${src ? idOf(src) : '?'} -> ${tgt ? idOf(tgt) : '?'}): ${first.why}`,
    {
      element: idOf(event),
      related: broken.map((c) => idOf(c.flow)),
      hint: `Remove the message flow first (\`bpmn remove ${broken.map((c) => idOf(c.flow)).join(' ')}\`) or keep a message / untyped event.`,
    },
  );
}

function applyEventKeys(doc: Doc, el: El, keys: Map<string, string>, cs: ChangeSet): void {
  const def = kindOf(el);
  const allowed = def?.triggers ?? [];
  const current = currentTrigger(el);
  let requested: Trigger | undefined;
  if (keys.has('trigger')) {
    const raw = keys.get('trigger') ?? '';
    requested = raw ? normalizeTrigger(raw) : 'none';
    if (!requested) throw invalidValue(el, 'trigger', `unknown trigger "${raw}"`, `Allowed on ${def?.kind ?? kindLabel(el)}: ${allowed.join(', ')}.`);
  }
  const given: Record<string, unknown> = {};
  let nonInterrupting: boolean | undefined;
  for (const [key, value] of keys) {
    if (key === 'trigger') continue;
    if (key === 'nonInterrupting') {
      nonInterrupting = value ? parseBool(el, key, value) : false;
      continue;
    }
    const implied = TRIGGER_OF_KEY[key]!;
    if (requested === undefined) requested = implied;
    else if (requested !== implied) throw invalidValue(el, key, `${key} belongs to the ${implied} trigger, not ${requested}`);
    if (!value && key !== 'errorCode' && key !== 'escalationCode') {
      throw invalidValue(el, key, `${key} needs a value`, 'Use trigger=none to remove the trigger.');
    }
    given[key] = value || undefined;
  }
  const trigger = requested ?? current.trigger;
  if (nonInterrupting !== undefined && requested === undefined && !Object.keys(given).length) {
    setNonInterrupting(doc, el, nonInterrupting);
    cs.change(changeOf(el, `nonInterrupting=${nonInterrupting}`));
    return;
  }
  if (!allowed.includes(trigger)) {
    throw modelError('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def?.kind ?? kindLabel(el)} ${idOf(el)}`, {
      element: idOf(el),
      hint: `Allowed triggers: ${allowed.join(', ') || 'none'}.`,
    });
  }
  const merged: TriggerOptions = trigger === current.trigger ? { ...current.opts, ...given } : { ...given };
  // a new timer value is classified again (R... cycle, P... duration, else date)
  if (given['timer'] !== undefined) delete merged.timerKind;
  // the existing non-interrupting flag follows the event unless the new trigger cannot have it
  let dropNonInterrupting = false;
  if (nonInterrupting !== undefined) merged.nonInterrupting = nonInterrupting;
  else if (current.opts.nonInterrupting && interruptingOnly(el, trigger)) {
    merged.nonInterrupting = false;
    dropNonInterrupting = true;
  } else if (current.opts.nonInterrupting) merged.nonInterrupting = true;
  else delete merged.nonInterrupting;
  if (merged.nonInterrupting) assertNonInterruptingAllowed(doc, el, trigger);
  const conflictsBefore = new Set(messageFlowConflicts(doc, el).map((c) => idOf(c.flow)));
  for (const w of applyTrigger(doc, el, trigger, merged)) cs.warn(w);
  assertMessageFlowsFit(doc, el, conflictsBefore);
  if (dropNonInterrupting) warnNonInterruptingDropped(cs, el, trigger);
  const details = Object.entries(given)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  cs.change(changeOf(el, [`trigger=${trigger}`, ...details, ...(nonInterrupting !== undefined ? [`nonInterrupting=${nonInterrupting}`] : [])].join(' ')));
}

/* ------------------------------------------------------------------ */
/* rename                                                               */
/* ------------------------------------------------------------------ */

/** Renames an element id, re-pointing every reference (incl. string refs like calledElement). */
export function renameId(doc: Doc, el: El, newId: string): void {
  const old = idOf(el);
  if (old === newId) return;
  doc.claimId(newId);
  el.set('id', newId);
  if (old) doc.ids.release(old);
  for (const e of walk(doc.definitions)) {
    if (is(e, 'bpmn:CallActivity') && e.get<string | undefined>('calledElement') === old) e.set('calledElement', newId);
    if (descriptorOf(e).isGeneric && e.$type === 'zeebe:calledElement') {
      const any = e as unknown as Record<string, unknown>;
      if (any['processId'] === old) any['processId'] = newId;
    }
  }
  doc.invalidate();
}

/* ------------------------------------------------------------------ */
/* read                                                                 */
/* ------------------------------------------------------------------ */

/** Structured, settable view of an element's properties (used by `show <id>`). */
export function readProperties(doc: Doc, el: El): Record<string, unknown> {
  const out: Record<string, unknown> = { id: idOf(el) };
  const name = el.get<string | undefined>('name');
  if (name) out['name'] = name;
  const docs = (ownValue(el, 'documentation') as El[] | undefined) ?? [];
  const text = docs
    .map((d) => d.get<string | undefined>('text'))
    .filter(Boolean)
    .join('\n');
  if (text) out['doc'] = text;
  for (const p of descriptorOf(el).properties ?? []) {
    if (p.name === 'id' || p.name === 'name' || p.name === 'default' || !isSettableProp(doc, p)) continue;
    const v = ownValue(el, p.name);
    if (v === undefined || v === null || v === '') continue;
    out[p.name] = p.isReference && isEl(v) ? idOf(v) : v;
  }
  for (const [k, v] of Object.entries(el.$attrs ?? {})) {
    if (k.startsWith('xmlns') || typeof v === 'object') continue;
    out[k] = v;
  }
  if (is(el, 'bpmn:SequenceFlow')) {
    const cond = el.get<El | undefined>('conditionExpression');
    const body = cond?.get<string | undefined>('body');
    if (body) out['condition'] = body;
    const language = cond?.get<string | undefined>('language');
    if (language) out['language'] = language;
    const src = el.get<El | undefined>('sourceRef');
    const tgt = el.get<El | undefined>('targetRef');
    if (src) out['source'] = idOf(src);
    if (tgt) out['target'] = idOf(tgt);
    if (src?.get<El | undefined>('default') === el) out['default'] = true;
  } else {
    const def = ownValue(el, 'default');
    if (isEl(def)) out['default'] = idOf(def);
  }
  if (is(el, 'bpmn:Event')) {
    const { trigger, opts } = currentTrigger(el);
    out['trigger'] = trigger;
    const { timerKind: _ignored, ...rest } = opts;
    Object.assign(out, rest);
  }
  if (is(el, 'bpmn:Activity')) {
    const loop = el.get<El | undefined>('loopCharacteristics');
    if (is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
      out['loop'] = loop!.get<boolean | undefined>('isSequential') ? 'sequential' : 'parallel';
      const card = loop!.get<El | undefined>('loopCardinality')?.get<string | undefined>('body');
      const done = loop!.get<El | undefined>('completionCondition')?.get<string | undefined>('body');
      if (card) out['cardinality'] = card;
      if (done) out['completion'] = done;
    } else if (is(loop, 'bpmn:StandardLoopCharacteristics')) {
      out['loop'] = 'standard';
    }
  }
  if (is(el, 'bpmn:SubProcess')) {
    const requested = expansionRequests.get(doc)?.get(idOf(el));
    out['expanded'] = requested ?? diExpansionState(doc.definitions).get(idOf(el)) ?? true;
  }
  if (is(el, 'bpmn:FlowNode')) {
    const lanes = doc.lanesOf(el);
    const lane = lanes[lanes.length - 1];
    if (lane) out['lane'] = idOf(lane);
  }
  return out;
}
