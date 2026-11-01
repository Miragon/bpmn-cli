import { BpmnElement, BpmnError, CAMUNDA, ChangeEntries, ChangeSet, ElementText, ElementWalk, type Finding, type KindDefinition, KindParser, Kinds, type PropertyDescriptor, type Trigger, type TriggerOptions, Triggers, ZEEBE, ZeebeDescriptor } from '../model/index.js';
import type { RetypeOperation } from '../operations/index.js';
import { ElementContainment } from './containers/ElementContainment.js';
import { ElementRemoval } from './ElementRemoval.js';
import { Camunda8Defaults } from './events/Camunda8Defaults.js';
import { RootElements } from './events/RootElements.js';
import { TriggerChange } from './events/TriggerChange.js';
import { TriggerKeys } from './events/TriggerKeys.js';
import { SequenceFlows } from './flows/SequenceFlows.js';
import type { EditSession } from './session/EditSession.js';

const ACTIVITY_FAMILIES = new Set(['task', 'subProcess', 'callActivity']);

export class ElementTypeChange {
  constructor(private readonly edit: EditSession) {}

  private static eventPosition(def: KindDefinition): string {
    return def.kind === 'intermediateCatchEvent' || def.kind === 'intermediateThrowEvent' ? 'intermediate' : def.kind;
  }

