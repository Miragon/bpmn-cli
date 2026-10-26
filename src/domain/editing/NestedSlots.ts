import { PropertyCoercer } from './PropertyCoercer.js';
import type { Doc } from '../document/Doc.js';
import type { EditContext } from '../document/EditContext.js';
import { modelError } from '../document/utils/errors.js';
import { IdRenameService } from './IdRenameService.js';
import { kindLabel, kindOf, TRIGGER_TYPES } from '../document/utils/kinds.js';
import { is, many, type El } from '../document/utils/moddle.js';
import { ChangeSet } from '../document/ChangeSet.js';
import { descriptorOf, idOf, isEl, typeLabel } from '../document/utils/elements.js';
import { parseSlotRef, resolveNested, slotsOf, SLOT_TEXT, type NestedSlot } from '../document/utils/nested-slots.js';
import { CAMUNDA } from '../document/vendor/CamundaDescriptor.js';
import { VendorDescriptor } from '../document/vendor/VendorDescriptor.js';
import { ZEEBE, ZEEBE_URI } from '../document/vendor/ZeebeDescriptor.js';

/** Keys of a nested element that have their own set key (or are generated). */
const NESTED_BLOCKED: Record<string, string> = {
  body: 'use condition= / when= / timer= / cardinality= / completion=',
};

/**
 * The `<slot>.<key>` keys of `set` (`definition.`, `loop.`, `condition.`): attributes of nested
 * elements without an id of their own, checked against the BPMN type and the vendor
 * descriptors; the nested element is created where a key needs it.
 */
