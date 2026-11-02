import { BpmnElement, BpmnError, ChangeEntries, ChangeSet, type KindDefinition, KindParser, Kinds, type PropertyDescriptor, type Trigger, type TriggerOptions, Triggers } from '../model/index.js';
import type { RetypeOperation } from '../operations/index.js';
import { ElementContainment } from './containers/ElementContainment.js';
import { ElementRemoval } from './ElementRemoval.js';
import { Camunda8Defaults } from './events/Camunda8Defaults.js';
import { RootElements } from './events/RootElements.js';
import { TriggerChange } from './events/TriggerChange.js';
import { TriggerKeys } from './events/TriggerKeys.js';
import { FlowConditions } from './flows/FlowConditions.js';
import { InapplicableContent } from './properties/InapplicableContent.js';
import { PropertyEditor } from './PropertyEditor.js';
import type { EditSession } from './session/EditSession.js';

interface TypeChange {
  el: BpmnElement;
  from: KindDefinition;
  to: KindDefinition;
  trigger: Trigger | undefined;
  given: TriggerOptions;
}

export class ElementTypeChange {
  private static readonly ACTIVITY_FAMILIES = new Set(['task', 'subProcess', 'callActivity']);

  constructor(private readonly edit: EditSession) {}

  private static eventPosition(def: KindDefinition): string {
    return def.kind === 'intermediateCatchEvent' || def.kind === 'intermediateThrowEvent' ? 'intermediate' : def.kind;
  }

  private static incompatibility(from: KindDefinition, to: KindDefinition): string | undefined {
    if (ElementTypeChange.ACTIVITY_FAMILIES.has(from.family) && ElementTypeChange.ACTIVITY_FAMILIES.has(to.family)) {
      return undefined;
    }
    if (from.family === 'gateway' && to.family === 'gateway') {
      return undefined;
    }
    if (from.family === 'event' && to.family === 'event') {
      return ElementTypeChange.eventPosition(from) === ElementTypeChange.eventPosition(to) ? undefined : `a ${from.kind} sits at a different position in the flow than a ${to.kind}`;
    }
    return `${from.family} and ${to.family} are different families`;
  }

  private static resolveTrigger(el: BpmnElement, to: KindDefinition, requested: Trigger | undefined): Trigger | undefined {
    if (to.family !== 'event') {
      return undefined;
    }
    if (requested) {
      return requested;
    }
    const current = Triggers.of(el) ?? 'none';
    const allowed = to.triggers ?? [];
    if (allowed.includes(current)) {
      return current;
    }
    throw BpmnError.model('E_INVALID_TRIGGER', `Trigger "${current}" is not allowed on ${to.kind}; say which trigger the ${to.kind} should have`, {
      element: el.id,
      hint: `Use \`bpmn retype <file> ${el.id} ${to.kind}:<trigger>\` with one of: ${allowed.join(', ')}.`,
    });
  }

  retype(command: RetypeOperation): ChangeSet {
    const changes = new ChangeSet();
    const el = this.edit.require(command.id);
    const from = ElementTypeChange.currentKind(el);
    const parsed = ElementTypeChange.parseKind(command.kind, el.id);
    const to = parsed.def;
    ElementTypeChange.assertCompatible(el, from, to);
    const keys = command.set ?? {};
    const trigger = ElementTypeChange.resolveTrigger(el, to, parsed.trigger ?? TriggerKeys.impliedTrigger(keys));
    const eventKeys = to.family === 'event' ? TriggerKeys.present(keys) : {};
    TriggerKeys.assertFit(el, eventKeys, trigger ?? 'none');
    const given = TriggerKeys.optionsOf(eventKeys, el);
    const needsChange = from !== to || trigger !== Triggers.of(el) || Object.keys(given).length > 0;
    const target = needsChange ? this.changeType({ el, from, to, trigger, given }, changes) : el;
    const otherKeys = TriggerKeys.remainingKeys(keys, Object.keys(eventKeys));
    if (Object.keys(otherKeys).length) {
      changes.merge(new PropertyEditor(this.edit).set({ op: 'set', id: target.id, set: { ...otherKeys } }));
    } else if (!needsChange) {
      ElementTypeChange.noteUnchanged(el, changes);
    }
    RootElements.bindRefAs(changes, command.refAs, target);
    return changes;
  }

