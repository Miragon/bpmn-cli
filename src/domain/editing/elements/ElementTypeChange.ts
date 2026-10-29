import type { EditSession } from '../../document/EditSession.js';
import { modelError } from '../../document/utils/errors.js';
import { BpmnError } from '../../document/BpmnError.js';
import type { Finding } from '../../document/Finding.js';
import { kindLabel, kindOf, parseKind, triggerOf, type KindDef, type Trigger } from '../../document/Kinds.js';
import { is, many, removeFrom, walk, type El } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { withUnserialised } from '../../document/utils/finding.js';
import { Camunda8Defaults } from '../../document/vendor/Camunda8Defaults.js';
import { EventTrigger } from '../events/EventTrigger.js';
import { TriggerChange } from '../events/TriggerChange.js';
import { descriptorOf, idOf, isEl, ownValue, vendorAttributes, type PropDescriptor } from '../../document/utils/elements.js';
import type { ChangeElementType, TriggerOptions } from '../../commands/types.js';
import { CAMUNDA } from '../../document/vendor/CamundaDescriptor.js';
import { ZEEBE, ZEEBE_URI } from '../../document/vendor/ZeebeDescriptor.js';
import { SequenceFlows } from '../connections/SequenceFlows.js';
import { RootElements } from '../events/RootElements.js';
import { ElementRemoval } from './ElementRemoval.js';
import { detachFromParent, referencesToAny } from '../utils/containment.js';

const ACTIVITY_FAMILIES = new Set(['task', 'subProcess', 'callActivity']);

/**
 * Runs the `retype` op: changes an element's kind and keeps its id, flows, docs and vendor content.
 * Retyping only stays within a family (activities, gateways, events of one position).
 * Content the new kind cannot hold is recorded so the write refuses it without --force.
 */
export class ElementTypeChange {
  constructor(private readonly edit: EditSession) {}

  private static eventPosition(def: KindDef): string {
    return def.kind === 'intermediateCatchEvent' || def.kind === 'intermediateThrowEvent' ? 'intermediate' : def.kind;
  }

