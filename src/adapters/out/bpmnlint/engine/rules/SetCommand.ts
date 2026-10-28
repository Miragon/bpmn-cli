import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { Shell } from './Shell.js';

/** The slot `bpmn set` gives a part of a flow node or flow. */
const SLOTS: Array<[property: string, slot: string]> = [['eventDefinitions', 'definition'], ['loopCharacteristics', 'loop'], ['conditionExpression', 'condition']];

/**
 * How `bpmn set` and `bpmn ext` address an element: its id, or the id of the flow node or flow of
 * a nested element with its slot (`definition.`, `definition[1].`, `loop.`, `condition.`). Without
 * an id to address, the fix goes into the XML.
 */
export class SetCommand {
  constructor(readonly id: string | undefined, readonly slot = '') {}

  /** The address of `el`: through the slot of its flow node or flow, else its own id; undefined without either. */
  static at(el: ModdleElement): SetCommand | undefined {
    const parent = el.$parent;
    const slot = parent?.id ? SetCommand.slotIn(parent, el) : '';
    if (slot) return new SetCommand(parent.id, slot);
    return el.id ? new SetCommand(el.id) : undefined;
  }

  /** The slot of `el` in `parent` when it is an event definition, loop or condition of it, else ''. */
  static slotIn(parent: ModdleElement, el: ModdleElement): string {
    for (const [property, slot] of SLOTS) {
      const value = parent[property];
      if (value === el) return `${slot}.`;
      if (Array.isArray(value) && value.includes(el)) return value.length > 1 ? `${slot}[${value.indexOf(el)}].` : `${slot}.`;
    }
    return '';
  }

  /** On the event definition at `index` of `event`: `definition.`, or of several `definition[1].`. */
  static forDefinition(event: ModdleElement, index: number): SetCommand {
    return new SetCommand(event.id, event.get('eventDefinitions').length > 1 ? `definition[${index}].` : 'definition.');
  }

  /** `` `bpmn set <file> X 'definition.camunda:type=external'` ``, or `edit the XML`. */
  of(...assignments: string[]): string {
    return this.id ? `\`bpmn set <file> ${this.id} ${assignments.map((assignment) => Shell.quote(`${this.slot}${assignment}`)).join(' ')}\`` : 'edit the XML';
  }

  /** `` `bpmn set <file> X camunda:asignee=` ``, which removes the attribute `key` as the file spells it. */
  unset(key: string): string {
    return `\`bpmn set <file> ${this.id} ${Shell.quote(`${this.slot}${key}=`)}\``;
  }

  /** The `bpmn ext add` arguments that address `type` through the slot (`X 'definition.camunda:field'`). */
  extTarget(type: string): string | undefined {
    return this.id ? `${this.id} ${Shell.quote(`${this.slot}${type}`)}` : undefined;
  }
}