  private static noteUnchanged(el: BpmnElement, changes: ChangeSet): void {
    const label = Kinds.label(el);
    changes.note(`${el.id} is already a ${label}; nothing changed${label.includes(':') ? ' (to drop the trigger use `<kind>:none` or `bpmn set <file> <id> trigger=none`)' : ''}`);
  }

  private changeType({ el, from, to, trigger, given }: TypeChange, changes: ChangeSet): BpmnElement {
    const oldLabel = Kinds.label(el);
    const givenKeys = Object.keys(given) as Array<keyof TriggerOptions>;
    const sameTrigger = trigger === Triggers.of(el);
    this.assertConnectable(el, to);
    const change = new TriggerChange(this.edit, el);
    const target = to.type === el.type ? el : this.swapType(el, to, changes);
    ElementTypeChange.applyKindProps(target, from, to);
    if (target !== el) {
      this.reportReplacement(el, target, to, changes);
    }
    new FlowConditions(this.edit).dropIgnoredConditions(target, changes);
    change.change(trigger !== undefined && (!sameTrigger || givenKeys.length > 0) ? trigger : undefined, given, changes, { on: target });
    this.edit.document.tree.invalidate();
    const detail =
      from === to && sameTrigger
        ? `trigger options updated (${givenKeys.map((givenKey) => `${givenKey}=${String(given[givenKey])}`).join(' ')})`
        : `retyped from ${oldLabel} to ${Kinds.label(target)}`;
    changes.change(ChangeEntries.of(target, detail));
    return target;
  }

  private static currentKind(el: BpmnElement): KindDefinition {
    const from = Kinds.of(el);
    if (!from) {
      throw BpmnError.model('E_INVALID_RETYPE', `${el.type} ${el.id} cannot be retyped`, {
        element: el.id,
        hint: 'Only tasks, sub-processes, call activities, gateways and events can be retyped.',
      });
    }
    return from;
  }

  private static parseKind(kind: string, id: string): ReturnType<typeof KindParser.parse> {
    try {
      return KindParser.parse(kind);
    } catch (err) {
      const { message, details } = err as BpmnError;
      throw BpmnError.model('E_UNKNOWN_KIND', message, { element: id, candidates: details.candidates ?? [], hint: 'Run `bpmn guide kinds` for the list of kinds.' });
    }
  }

  private static assertCompatible(el: BpmnElement, from: KindDefinition, to: KindDefinition): void {
    const reason = ElementTypeChange.incompatibility(from, to);
    if (reason) {
      throw BpmnError.model('E_INVALID_RETYPE', `Cannot retype ${Kinds.label(el)} ${el.id} to ${to.kind}: ${reason}`, {
        element: el.id,
        hint: `Remove the element and add a new one of the wanted kind instead (\`bpmn remove <file> ${el.id}\`, then \`bpmn add <file> <kind> ...\`).`,
      });
    }
  }

  private assertConnectable(el: BpmnElement, to: KindDefinition): void {
    const { flows } = this.edit.document;
    if (to.kind === 'eventSubProcess' && (flows.incoming(el).length || flows.outgoing(el).length)) {
      throw BpmnError.model('E_INVALID_RETYPE', `${el.id} has sequence flows; event sub-processes cannot be connected by sequence flows`, {
        element: el.id,
        candidates: [...flows.incoming(el), ...flows.outgoing(el)].map((element) => element.id),
        hint: `Remove its flows first: \`bpmn remove <file> ${[...flows.incoming(el), ...flows.outgoing(el)].map((element) => element.id).join(' ')}\`.`,
      });
    }
  }

  private reportReplacement(el: BpmnElement, target: BpmnElement, to: KindDefinition, changes: ChangeSet): void {
    changes.replaced.push({ from: el, to: target });
    const inapplicable = new InapplicableContent(this.edit).warningFor(target, to);
    if (inapplicable) {
      changes.warn(inapplicable);
    }
    if (new Camunda8Defaults(this.edit).userTask(target)) {
      changes.note(`${el.id} is a Camunda user task now (zeebe:userTask added, like Camunda Modeler)`);
    }
  }

