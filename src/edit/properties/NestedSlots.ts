import { BpmnElement, BpmnError, CAMUNDA, ChangeEntries, type ChangeSet, ElementSlots, Kinds, type NestedSlot, PropertyCatalog, type SlotRef, Triggers, VendorDescriptor, ZEEBE, ZeebeDescriptor } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { IdRename } from './IdRename.js';
import { NestedResolution } from './NestedResolution.js';
import { PropertyCoercer } from './PropertyCoercer.js';

export class NestedSlots {
  private static readonly NESTED_BLOCKED: Record<string, string> = {
    body: 'use condition= / when= / timer= / cardinality= / completion=',
  };

  constructor(private readonly edit: EditSession) {}

  keysOf(slot: NestedSlot, target: BpmnElement): string[] {
    const keys = ['id', ...PropertyCatalog.of(target).genericKeys().filter((genericKey) => !NestedSlots.NESTED_BLOCKED[genericKey]), ...CAMUNDA.attrsFor(target).map((attr) => attr.name)];
    return [...new Set(keys)].map((slotKey) => `${slot}.${slotKey}`);
  }

  private create(el: BpmnElement, slot: NestedSlot, key: string, changes: ChangeSet): BpmnElement {
    const id = el.id;
    const local = new PropertyCoercer(this.edit).camundaLocal(key);
    if (slot === 'loop') {
      const multi = this.edit.document.tree.build('bpmn:MultiInstanceLoopCharacteristics');
      this.checkKey(el, slot, multi, key);
      multi.parent = el;
      el.set('loopCharacteristics', multi);
      changes.note(`${id}: created a parallel multi-instance loop for loop.${key}`);
      return multi;
    }
    if (slot === 'condition' && el.is('bpmn:SequenceFlow') && local === 'resource') {
      const expr = this.edit.document.tree.build('bpmn:FormalExpression');
      expr.parent = el;
      el.set('conditionExpression', expr);
      const source = el.get<BpmnElement | undefined>('sourceRef');
      if (source?.get<BpmnElement | undefined>('default') === el) {
        source.set('default', undefined);
        changes.change(ChangeEntries.of(el, `no longer the default flow of ${source.id}`));
      }
      return expr;
    }
    if (slot === 'definition') {
      const name = local ? `camunda:${local}` : undefined;
      const trigger = name ? (Kinds.of(el)?.triggers ?? []).find((candidate) => candidate !== 'none' && CAMUNDA.attrAppliesTo(name, Triggers.TABLE[candidate].definition)) : undefined;
      throw BpmnError.model('E_NO_NESTED_ELEMENT', `${Kinds.label(el)} ${id} has no event definition to set ${slot}.${key} on (it has no trigger)`, {
        element: id,
        hint: `Give it a trigger first: \`bpmn set <file> ${id} trigger=${trigger ?? '<trigger>'}\` (or in the same command, e.g. trigger=${trigger ?? 'message'} ${slot}.${key}=<value>).`,
      });
    }
    throw BpmnError.model('E_NO_NESTED_ELEMENT', `${Kinds.label(el)} ${id} has no condition to set ${slot}.${key} on`, {
      element: id,
      hint: el.is('bpmn:SequenceFlow')
        ? `Set the condition first (\`bpmn set <file> ${id} condition=<expression>\`), or make it a script resource condition with condition.camunda:resource=<uri> language=<lang>.`
        : `Set the condition first: \`bpmn set <file> ${id} when=<expression>\`.`,
    });
  }

  private checkKey(el: BpmnElement, slot: NestedSlot, target: BpmnElement, key: string, prefix: string = slot): void {
    this.assertNoZeebeOwner(el, target, key, prefix);
    if (key.includes(':')) {
      this.assertVendorKeyFits(el, slot, target, key, `${prefix}.${key}`);
      return;
    }
    if (key !== 'id') {
      NestedSlots.assertSettable(el, slot, target, key, prefix);
    }
  }

  private assertNoZeebeOwner(el: BpmnElement, target: BpmnElement, key: string, prefix: string): void {
    const zi = key.indexOf(':');
    if (zi <= 0 || this.edit.document.namespaces.uriOf(key.slice(0, zi)) !== ZeebeDescriptor.URI || ZEEBE.attr(key.slice(zi + 1))) {
      return;
    }
    const local = key.slice(zi + 1);
    const owner = ZEEBE.typeNames().find((typeName) => ZEEBE.allowedOn(typeName, target) === true && ZEEBE.type(typeName)!.attributes.some((attr) => attr.name === local));
    if (owner) {
      throw BpmnError.model('E_WRONG_HOST', `${key} is not an attribute of the ${Kinds.typeLabel(target)} of ${Kinds.label(el)} ${el.id}: Camunda 8 reads ${local} on its ${owner} extension element`, {
        element: el.id,
        hint: `Use \`bpmn ext add <file> ${el.id} ${prefix}.${key.slice(0, zi)}:${owner.slice('zeebe:'.length)} ${local}=<value>\`.`,
      });
    }
  }