export class NestedSlots {
  private readonly coercer: PropertyCoercer;

  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext,
  ) {
    this.coercer = new PropertyCoercer(doc, edit);
  }

  /** Other vendors' attributes are accepted too, unchecked. */
  keysOf(slot: NestedSlot, target: El): string[] {
    const keys = ['id', ...this.coercer.genericKeys(target).filter((genericKey) => !NESTED_BLOCKED[genericKey]), ...CAMUNDA.attrsFor(target).map((attr) => attr.name)];
    return [...new Set(keys)].map((slotKey) => `${slot}.${slotKey}`);
  }

  private create(el: El, slot: NestedSlot, key: string, cs: ChangeSet): El {
    const id = idOf(el);
    const local = this.coercer.camundaLocal(key);
    if (slot === 'loop') {
      const multi = this.doc.moddle.create('bpmn:MultiInstanceLoopCharacteristics');
      this.checkKey(el, slot, multi, key);
      multi.$parent = el;
      el.set('loopCharacteristics', multi);
      cs.note(`${id}: created a parallel multi-instance loop for loop.${key}`);
      return multi;
    }
    if (slot === 'condition' && is(el, 'bpmn:SequenceFlow') && local === 'resource') {
      const expr = this.doc.moddle.create('bpmn:FormalExpression');
      expr.$parent = el;
      el.set('conditionExpression', expr);
      const source = el.get<El | undefined>('sourceRef');
      if (source?.get<El | undefined>('default') === el) {
        source.set('default', undefined);
        cs.change(ChangeSet.entryOf(el, `no longer the default flow of ${idOf(source)}`));
      }
      return expr;
    }
    if (slot === 'definition') {
      const name = local ? `camunda:${local}` : undefined;
      const trigger = name ? (kindOf(el)?.triggers ?? []).find((candidate) => candidate !== 'none' && CAMUNDA.attrAppliesTo(name, TRIGGER_TYPES[candidate])) : undefined;
      throw modelError('E_NO_NESTED_ELEMENT', `${kindLabel(el)} ${id} has no event definition to set ${slot}.${key} on (it has no trigger)`, {
        element: id,
        hint: `Give it a trigger first: \`bpmn set <file> ${id} trigger=${trigger ?? '<trigger>'}\` (or in the same command, e.g. trigger=${trigger ?? 'message'} ${slot}.${key}=<value>).`,
      });
    }
    throw modelError('E_NO_NESTED_ELEMENT', `${kindLabel(el)} ${id} has no condition to set ${slot}.${key} on`, {
      element: id,
      hint: is(el, 'bpmn:SequenceFlow')
        ? `Set the condition first (\`bpmn set <file> ${id} condition=<expression>\`), or make it a script resource condition with condition.camunda:resource=<uri> language=<lang>.`
        : `Set the condition first: \`bpmn set <file> ${id} when=<expression>\`.`,
    });
  }

  /** Checks one nested key; a zeebe setting of a nested element is its extension element (loop.zeebe:...). */
  private checkKey(el: El, slot: NestedSlot, target: El, key: string, prefix: string = slot): void {
    const id = idOf(el);
    const full = `${prefix}.${key}`;
    const zi = key.indexOf(':');
    if (zi > 0 && this.doc.namespaceUri(key.slice(0, zi)) === ZEEBE_URI && !ZEEBE.attr(key.slice(zi + 1))) {
      const local = key.slice(zi + 1);
      const owner = ZEEBE.typeNames().find((typeName) => ZEEBE.allowedOn(typeName, target) === true && ZEEBE.type(typeName)!.attributes.some((attr) => attr.name === local));
      if (owner) {
        throw modelError('E_WRONG_HOST', `${key} is not an attribute of the ${typeLabel(target)} of ${kindLabel(el)} ${id}: Camunda 8 reads ${local} on its ${owner} extension element`, {
          element: id,
          hint: `Use \`bpmn ext add <file> ${id} ${prefix}.${key.slice(0, zi)}:${owner.slice('zeebe:'.length)} ${local}=<value>\`.`,
        });
      }
    }
    if (key.includes(':')) {
      const local = this.coercer.camundaLocal(key);
      if (!local || CAMUNDA.attrAppliesTo(`camunda:${local}`, target) !== false) return;
      const owners = CAMUNDA.attr(local)?.owners ?? [];
      const onElement = CAMUNDA.attrAppliesTo(`camunda:${local}`, el);
      const multi = slot === 'loop' && owners.some((owner) => VendorDescriptor.typeIs('bpmn:MultiInstanceLoopCharacteristics', owner));
      throw modelError('E_WRONG_HOST', `${key} cannot be set on the ${typeLabel(target)} of ${kindLabel(el)} ${id}${multi ? ': it needs a multi-instance loop' : ''}`, {
        element: id,
        hint: multi
          ? `Set loop=parallel or loop=sequential first (\`bpmn set <file> ${id} loop=parallel ${full}=<value>\`).`
          : onElement
            ? `It is an attribute of ${id} itself: \`bpmn set <file> ${id} ${key}=<value>\`.`
            : `${key} belongs on ${owners.map((owner) => owner.replace('bpmn:', '')).join(', ')}.`,
      });
    }
    if (key === 'id') return;
    const property = descriptorOf(target).propertiesByName?.[key];
    const blocked = NESTED_BLOCKED[key];
    if (!property || blocked || !this.coercer.isSettable(property)) {
      const keys = ['id', ...this.coercer.genericKeys(target).filter((genericKey) => !NESTED_BLOCKED[genericKey])].map((slotKey) => `${prefix}.${slotKey}`);
      throw modelError('E_UNKNOWN_KEY', `Unknown key "${full}" for ${kindLabel(el)} ${id}: a ${typeLabel(target)} has no settable attribute ${key}${blocked ? ` (${blocked})` : ''}`, {
        element: id,
        candidates: keys,
        hint: `Keys of the ${SLOT_TEXT[slot]}: ${keys.join(', ')}, or a vendor attribute ${prefix}.<prefix>:<attr>.`,
      });
    }
  }

  /** A script resource condition has no inline body. */
  private static dropConditionBody(el: El, expr: El, cs: ChangeSet, key = 'camunda:resource'): void {
    const body = expr.get<string | undefined>('body');
    if (!body) return;
    expr.set('body', undefined);
    cs.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `The condition "${body}" of ${idOf(el)} was dropped: a script resource condition has no inline body`,
      element: idOf(el),
      hint: `To go back to an inline condition remove the resource and set the body in one command: \`bpmn set <file> ${idOf(el)} condition.${key}= '${is(el, 'bpmn:SequenceFlow') ? 'condition' : 'when'}=<expression>'\`.`,
    });
  }

  /**
   * An empty condition deploys, but every evaluation fails ("condition script returns null"),
   * so removing the only script resource needs an inline condition in the same command.
   */
  private assertConditionKept(el: El, target: El, key: string, full: string): void {
    if (!this.coercer.isResourceKey(key) || this.coercer.resourceKeyOf(target) !== key) return;
    if (target.get<string | undefined>('body')?.trim()) return;
    const id = idOf(el);
    const flow = is(el, 'bpmn:SequenceFlow');
    throw PropertyCoercer.invalid(
      el,
      full,
      `removing the script resource ${String(target.$attrs[key])} would leave ${flow ? 'the condition' : 'the condition of the conditional event'} empty (it has no inline body); the engines would fail every evaluation of an empty condition`,
      flow
        ? `Replace it with an inline condition in the same command: \`bpmn set <file> ${id} ${full}= 'condition=\${...}'\`, or remove the whole condition: \`bpmn set <file> ${id} condition=\`.`
        : `Replace it with an inline condition in the same command: \`bpmn set <file> ${id} ${full}= 'when=\${...}'\` (a conditional event always needs a condition), or point it at another script: \`bpmn set <file> ${id} ${full}=<uri>\`.`,
    );
  }

  /** `replacing`: the same command sets the inline condition, so nothing is left empty. */
  apply(el: El, slot: string, key: string, value: string, cs: ChangeSet, replacing = false): void {
    const full = `${slot}.${key}`;
    if (key.includes(':')) value = this.coercer.vendorValue(el, key, value, full);
    const slots = slotsOf(el);
    const ref = parseSlotRef(slot);
    if (!ref || !slots.includes(ref.slot) || !key) {
      throw this.coercer.unknownKey(el, full, slots.length ? `nested keys of a ${kindLabel(el)} start with ${slots.map((slotName) => `${slotName}.`).join(' or ')}` : `a ${kindLabel(el)} has no nested element to address`);
    }
    const refSlot = ref.slot;
    let target = resolveNested(el, ref, full);
    if (!target) {
      const nothingToRemove = !value;
      if (nothingToRemove) return;
      target = this.create(el, refSlot, key, cs);
    }
    if (value) this.checkKey(el, refSlot, target, key, ref.text);
    if (refSlot === 'condition' && value && this.coercer.isResourceKey(key)) NestedSlots.dropConditionBody(el, target, cs, key);
    if (refSlot === 'condition' && !value && !replacing) this.assertConditionKept(el, target, key, full);
    if (key.includes(':')) {
      this.coercer.setVendorAttribute(target, key, value);
    } else if (key === 'id') {
      if (!value) throw PropertyCoercer.invalid(el, full, 'an id cannot be empty');
      if (idOf(target)) new IdRenameService(this.doc, this.edit).rename(target, value);
      else {
        this.edit.allocator.claim(value);
        target.set('id', value);
      }
    } else if (!PropertyCoercer.removeUndefined(target, key, value)) {
      this.checkKey(el, refSlot, target, key, ref.text);
      const property = descriptorOf(target).propertiesByName![key]!;
      const coerced = value ? this.coercer.coerce(el, property, value, full) : undefined;
      if (is(target, 'bpmn:CompensateEventDefinition') && key === 'activityRef' && isEl(coerced)) this.assertCompensationInScope(el, coerced, full);
      target.set(key, coerced);
    }
    cs.change(ChangeSet.entryOf(el, value ? `${full}=${value}` : `${full} removed`));
  }

  /**
   * BPMN 2.0 and Camunda 7 / CIB seven / Operaton: a compensation event compensates only
   * activities of its own scope (from an event sub-process also the scope around it).
   */
  private assertCompensationInScope(event: El, activity: El, full: string): void {
    if (!is(activity, 'bpmn:Activity')) return;
    const scope = this.doc.scopeOf(event);
    if (!scope) return;
    const scopes = [scope];
    if (is(scope, 'bpmn:SubProcess') && scope.get<boolean | undefined>('triggeredByEvent')) {
      const outer = this.doc.scopeOf(scope);
      if (outer) scopes.push(outer);
    }
    const actual = this.doc.scopeOf(activity);
    if (actual && scopes.includes(actual)) return;
    const candidates = scopes.flatMap((sc) => many(sc, 'flowElements').filter((flowElement) => is(flowElement, 'bpmn:Activity') && !(is(flowElement, 'bpmn:SubProcess') && flowElement.get<boolean | undefined>('triggeredByEvent'))).map(idOf));
    const id = idOf(event);
    throw modelError('E_CROSS_SCOPE', `${full}=${idOf(activity)}: ${idOf(activity)} is in ${actual ? idOf(actual) : '?'}, not in the scope of ${id} (${scopes.map(idOf).join(' / ')}); a compensation event can only compensate activities of its own scope`, {
      element: id,
      related: [idOf(activity)],
      candidates,
      hint: `Name an activity of ${scopes.map(idOf).join(' or ')}: ${candidates.join(', ') || 'none'}. To compensate ${idOf(activity)}, throw the compensation inside ${actual ? idOf(actual) : 'its scope'} (e.g. an event sub-process or an intermediate throw event there). The engines refuse the file otherwise.`,
    });
  }
}
