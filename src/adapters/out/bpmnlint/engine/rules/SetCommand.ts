import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { sh } from './shell.js';

/**
 * How `bpmn set` and `bpmn ext` address an element: its id, or the id of the flow node or flow of
 * a nested element with its slot (`definition.`, `definition[1].`, `loop.`, `condition.`). Without
 * an id to address, the fix goes into the XML.
 */
export class SetCommand {
  constructor(readonly id: string | undefined, readonly slot = '') {}

  /** On the event definition at `index` of `event`: `definition.`, or of several `definition[1].`. */
  static forDefinition(event: ModdleElement, index: number): SetCommand {
    return new SetCommand(event.id, event.get('eventDefinitions').length > 1 ? `definition[${index}].` : 'definition.');
  }

  /** `` `bpmn set <file> X 'definition.camunda:type=external'` ``, or `edit the XML`. */
  of(...assignments: string[]): string {
    return this.id ? `\`bpmn set <file> ${this.id} ${assignments.map((assignment) => sh(`${this.slot}${assignment}`)).join(' ')}\`` : 'edit the XML';
  }

  /** The `bpmn ext add` arguments that address `type` through the slot (`X 'definition.camunda:field'`). */
  extTarget(type: string): string | undefined {
    return this.id ? `${this.id} ${sh(`${this.slot}${type}`)}` : undefined;
  }
}