  private assertVendorKeyFits(el: BpmnElement, slot: NestedSlot, target: BpmnElement, key: string, full: string): void {
    const id = el.id;
    const local = new PropertyCoercer(this.edit).camundaLocal(key);
    if (!local || CAMUNDA.attrAppliesTo(`camunda:${local}`, target) !== false) {
      return;
    }
    const owners = CAMUNDA.attr(local)?.owners ?? [];
    const multi = slot === 'loop' && owners.some((owner) => VendorDescriptor.typeIs('bpmn:MultiInstanceLoopCharacteristics', owner));
    throw BpmnError.model('E_WRONG_HOST', `${key} cannot be set on the ${Kinds.typeLabel(target)} of ${Kinds.label(el)} ${id}${multi ? ': it needs a multi-instance loop' : ''}`, {
      element: id,
      hint: NestedSlots.vendorKeyHint(el, key, full, multi, local, owners),
    });
  }

  private static vendorKeyHint(el: BpmnElement, key: string, full: string, multi: boolean, local: string, owners: readonly string[]): string {
    const id = el.id;
    if (multi) {
      return `Set loop=parallel or loop=sequential first (\`bpmn set <file> ${id} loop=parallel ${full}=<value>\`).`;
    }
    if (CAMUNDA.attrAppliesTo(`camunda:${local}`, el)) {
      return `It is an attribute of ${id} itself: \`bpmn set <file> ${id} ${key}=<value>\`.`;
    }
    return `${key} belongs on ${owners.map((owner) => owner.replace('bpmn:', '')).join(', ')}.`;
  }

  private static assertSettable(el: BpmnElement, slot: NestedSlot, target: BpmnElement, key: string, prefix: string): void {
    const property = target.descriptor.propertiesByName?.[key];
    const blocked = NestedSlots.NESTED_BLOCKED[key];
    if (property && !blocked && PropertyCatalog.of(target).isSettable(property)) {
      return;
    }
    const keys = ['id', ...PropertyCatalog.of(target).genericKeys().filter((genericKey) => !NestedSlots.NESTED_BLOCKED[genericKey])].map((slotKey) => `${prefix}.${slotKey}`);
    throw BpmnError.model('E_UNKNOWN_KEY', `Unknown key "${prefix}.${key}" for ${Kinds.label(el)} ${el.id}: a ${Kinds.typeLabel(target)} has no settable attribute ${key}${blocked ? ` (${blocked})` : ''}`, {
      element: el.id,
      candidates: keys,
      hint: `Keys of the ${ElementSlots.TEXT[slot]}: ${keys.join(', ')}, or a vendor attribute ${prefix}.<prefix>:<attr>.`,
    });
  }