  private static incompatibility(from: KindDefinition, to: KindDefinition): string | undefined {
    if (ACTIVITY_FAMILIES.has(from.family) && ACTIVITY_FAMILIES.has(to.family)) {
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
    const id = el.id;
    const from = Kinds.of(el);
    if (!from) {
      throw BpmnError.model('E_INVALID_RETYPE', `${el.type} ${id} cannot be retyped`, {
        element: id,
        hint: 'Only tasks, sub-processes, call activities, gateways and events can be retyped.',
      });
    }
    let parsed;
    try {
      parsed = KindParser.parse(command.kind);
    } catch (err) {
      if (err instanceof BpmnError) {
        throw BpmnError.model('E_UNKNOWN_KIND', err.message, { element: id, candidates: err.details.candidates ?? [], hint: 'Run `bpmn kinds` for the list of kinds.' });
      }
      throw err;
    }
    const to = parsed.def;
    const reason = ElementTypeChange.incompatibility(from, to);
    if (reason) {
      throw BpmnError.model('E_INVALID_RETYPE', `Cannot retype ${Kinds.label(el)} ${id} to ${to.kind}: ${reason}`, {
        element: id,
        hint: `Remove the element and add a new one of the wanted kind instead (\`bpmn remove <file> ${id}\`, then \`bpmn add <file> <kind> ...\`).`,
      });
    }
    const oldLabel = Kinds.label(el);
    const keys = command.set ?? {};
    const trigger = ElementTypeChange.resolveTrigger(el, to, parsed.trigger);
    const given = TriggerKeys.optionsOf(keys, el);
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
    const oldTrigger = Triggers.of(el);
    const sameTrigger = trigger === oldTrigger;
    if (from === to && sameTrigger && !hasTriggerOptions) {
      changes.note(`${id} is already a ${oldLabel}; nothing changed${oldLabel.includes(':') ? ' (to drop the trigger use `<kind>:none` or `bpmn set <file> <id> trigger=none`)' : ''}`);
      RootElements.bindRefAs(changes, command.refAs, el);
      return changes;
    }
    if (to.kind === 'eventSubProcess' && (this.edit.document.flows.incoming(el).length || this.edit.document.flows.outgoing(el).length)) {
      throw BpmnError.model('E_INVALID_RETYPE', `${id} has sequence flows; event sub-processes cannot be connected by sequence flows`, {
        element: id,
        candidates: [...this.edit.document.flows.incoming(el), ...this.edit.document.flows.outgoing(el)].map((element) => element.id),
        hint: `Remove its flows first: \`bpmn remove <file> ${[...this.edit.document.flows.incoming(el), ...this.edit.document.flows.outgoing(el)].map((element) => element.id).join(' ')}\`.`,
      });
    }

    const change = new TriggerChange(this.edit, el);
    const target = to.type === el.type ? el : this.swapType(el, to, changes);
    ElementTypeChange.applyKindProps(target, from, to);
    if (target !== el) {
      changes.replaced.push({ from: el, to: target });
      const inapplicable = this.inapplicableCamundaContent(target, to);
      if (inapplicable) {
        changes.warn(inapplicable);
      }
      if (new Camunda8Defaults(this.edit).userTask(target)) {
        changes.note(`${id} is a Camunda user task now (zeebe:userTask added, like Camunda Modeler)`);
      }
    }
    new SequenceFlows(this.edit).dropIgnoredConditions(target, changes);
    change.change(trigger !== undefined && (!sameTrigger || hasTriggerOptions) ? trigger : undefined, given, changes, { on: target });
    this.edit.document.tree.invalidate();
    const detail =
      from === to && sameTrigger
        ? `trigger options updated (${givenKeys.map((givenKey) => `${givenKey}=${String(given[givenKey])}`).join(' ')})`
        : `retyped from ${oldLabel} to ${Kinds.label(target)}`;
    changes.change(ChangeEntries.of(target, detail));
    RootElements.bindRefAs(changes, command.refAs, target);
    return changes;
  }

  private camundaName(name: string): string | undefined {
    const idx = name.indexOf(':');
    if (idx <= 0 || !CAMUNDA.reads(this.edit.document.namespaces.uriOf(name.slice(0, idx)))) {
      return undefined;
    }
    return `camunda:${name.slice(idx + 1)}`;
  }

  private zeebeLocal(name: string): string | undefined {
    const idx = name.indexOf(':');
    if (idx <= 0 || this.edit.document.namespaces.uriOf(name.slice(0, idx)) !== ZeebeDescriptor.URI) {
      return undefined;
    }
    return name.slice(idx + 1);
  }

  private inapplicableCamundaContent(el: BpmnElement, to: KindDefinition): Finding | undefined {
    const attrs = Object.keys(ElementText.vendorAttributes(el)).filter((key) => {
      const name = this.camundaName(key);
      if (name) {
        return CAMUNDA.attrAppliesTo(name, el) === false;
      }
      const zeebeName = this.zeebeLocal(key);
      const def = zeebeName ? ZEEBE.attr(zeebeName) : undefined;
      return !!def && !def.owners.some((owner) => el.is(owner));
    });
    const exts: string[] = [];
    for (const ext of el.get<BpmnElement | undefined>('extensionElements')?.get<BpmnElement[] | undefined>('values') ?? []) {
      const name = this.camundaName(ext.type);
      const zeebeName = name ? undefined : this.zeebeLocal(ext.type);
      const misplaced = name ? CAMUNDA.allowedOn(name, el) === false : zeebeName ? ZEEBE.allowedOn(zeebeName, el) === false && !ZEEBE.nestedOnly(zeebeName) : false;
      if (misplaced && !exts.includes(ext.type)) {
        exts.push(ext.type);
      }
    }
    const names = [...attrs, ...exts];
    if (!names.length) {
      return undefined;
    }
    const id = el.id;
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
    return warning;
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
        this.edit.recordDroppedContent({ element: el.id, kind: to.kind, removed });
      }
    }
    changes.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `${property.name} of ${el.id} (${detail}) was dropped: a ${to.kind} has no ${property.name}`,
      element: el.id,
      ...(property.name === 'default' ? { hint: 'The flow still exists but is no longer marked as default.' } : {}),
    });
  }

  private dropDiagram(diagram: BpmnElement | undefined): void {
    if (!diagram || !diagram.is('bpmndi:BPMNDiagram')) {
      return;
    }
    this.edit.document.tree.definitions.remove('diagrams', diagram);
    for (const element of new ElementWalk(diagram).depthFirst()) {
      const id = element.get<string | undefined>('id');
      if (id) {
        this.edit.document.ids.registry.release(id);
      }
    }
  }

  private static isReappliedKindProp(name: string): boolean {
    return name === 'triggeredByEvent';
  }

  private swapType(el: BpmnElement, to: KindDefinition, changes: ChangeSet): BpmnElement {
    const next = this.edit.document.tree.build(to.type, { id: el.id });
    const nextProps = next.descriptor.propertiesByName ?? {};
    for (const property of el.descriptor.properties ?? []) {
      if (property.name === 'id') {
        continue;
      }
      const value = el.peek(property.name);
      if (value === undefined || value === null || (Array.isArray(value) && !value.length)) {
        continue;
      }
      if (ElementTypeChange.isReappliedKindProp(property.name)) {
        continue;
      }
      if (nextProps[property.name]) {
        ElementTypeChange.copyProp(next, property, value);
      } else {
        this.dropProp(el, property, value, to, changes);
      }
    }
    Object.assign(next.attrs, el.attrs);
    ElementContainment.detach(el, next);
    for (const ref of ElementContainment.referencesToAny(this.edit.document.tree.definitions, new Set([el]))) {
      if (ref.holder.is('bpmndi:BPMNPlane') && !next.is('bpmn:SubProcess')) {
        this.dropDiagram(ref.holder.parent);
        continue;
      }
      if (ref.isMany) {
        ref.holder.set(ref.prop, ref.holder.list(ref.prop).map((entry) => (entry === el ? next : entry)));
      } else {
        ref.holder.set(ref.prop, next);
      }
    }
    this.edit.replaceElement(el, next);
    this.edit.document.tree.invalidate();
    return next;
  }
}
