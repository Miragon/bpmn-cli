import type { Doc } from '../model/Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { type Warning } from '../shared/CliError.js';
import { KindError } from '../model/KindError.js';
import { kindLabel, kindOf, parseKind, triggerOf, type KindDef, type Trigger } from '../model/utils/kinds.js';
import { findReferences, is, many, removeFrom, walk, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { coversProfileSubjects } from './utils/covers.js';
import { Camunda8Defaults } from '../platform/Camunda8Defaults.js';
import { EventTrigger } from './EventTrigger.js';
import { TriggerChange } from './TriggerChange.js';
import { descriptorOf, idOf, isEl, ownValue, vendorAttributes, type PropDescriptor } from './utils/elements.js';
import type { RetypeOp, TriggerOptions } from './types.js';
import { CAMUNDA } from '../platform/CamundaDescriptor.js';
import { ZEEBE, ZEEBE_URI } from '../platform/ZeebeDescriptor.js';
import { SequenceFlows } from './SequenceFlows.js';
import { RootElements } from './RootElements.js';
import { ElementRemover } from './ElementRemover.js';

const ACTIVITY_FAMILIES = new Set(['task', 'subProcess', 'callActivity']);

/**
 * Runs the `retype` op: changes an element's kind and keeps its id, flows, docs and vendor content.
 * Retyping only stays within a family (activities, gateways, events of one position).
 * Content the new kind cannot hold is recorded so the write refuses it without --force.
 */
export class ElementRetyper {
  constructor(private readonly doc: Doc) {}

  private static eventPosition(def: KindDef): string {
    return def.kind === 'intermediateCatchEvent' || def.kind === 'intermediateThrowEvent' ? 'intermediate' : def.kind;
  }

  private static incompatibility(from: KindDef, to: KindDef): string | undefined {
    if (ACTIVITY_FAMILIES.has(from.family) && ACTIVITY_FAMILIES.has(to.family)) return undefined;
    if (from.family === 'gateway' && to.family === 'gateway') return undefined;
    if (from.family === 'event' && to.family === 'event') {
      return ElementRetyper.eventPosition(from) === ElementRetyper.eventPosition(to) ? undefined : `a ${from.kind} sits at a different position in the flow than a ${to.kind}`;
    }
    return `${from.family} and ${to.family} are different families`;
  }

  private static resolveTrigger(el: El, to: KindDef, requested: Trigger | undefined): Trigger | undefined {
    if (to.family !== 'event') return undefined;
    if (requested) return requested;
    const current = triggerOf(el) ?? 'none';
    const allowed = to.triggers ?? [];
    if (allowed.includes(current)) return current;
    throw modelError('E_INVALID_TRIGGER', `Trigger "${current}" is not allowed on ${to.kind}; say which trigger the ${to.kind} should have`, {
      element: idOf(el),
      hint: `Use \`bpmn retype <file> ${idOf(el)} ${to.kind}:<trigger>\` with one of: ${allowed.join(', ')}.`,
    });
  }

  retype(op: RetypeOp): ChangeSet {
    const cs = new ChangeSet();
    const el = this.doc.require(op.id);
    const id = idOf(el);
    const from = kindOf(el);
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
    const reason = ElementRetyper.incompatibility(from, to);
    if (reason) {
      throw modelError('E_INVALID_RETYPE', `Cannot retype ${kindLabel(el)} ${id} to ${to.kind}: ${reason}`, {
        element: id,
        hint: `Remove the element and add a new one of the wanted kind instead (\`bpmn remove <file> ${id}\`, then \`bpmn add <file> <kind> ...\`).`,
      });
    }
    const oldLabel = kindLabel(el);
    const trigger = ElementRetyper.resolveTrigger(el, to, parsed.trigger);
    const given = EventTrigger.optionsOf(op);
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
      new RootElements(this.doc).bindRefAs(cs, op.refAs, el);
      return cs;
    }
    if (to.kind === 'eventSubProcess' && (this.doc.incoming(el).length || this.doc.outgoing(el).length)) {
      throw modelError('E_INVALID_RETYPE', `${id} has sequence flows; event sub-processes cannot be connected by sequence flows`, {
        element: id,
        candidates: [...this.doc.incoming(el), ...this.doc.outgoing(el)].map(idOf),
        hint: `Remove its flows first: \`bpmn remove <file> ${[...this.doc.incoming(el), ...this.doc.outgoing(el)].map(idOf).join(' ')}\`.`,
      });
    }

    // read the old trigger state before the swap moves the definitions over
    const change = new TriggerChange(this.doc, el);
    const target = to.type === el.$type ? el : this.swapType(el, to, cs);
    ElementRetyper.applyKindProps(target, from, to);
    if (target !== el) {
      // a batch alias of the element follows it to the new one
      cs.replaced.push({ from: el, to: target });
      const inapplicable = this.inapplicableCamundaContent(target, to);
      if (inapplicable) cs.warn(inapplicable);
      if (new Camunda8Defaults(this.doc).userTask(target)) cs.note(`${id} is a Camunda user task now (zeebe:userTask added, like Camunda Modeler)`);
    }
    new SequenceFlows(this.doc).dropIgnoredConditions(target, cs);
    change.change(trigger !== undefined && (!sameTrigger || hasTriggerOptions) ? trigger : undefined, given, cs, { on: target });
    this.doc.invalidate();
    const detail =
      from === to && sameTrigger
        ? `trigger options updated (${givenKeys.map((k) => `${k}=${String(given[k])}`).join(' ')})`
        : `retyped from ${oldLabel} to ${kindLabel(target)}`;
    cs.change(ChangeSet.entryOf(target, detail));
    new RootElements(this.doc).bindRefAs(cs, op.refAs, target);
    return cs;
  }

  /** Operaton's namespace counts as camunda too. */
  private camundaName(name: string): string | undefined {
    const idx = name.indexOf(':');
    if (idx <= 0 || !CAMUNDA.reads(this.doc.namespaceUri(name.slice(0, idx)))) return undefined;
    return `camunda:${name.slice(idx + 1)}`;
  }

  private zeebeLocal(name: string): string | undefined {
    const idx = name.indexOf(':');
    if (idx <= 0 || this.doc.namespaceUri(name.slice(0, idx)) !== ZEEBE_URI) return undefined;
    return name.slice(idx + 1);
  }

  /** Vendor content the new kind cannot use is kept (dropping it would lose data), only named. */
  private inapplicableCamundaContent(el: El, to: KindDef): Warning | undefined {
    const attrs = Object.keys(vendorAttributes(el)).filter((key) => {
      const name = this.camundaName(key);
      if (name) return CAMUNDA.attrAppliesTo(name, el) === false;
      const z = this.zeebeLocal(key);
      const def = z ? ZEEBE.attr(z) : undefined;
      return !!def && !def.owners.some((o) => is(el, o));
    });
    const exts: string[] = [];
    for (const ext of el.get<El | undefined>('extensionElements')?.get<El[] | undefined>('values') ?? []) {
      const name = this.camundaName(ext.$type);
      const z = name ? undefined : this.zeebeLocal(ext.$type);
      const misplaced = name ? CAMUNDA.allowedOn(name, el) === false : z ? ZEEBE.allowedOn(z, el) === false && !ZEEBE.nestedOnly(z) : false;
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
      hint: `The ${names.every((n) => this.zeebeLocal(n)) ? 'Zeebe (Camunda 8)' : names.some((n) => this.zeebeLocal(n)) ? 'Camunda 7 and Zeebe' : 'Camunda'} descriptor does not allow ${names.length > 1 ? 'them' : 'it'} on a ${to.kind}; remove with ${fixes.join(' and ')}, or retype back.`,
    };
    // the Camunda 7 / 8 profile reports these item by item, so a write drops this summary there
    return coversProfileSubjects(warning, [...attrs.map((a) => `attr:${a}`), ...exts.map((t) => `ext:${t.slice(t.indexOf(':') + 1)}`)]);
  }

  private static applyKindProps(el: El, from: KindDef, to: KindDef): void {
    for (const k of Object.keys(from.props ?? {})) if (!(to.props && k in to.props) && descriptorOf(el).propertiesByName?.[k]) el.set(k, undefined);
    for (const [k, v] of Object.entries(to.props ?? {})) el.set(k, v);
  }

  private static copyProp(next: El, p: PropDescriptor, value: unknown): void {
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

  private static describeValue(value: unknown): string {
    if (Array.isArray(value)) return `${value.length} element(s)`;
    if (isEl(value)) return idOf(value) || value.$type;
    return String(value);
  }

  private dropProp(el: El, p: PropDescriptor, value: unknown, to: KindDef, cs: ChangeSet): void {
    const detail = ElementRetyper.describeValue(value);
    if (!p.isReference) {
      const children = (Array.isArray(value) ? value : [value]).filter((c): c is El => isEl(c) && !!c.get<string | undefined>('id'));
      const before = cs.removed.length;
      for (const child of children) new ElementRemover(this.doc).cascade(child, cs);
      const removed = cs.removed.slice(before).map((c) => c.id);
      if (removed.length) this.doc.edit.recordDroppedContent({ element: idOf(el), kind: to.kind, removed });
    }
    cs.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `${p.name} of ${idOf(el)} (${detail}) was dropped: a ${to.kind} has no ${p.name}`,
      element: idOf(el),
      ...(p.name === 'default' ? { hint: 'The flow still exists but is no longer marked as default.' } : {}),
    });
  }

  private dropDiagram(diagram: El | undefined): void {
    if (!diagram || !is(diagram, 'bpmndi:BPMNDiagram')) return;
    removeFrom(this.doc.definitions, 'diagrams', diagram);
    for (const e of walk(diagram)) {
      const id = e.get<string | undefined>('id');
      if (id) this.doc.ids.release(id);
    }
  }

  private static replaceInParent(parent: El, el: El, next: El): void {
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

  private swapType(el: El, to: KindDef, cs: ChangeSet): El {
    const next = this.doc.moddle.create(to.type, { id: idOf(el) });
    const nextProps = descriptorOf(next).propertiesByName ?? {};
    for (const p of descriptorOf(el).properties ?? []) {
      if (p.name === 'id') continue;
      const value = ownValue(el, p.name);
      if (value === undefined || value === null || (Array.isArray(value) && !value.length)) continue;
      if (p.name === 'triggeredByEvent') continue; // kind prop, re-applied by applyKindProps
      if (nextProps[p.name]) ElementRetyper.copyProp(next, p, value);
      else this.dropProp(el, p, value, to, cs);
    }
    Object.assign(next.$attrs, el.$attrs);
    const parent = el.$parent as El | undefined;
    if (parent) ElementRetyper.replaceInParent(parent, el, next);
    for (const ref of findReferences(this.doc.definitions, el)) {
      if (is(ref.holder, 'bpmndi:BPMNPlane') && !is(next, 'bpmn:SubProcess')) {
        // only processes, sub-processes and collaborations may root a plane
        this.dropDiagram(ref.holder.$parent as El | undefined);
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
    this.doc.edit.replaceElement(el, next);
    this.doc.invalidate();
    return next;
  }
}