  private static incompatibility(from: KindDef, to: KindDef): string | undefined {
    if (ACTIVITY_FAMILIES.has(from.family) && ACTIVITY_FAMILIES.has(to.family)) {
      return undefined;
    }
    if (from.family === 'gateway' && to.family === 'gateway') return undefined;
    if (from.family === 'event' && to.family === 'event') {
      return ElementTypeChange.eventPosition(from) === ElementTypeChange.eventPosition(to) ? undefined : `a ${from.kind} sits at a different position in the flow than a ${to.kind}`;
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

  /**
   * Changes the kind of an element. The old trigger state is read before the swap moves the
   * definitions over; a batch alias of the element follows it to the new one.
   */
  retype(command: ChangeElementType): ChangeSet {
    const changes = new ChangeSet();
    const el = this.edit.require(command.id);
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
      parsed = parseKind(command.kind);
    } catch (err) {
      if (err instanceof BpmnError) {
        throw modelError('E_UNKNOWN_KIND', err.message, { element: id, candidates: err.details.candidates ?? [], hint: 'Run `bpmn kinds` for the list of kinds.' });
      }
      throw err;
    }
    const to = parsed.def;
    const reason = ElementTypeChange.incompatibility(from, to);
    if (reason) {
      throw modelError('E_INVALID_RETYPE', `Cannot retype ${kindLabel(el)} ${id} to ${to.kind}: ${reason}`, {
        element: id,
        hint: `Remove the element and add a new one of the wanted kind instead (\`bpmn remove <file> ${id}\`, then \`bpmn add <file> <kind> ...\`).`,
      });
    }
    const oldLabel = kindLabel(el);
    const trigger = ElementTypeChange.resolveTrigger(el, to, parsed.trigger);
    const given = EventTrigger.optionsOf(command);
    const givenKeys = Object.keys(given) as Array<keyof TriggerOptions>;
    const isEvent = to.family === 'event';
    if (!isEvent && givenKeys.length) {
      changes.warn({
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
      changes.note(`${id} is already a ${oldLabel}; nothing changed${oldLabel.includes(':') ? ' (to drop the trigger use `<kind>:none` or `bpmn set <file> <id> trigger=none`)' : ''}`);
      RootElements.bindRefAs(changes, command.refAs, el);
      return changes;
    }
    if (to.kind === 'eventSubProcess' && (this.edit.doc.incoming(el).length || this.edit.doc.outgoing(el).length)) {
      throw modelError('E_INVALID_RETYPE', `${id} has sequence flows; event sub-processes cannot be connected by sequence flows`, {
        element: id,
        candidates: [...this.edit.doc.incoming(el), ...this.edit.doc.outgoing(el)].map(idOf),
        hint: `Remove its flows first: \`bpmn remove <file> ${[...this.edit.doc.incoming(el), ...this.edit.doc.outgoing(el)].map(idOf).join(' ')}\`.`,
      });
    }

    const change = new TriggerChange(this.edit, el);
    const target = to.type === el.$type ? el : this.swapType(el, to, changes);
    ElementTypeChange.applyKindProps(target, from, to);
    if (target !== el) {
      changes.replaced.push({ from: el, to: target });
      const inapplicable = this.inapplicableCamundaContent(target, to);
      if (inapplicable) changes.warn(inapplicable);
      if (new Camunda8Defaults(this.edit).userTask(target)) {
        changes.note(`${id} is a Camunda user task now (zeebe:userTask added, like Camunda Modeler)`);
      }
    }
    new SequenceFlows(this.edit).dropIgnoredConditions(target, changes);
    change.change(trigger !== undefined && (!sameTrigger || hasTriggerOptions) ? trigger : undefined, given, changes, { on: target });
    this.edit.doc.invalidate();
    const detail =
      from === to && sameTrigger
        ? `trigger options updated (${givenKeys.map((givenKey) => `${givenKey}=${String(given[givenKey])}`).join(' ')})`
        : `retyped from ${oldLabel} to ${kindLabel(target)}`;
    changes.change(ChangeSet.entryOf(target, detail));
    RootElements.bindRefAs(changes, command.refAs, target);
    return changes;
  }

  /** Operaton's namespace counts as camunda too. */
  private camundaName(name: string): string | undefined {
    const idx = name.indexOf(':');
    if (idx <= 0 || !CAMUNDA.reads(this.edit.doc.namespaceUri(name.slice(0, idx)))) {
      return undefined;
    }
    return `camunda:${name.slice(idx + 1)}`;
  }

  private zeebeLocal(name: string): string | undefined {
    const idx = name.indexOf(':');
    if (idx <= 0 || this.edit.doc.namespaceUri(name.slice(0, idx)) !== ZEEBE_URI) {
      return undefined;
    }
    return name.slice(idx + 1);
  }

  /**
   * Vendor content the new kind cannot use is kept (dropping it would lose data), only named.
   * The Camunda 7 / 8 profile reports these item by item, so a write drops this summary there.
   */
  private inapplicableCamundaContent(el: El, to: KindDef): Finding | undefined {
    const attrs = Object.keys(vendorAttributes(el)).filter((key) => {
      const name = this.camundaName(key);
      if (name) return CAMUNDA.attrAppliesTo(name, el) === false;
      const zeebeName = this.zeebeLocal(key);
      const def = zeebeName ? ZEEBE.attr(zeebeName) : undefined;
      return !!def && !def.owners.some((owner) => is(el, owner));
    });
    const exts: string[] = [];
    for (const ext of el.get<El | undefined>('extensionElements')?.get<El[] | undefined>('values') ?? []) {
      const name = this.camundaName(ext.$type);
      const zeebeName = name ? undefined : this.zeebeLocal(ext.$type);
      const misplaced = name ? CAMUNDA.allowedOn(name, el) === false : zeebeName ? ZEEBE.allowedOn(zeebeName, el) === false && !ZEEBE.nestedOnly(zeebeName) : false;
      if (misplaced && !exts.includes(ext.$type)) exts.push(ext.$type);
    }
    const names = [...attrs, ...exts];
    if (!names.length) return undefined;
    const id = idOf(el);
    const fixes = [
      ...(attrs.length ? [`\`bpmn set <file> ${id} ${attrs.map((attr) => `${attr}=`).join(' ')}\``] : []),
      ...exts.map((extType) => `\`bpmn ext remove <file> ${id} ${extType}\``),
    ];
    const warning: Finding = {
      code: 'W_PROPERTY_INAPPLICABLE',
      message: `${names.join(', ')} of ${id} ${names.length > 1 ? 'have' : 'has'} no effect on a ${to.kind} (kept as ${names.length > 1 ? 'they are' : 'it is'})`,
      element: id,
      hint: `The ${names.every((extName) => this.zeebeLocal(extName)) ? 'Zeebe (Camunda 8)' : names.some((extName) => this.zeebeLocal(extName)) ? 'Camunda 7 and Zeebe' : 'Camunda'} descriptor does not allow ${names.length > 1 ? 'them' : 'it'} on a ${to.kind}; remove with ${fixes.join(' and ')}, or retype back.`,
    };
    return withUnserialised(warning, { covers: [...attrs.map((attr) => `attr:${attr}`), ...exts.map((extType) => `ext:${extType.slice(extType.indexOf(':') + 1)}`)] });
  }

  private static applyKindProps(el: El, from: KindDef, to: KindDef): void {
    for (const propName of Object.keys(from.props ?? {})) {
      if (!(to.props && propName in to.props) && descriptorOf(el).propertiesByName?.[propName]) {
        el.set(propName, undefined);
      }
    }
    for (const [propName, propValue] of Object.entries(to.props ?? {})) {
      el.set(propName, propValue);
    }
  }

  private static copyProp(next: El, property: PropDescriptor, value: unknown): void {
    if (property.isMany && Array.isArray(value)) {
      const list = many(next, property.name);
      for (const child of value) {
        list.push(child as El);
        if (!property.isReference && isEl(child)) child.$parent = next;
      }
      return;
    }
    next.set(property.name, value);
    if (!property.isReference && isEl(value)) value.$parent = next;
  }

  private static describeValue(value: unknown): string {
    if (Array.isArray(value)) return `${value.length} element(s)`;
    if (isEl(value)) return idOf(value) || value.$type;
    return String(value);
  }

  private dropProp(el: El, property: PropDescriptor, value: unknown, to: KindDef, changes: ChangeSet): void {
    const detail = ElementTypeChange.describeValue(value);
    if (!property.isReference) {
      const children = (Array.isArray(value) ? value : [value]).filter((child): child is El => isEl(child) && !!child.get<string | undefined>('id'));
      const before = changes.removed.length;
      for (const child of children) {
        new ElementRemoval(this.edit).cascade(child, changes);
      }
      const removed = changes.removed.slice(before).map((change) => change.id);
      if (removed.length) {
        this.edit.recordDroppedContent({ element: idOf(el), kind: to.kind, removed });
      }
    }
    changes.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `${property.name} of ${idOf(el)} (${detail}) was dropped: a ${to.kind} has no ${property.name}`,
      element: idOf(el),
      ...(property.name === 'default' ? { hint: 'The flow still exists but is no longer marked as default.' } : {}),
    });
  }

  private dropDiagram(diagram: El | undefined): void {
    if (!diagram || !is(diagram, 'bpmndi:BPMNDiagram')) return;
    removeFrom(this.edit.doc.definitions, 'diagrams', diagram);
    for (const element of walk(diagram)) {
      const id = element.get<string | undefined>('id');
      if (id) this.edit.doc.ids.release(id);
    }
  }

  /** A kind prop is not copied over: applyKindProps sets it for the new kind. */
  private static isReappliedKindProp(name: string): boolean {
    return name === 'triggeredByEvent';
  }

  /**
   * Replaces the element by one of the new type. A diagram plane it roots is dropped unless the
   * new one is a sub-process: only processes, sub-processes and collaborations may root a plane.
   */
  private swapType(el: El, to: KindDef, changes: ChangeSet): El {
    const next = this.edit.doc.moddle.create(to.type, { id: idOf(el) });
    const nextProps = descriptorOf(next).propertiesByName ?? {};
    for (const property of descriptorOf(el).properties ?? []) {
      if (property.name === 'id') continue;
      const value = ownValue(el, property.name);
      if (value === undefined || value === null || (Array.isArray(value) && !value.length)) {
        continue;
      }
      if (ElementTypeChange.isReappliedKindProp(property.name)) continue;
      if (nextProps[property.name]) {
        ElementTypeChange.copyProp(next, property, value);
      } else {
        this.dropProp(el, property, value, to, changes);
      }
    }
    Object.assign(next.$attrs, el.$attrs);
    detachFromParent(el, next);
    for (const ref of referencesToAny(this.edit.doc.definitions, new Set([el]))) {
      if (is(ref.holder, 'bpmndi:BPMNPlane') && !is(next, 'bpmn:SubProcess')) {
        this.dropDiagram(ref.holder.$parent as El | undefined);
        continue;
      }
      if (ref.isMany) {
        const list = many(ref.holder, ref.prop);
        const index = list.indexOf(el);
        if (index !== -1) list[index] = next;
      } else {
        ref.holder.set(ref.prop, next);
      }
    }
    this.edit.replaceElement(el, next);
    this.edit.doc.invalidate();
    return next;
  }
}