  private static applyKindProps(el: BpmnElement, from: KindDefinition, to: KindDefinition): void {
    for (const propName of Object.keys(from.props ?? {})) {
      if (!(to.props && propName in to.props) && el.descriptor.propertiesByName?.[propName]) {
        el.set(propName, undefined);
      }
    }
    for (const [propName, propValue] of Object.entries(to.props ?? {})) {
      el.set(propName, propValue);
    }
  }

  private static copyProp(next: BpmnElement, property: PropertyDescriptor, value: unknown): void {
    if (property.isMany && Array.isArray(value)) {
      for (const child of value) {
        next.add(property.name, child as BpmnElement);
      }
      return;
    }
    next.set(property.name, value);
    if (!property.isReference && value instanceof BpmnElement) {
      value.parent = next;
    }
  }

  private static describeValue(value: unknown): string {
    if (Array.isArray(value)) {
      return `${value.length} element(s)`;
    }
    if (value instanceof BpmnElement) {
      return value.id || value.type;
    }
    return String(value);
  }

  private dropProp(el: BpmnElement, property: PropertyDescriptor, value: unknown, to: KindDefinition, changes: ChangeSet): void {
    const detail = ElementTypeChange.describeValue(value);
    if (!property.isReference) {
      const children = (Array.isArray(value) ? value : [value]).filter((child): child is BpmnElement => child instanceof BpmnElement && !!child.get<string | undefined>('id'));
      const before = changes.removed.length;
      for (const child of children) {
        new ElementRemoval(this.edit).cascade(child, changes);
      }
      const removed = changes.removed.slice(before).map((change) => change.id);
      if (removed.length) {
        this.edit.journal.recordDroppedContent({ element: el.id, kind: to.kind, removed });
      }
    }
    changes.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `${property.name} of ${el.id} (${detail}) was dropped: a ${to.kind} has no ${property.name}`,
      element: el.id,
      ...(property.name === 'default' ? { hint: 'The flow still exists but is no longer marked as default.' } : {}),
    });
  }

  private dropDiagram(diagram: BpmnElement): void {
    this.edit.document.tree.definitions.remove('diagrams', diagram);
    this.edit.releaseIdsBelow(diagram);
  }

  private static isReappliedKindProp(name: string): boolean {
    return name === 'triggeredByEvent';
  }

  private swapType(el: BpmnElement, to: KindDefinition, changes: ChangeSet): BpmnElement {
    const next = this.edit.document.tree.build(to.type, { id: el.id });
    this.carryProperties(el, next, to, changes);
    Object.assign(next.attrs, el.attrs);
    new ElementContainment(el).detach(next);
    this.repointReferences(el, next);
    this.edit.replaceElement(el, next);
    this.edit.document.tree.invalidate();
    return next;
  }

  private carryProperties(el: BpmnElement, next: BpmnElement, to: KindDefinition, changes: ChangeSet): void {
    const nextProps = next.descriptor.propertiesByName ?? {};
    for (const property of el.descriptor.properties ?? []) {
      const value = el.peek(property.name);
      if (property.name === 'id' || ElementTypeChange.isUnset(value) || ElementTypeChange.isReappliedKindProp(property.name)) {
        continue;
      }
      if (nextProps[property.name]) {
        ElementTypeChange.copyProp(next, property, value);
      } else {
        this.dropProp(el, property, value, to, changes);
      }
    }
  }

  private static isUnset(value: unknown): boolean {
    return value === undefined || value === null || (Array.isArray(value) && !value.length);
  }

  private repointReferences(el: BpmnElement, next: BpmnElement): void {
    for (const ref of new ElementContainment(this.edit.document.tree.definitions).referencesToAny(new Set([el]))) {
      if (ref.holder.is('bpmndi:BPMNPlane') && !next.is('bpmn:SubProcess')) {
        this.dropDiagram(ref.holder.parent as BpmnElement);
        continue;
      }
      if (ref.isMany) {
        ref.holder.set(ref.prop, ref.holder.list(ref.prop).map((entry) => (entry === el ? next : entry)));
      } else {
        ref.holder.set(ref.prop, next);
      }
    }
  }
}
