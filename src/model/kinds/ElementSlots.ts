import type { BpmnElement } from '../document/BpmnElement.js';
import { Triggers, type DefinedTrigger } from './Triggers.js';

export type NestedSlot = 'definition' | 'loop' | 'condition';

export interface SlotRef {
  slot: NestedSlot;
  text: string;
  index?: number;
  trigger?: DefinedTrigger;
  invalid?: string;
}

export class ElementSlots {
  static readonly NAMES: readonly NestedSlot[] = ['definition', 'loop', 'condition'];

  static readonly TEXT: Readonly<Record<NestedSlot, string>> = {
    definition: 'event definition',
    loop: 'loop characteristics',
    condition: 'condition expression',
  };

  static readonly TYPES: Readonly<Record<NestedSlot, readonly string[]>> = {
    definition: [
      'bpmn:MessageEventDefinition',
      'bpmn:TimerEventDefinition',
      'bpmn:ErrorEventDefinition',
      'bpmn:SignalEventDefinition',
      'bpmn:EscalationEventDefinition',
      'bpmn:ConditionalEventDefinition',
      'bpmn:LinkEventDefinition',
      'bpmn:CompensateEventDefinition',
      'bpmn:TerminateEventDefinition',
      'bpmn:CancelEventDefinition',
    ],
    loop: ['bpmn:MultiInstanceLoopCharacteristics', 'bpmn:StandardLoopCharacteristics'],
    condition: ['bpmn:FormalExpression'],
  };

  static splitKey(key: string): { slot: string; key: string } | undefined {
    const selector = /^(\w+\[[^\]]*\])\.(.*)$/.exec(key);
    if (selector) {
      return { slot: selector[1]!, key: selector[2]! };
    }
    const dot = key.indexOf('.');
    if (dot <= 0) {
      return undefined;
    }
    const colon = key.indexOf(':');
    const vendorAttributeWithDotInName = colon >= 0 && colon < dot;
    if (vendorAttributeWithDotInName) {
      return undefined;
    }
    return { slot: key.slice(0, dot), key: key.slice(dot + 1) };
  }

  static parseRef(text: string): SlotRef | undefined {
    const match = /^(\w+)(?:\[\s*([^\]]*?)\s*\])?$/.exec(text.trim());
    if (!match || !(ElementSlots.NAMES as readonly string[]).includes(match[1]!)) {
      return undefined;
    }
    const ref: SlotRef = { slot: match[1] as NestedSlot, text: text.trim() };
    const sel = match[2];
    if (sel === undefined) {
      return ref;
    }
    if (/^\d+$/.test(sel)) {
      ref.index = Number(sel);
    } else {
      const trigger = Triggers.normalize(sel);
      if (trigger && trigger !== 'none') {
        ref.trigger = trigger;
      } else {
        ref.invalid = sel;
      }
    }
    return ref;
  }

  static definitionsOf(el: BpmnElement): readonly BpmnElement[] {
    return el.is('bpmn:Event') ? el.list('eventDefinitions') : [];
  }

  static slotsOf(el: BpmnElement): NestedSlot[] {
    const out: NestedSlot[] = [];
    if (el.is('bpmn:Event')) {
      out.push('definition');
    }
    if (el.is('bpmn:Activity')) {
      out.push('loop');
    }
    if (el.is('bpmn:SequenceFlow') || ElementSlots.definitionsOf(el).some((definition) => definition.is('bpmn:ConditionalEventDefinition'))) {
      out.push('condition');
    }
    return out;
  }

  private static nestedElement(el: BpmnElement, slot: NestedSlot): BpmnElement | undefined {
    switch (slot) {
      case 'definition':
        return ElementSlots.definitionsOf(el)[0];
      case 'loop':
        return el.is('bpmn:Activity') ? el.get<BpmnElement | undefined>('loopCharacteristics') : undefined;
      case 'condition': {
        if (el.is('bpmn:SequenceFlow')) {
          return el.get<BpmnElement | undefined>('conditionExpression');
        }
        const conditional = ElementSlots.definitionsOf(el).filter((definition) => definition.is('bpmn:ConditionalEventDefinition'));
        return conditional.length === 1 ? conditional[0]!.get<BpmnElement | undefined>('condition') : undefined;
      }
      default:
        return undefined;
    }
  }

  static entriesOf(el: BpmnElement): Array<{ slot: NestedSlot; prefix: string; el: BpmnElement }> {
    const out: Array<{ slot: NestedSlot; prefix: string; el: BpmnElement }> = [];
    for (const slot of ElementSlots.slotsOf(el)) {
      if (slot === 'definition') {
        const defs = ElementSlots.definitionsOf(el);
        defs.forEach((definition, index) => out.push({ slot, prefix: defs.length > 1 ? `definition[${index}]` : 'definition', el: definition }));
        continue;
      }
      const nested = ElementSlots.nestedElement(el, slot);
      if (nested) {
        out.push({ slot, prefix: slot, el: nested });
      }
    }
    return out;
  }
}