  private static dropConditionBody(el: BpmnElement, expr: BpmnElement, changes: ChangeSet, key = 'camunda:resource'): void {
    const body = expr.get<string | undefined>('body');
    if (!body) {
      return;
    }
    expr.set('body', undefined);
    changes.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `The condition "${body}" of ${el.id} was dropped: a script resource condition has no inline body`,
      element: el.id,
      hint: `To go back to an inline condition remove the resource and set the body in one command: \`bpmn set <file> ${el.id} condition.${key}= '${el.is('bpmn:SequenceFlow') ? 'condition' : 'when'}=<expression>'\`.`,
    });
  }

  private assertConditionKept(el: BpmnElement, target: BpmnElement, key: string, full: string): void {
    if (!new PropertyCoercer(this.edit).isResourceKey(key) || new PropertyCoercer(this.edit).resourceKeyOf(target) !== key) {
      return;
    }
    if (target.get<string | undefined>('body')?.trim()) {
      return;
    }
    const id = el.id;
    const flow = el.is('bpmn:SequenceFlow');
    throw PropertyCoercer.invalidValue(el,
      full,
      `removing the script resource ${String(target.attrs[key])} would leave ${flow ? 'the condition' : 'the condition of the conditional event'} empty (it has no inline body); the engines would fail every evaluation of an empty condition`,
      flow
        ? `Replace it with an inline condition in the same command: \`bpmn set <file> ${id} ${full}= 'condition=\${...}'\`, or remove the whole condition: \`bpmn set <file> ${id} condition=\`.`
        : `Replace it with an inline condition in the same command: \`bpmn set <file> ${id} ${full}= 'when=\${...}'\` (a conditional event always needs a condition), or point it at another script: \`bpmn set <file> ${id} ${full}=<uri>\`.`);
  }

  setKey(el: BpmnElement, slot: string, key: string, value: string, changes: ChangeSet, replacing = false): void {
    const full = `${slot}.${key}`;
    const coercedValue = key.includes(':') ? new PropertyCoercer(this.edit).vendorValue(el, key, value, full) : value;
    const slots = ElementSlots.slotsOf(el);
    const ref = ElementSlots.parseRef(slot);
    if (!ref || !slots.includes(ref.slot) || !key) {
      throw PropertyCatalog.of(el).unknownKey(full, slots.length ? `nested keys of a ${Kinds.label(el)} start with ${slots.map((slotName) => `${slotName}.`).join(' or ')}` : `a ${Kinds.label(el)} has no nested element to address`);
    }
    const resolved = new NestedResolution(el, ref, full).resolve();
    if (!resolved && !coercedValue) {
      return;
    }
    const target = resolved ?? this.create(el, ref.slot, key, changes);
    if (coercedValue) {
      this.checkKey(el, ref.slot, target, key, ref.text);
    }
    this.guardCondition(el, ref.slot, target, key, coercedValue, full, replacing, changes);
    this.writeKey(el, ref, target, key, coercedValue, full);
    changes.change(ChangeEntries.of(el, coercedValue ? `${full}=${coercedValue}` : `${full} removed`));
  }

  private guardCondition(el: BpmnElement, slot: NestedSlot, target: BpmnElement, key: string, value: string, full: string, replacing: boolean, changes: ChangeSet): void {
    if (slot !== 'condition') {
      return;
    }
    if (value && new PropertyCoercer(this.edit).isResourceKey(key)) {
      NestedSlots.dropConditionBody(el, target, changes, key);
    }
    if (!value && !replacing) {
      this.assertConditionKept(el, target, key, full);
    }
  }

  private writeKey(el: BpmnElement, ref: SlotRef, target: BpmnElement, key: string, value: string, full: string): void {
    if (key.includes(':')) {
      PropertyCatalog.of(target).assertVendorKey(key);
      new PropertyCoercer(this.edit).setVendorAttribute(target, key, value);
    } else if (key === 'id') {
      this.writeId(el, target, value, full);
    } else if (!PropertyCoercer.removeUndefined(target, key, value)) {
      this.writeProperty(el, ref, target, key, value, full);
    }
  }

  private writeId(el: BpmnElement, target: BpmnElement, value: string, full: string): void {
    if (!value) {
      throw PropertyCoercer.invalidValue(el, full, 'an id cannot be empty');
    }
    if (target.id) {
      new IdRename(this.edit).rename(target, value);
    } else {
      this.edit.allocator.claim(value);
      target.set('id', value);
    }
  }

  private writeProperty(el: BpmnElement, ref: SlotRef, target: BpmnElement, key: string, value: string, full: string): void {
    this.checkKey(el, ref.slot, target, key, ref.text);
    const property = target.descriptor.propertiesByName![key]!;
    const coerced = value ? new PropertyCoercer(this.edit).coerce(el, property, value, full) : undefined;
    if (target.is('bpmn:CompensateEventDefinition') && key === 'activityRef' && coerced instanceof BpmnElement) {
      this.assertCompensationInScope(el, coerced, full);
    }
    target.set(key, coerced);
  }

  private assertCompensationInScope(event: BpmnElement, activity: BpmnElement, full: string): void {
    if (!activity.is('bpmn:Activity')) {
      return;
    }
    const scope = this.edit.document.scopes.scopeOf(event);
    if (!scope) {
      return;
    }
    const scopes = [scope];
    if (scope.is('bpmn:SubProcess') && scope.get<boolean | undefined>('triggeredByEvent')) {
      const outer = this.edit.document.scopes.scopeOf(scope);
      if (outer) {
        scopes.push(outer);
      }
    }
    const actual = this.edit.document.scopes.scopeOf(activity);
    if (actual && scopes.includes(actual)) {
      return;
    }
    const candidates = scopes.flatMap((sc) => sc.list('flowElements').filter((flowElement) => flowElement.is('bpmn:Activity') && !(flowElement.is('bpmn:SubProcess') && flowElement.get<boolean | undefined>('triggeredByEvent'))).map((element) => element.id));
    const id = event.id;
    throw BpmnError.model('E_CROSS_SCOPE', `${full}=${activity.id}: ${activity.id} is in ${actual ? actual.id : '?'}, not in the scope of ${id} (${scopes.map((element) => element.id).join(' / ')}); a compensation event can only compensate activities of its own scope`, {
      element: id,
      related: [activity.id],
      candidates,
      hint: `Name an activity of ${scopes.map((element) => element.id).join(' or ')}: ${candidates.join(', ') || 'none'}. To compensate ${activity.id}, throw the compensation inside ${actual ? actual.id : 'its scope'} (e.g. an event sub-process or an intermediate throw event there). The engines refuse the file otherwise.`,
    });
  }
}
