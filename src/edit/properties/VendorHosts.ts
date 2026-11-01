import { type BpmnElement, BpmnError, CAMUNDA, ElementSlots, Kinds, type NestedSlot, type Trigger, Triggers, ZEEBE, ZeebeDescriptor } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { PropertyCoercer } from './PropertyCoercer.js';

export class VendorHosts {
  constructor(private readonly edit: EditSession) {}

  private static shellPair(key: string, value: string): string {
    const pair = `${key}=${value}`;
    return /^[\w.:/,-]*$/.test(value) && /^[\w.:-]*$/.test(key) ? pair : `'${pair.replace(/'/g, "'\\''")}'`;
  }

  private static placeFor(el: BpmnElement, name: string): { slot?: NestedSlot; prefix?: string; trigger?: Exclude<Trigger, 'none'>; element?: BpmnElement } | undefined {
    if (el.is('bpmn:Event')) {
      const defs = ElementSlots.definitionsOf(el);
      const fit = defs.findIndex((definition) => CAMUNDA.attrAppliesTo(name, definition));
      if (fit !== -1) {
        return { slot: 'definition', prefix: defs.length > 1 ? `definition[${fit}]` : 'definition' };
      }
      if (ElementSlots.slotsOf(el).includes('condition') && CAMUNDA.attrAppliesTo(name, 'bpmn:FormalExpression')) {
        return { slot: 'condition' };
      }
      const current = Triggers.of(el);
      for (const trigger of Kinds.of(el)?.triggers ?? []) {
        if (trigger === 'none' || trigger === current) {
          continue;
        }
        if (CAMUNDA.attrAppliesTo(name, Triggers.TABLE[trigger].definition)) {
          return { slot: 'definition', trigger };
        }
      }
    }
    if (el.is('bpmn:Activity') && CAMUNDA.attrAppliesTo(name, 'bpmn:MultiInstanceLoopCharacteristics')) {
      return { slot: 'loop' };
    }
    if (el.is('bpmn:SequenceFlow') && CAMUNDA.attrAppliesTo(name, 'bpmn:FormalExpression')) {
      return { slot: 'condition' };
    }
    if (el.is('bpmn:Participant')) {
      const process = el.get<BpmnElement | undefined>('processRef');
      if (process && CAMUNDA.attrAppliesTo(name, process)) {
        return { element: process };
      }
    }
    return undefined;
  }

  assertVendorHost(el: BpmnElement, key: string, value: string): void {
    const local = new PropertyCoercer(this.edit).camundaLocal(key);
    if (!local) {
      return;
    }
    const name = `camunda:${local}`;
    if (CAMUNDA.attrAppliesTo(name, el) !== false) {
      return;
    }
    const place = VendorHosts.placeFor(el, name);
    if (!place) {
      return;
    }
    const id = el.id;
    if (place.element) {
      throw BpmnError.model('E_WRONG_HOST', `${key} is an attribute of the process, not of participant ${id}`, {
        element: id,
        related: [place.element.id],
        hint: `Use \`bpmn set <file> ${place.element.id} ${VendorHosts.shellPair(key, value)}\`.`,
      });
    }
    const slot = place.slot!;
    throw BpmnError.model('E_WRONG_HOST', `${key} does not belong on ${Kinds.label(el)} ${id}: it is an attribute of its ${ElementSlots.TEXT[slot]}${place.trigger ? ` (${Triggers.TABLE[place.trigger].definition.replace('bpmn:', '')})` : ''}`, {
      element: id,
      hint: `Use \`bpmn set <file> ${id} ${place.trigger ? `trigger=${place.trigger} ` : ''}${VendorHosts.shellPair(`${place.prefix ?? slot}.${key}`, value)}\`${place.trigger ? ` (${id} needs a ${place.trigger} trigger for it)` : ''}.`,
    });
  }

  assertZeebeHost(el: BpmnElement, key: string, value: string): void {
    const idx = key.indexOf(':');
    if (idx <= 0 || this.edit.document.namespaces.uriOf(key.slice(0, idx)) !== ZeebeDescriptor.URI) {
      return;
    }
    const local = key.slice(idx + 1);
    if (ZEEBE.attr(local)) {
      return;
    }
    const prefix = key.slice(0, idx);
    const id = el.id;
    const pair = VendorHosts.shellPair(local, value);
    const owners = ZEEBE.typeNames().filter((typeName) => ZEEBE.type(typeName)!.attributes.some((attr) => attr.name === local));
    const here = owners.filter((typeName) => ZEEBE.allowedOn(typeName, el) === true);
    const loop = el.is('bpmn:Activity') && owners.includes('zeebe:loopCharacteristics');
    const message = owners.includes('zeebe:subscription') && (el.is('bpmn:ReceiveTask') || el.is('bpmn:Event'));
    if (!here.length && !loop && !message) {
      return;
    }
    const target = here[0] ?? (loop ? 'zeebe:loopCharacteristics' : 'zeebe:subscription');
    const type = `${prefix}:${target.slice('zeebe:'.length)}`;
    const command = here.length
      ? `\`bpmn ext add <file> ${id} ${type} ${pair}\``
      : loop
        ? `\`bpmn ext add <file> ${id} loop.${type} ${pair}\` (creates a parallel multi-instance loop when there is none)`
        : el.is('bpmn:ReceiveTask') || ElementSlots.definitionsOf(el).some((definition) => definition.is('bpmn:MessageEventDefinition'))
          ? `\`bpmn set <file> ${id} message=<MessageName>\` first (the correlation key belongs to the message the element waits for), then \`bpmn set <file> ${id} ${VendorHosts.shellPair(key, value)}\``
          : `\`bpmn ext add <file> <messageId> ${type} ${pair}\` on a bpmn:Message (${Kinds.label(el)} ${id} waits for no message)`;
    throw BpmnError.model('E_WRONG_HOST', `${key} is not an attribute of ${Kinds.label(el)} ${id}: Camunda 8 reads ${local} on the ${type} extension element`, {
      element: id,
      hint: `Use ${command}.`,
    });
  }
}
