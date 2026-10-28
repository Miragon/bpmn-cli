import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { sh } from '../../shell.js';

/**
 * A `bpmn set` command on an element, through the slot of a nested element (`definition.`,
 * `loop.`) for the assignments it gets. Without an id to address, the fix goes into the XML.
 */
export class SetCommand {
  constructor(
    private readonly target: string | undefined,
    private readonly slot = '',
  ) {}

  /** On the event definition at `index` of `event`: `definition.`, or of several `definition[1].`. */
  static forDefinition(event: ModdleElement, index: number): SetCommand {
    const several = event.get('eventDefinitions').length > 1;
    return new SetCommand(event.id, several ? `definition[${index}].` : 'definition.');
  }

  /** `` `bpmn set <file> X 'definition.camunda:type=external'` ``, or `edit the XML`. */
  of(...assignments: string[]): string {
    if (!this.target) {
      return 'edit the XML';
    }
    const args = assignments.map((assignment) => sh(`${this.slot}${assignment}`));
    return `\`bpmn set <file> ${this.target} ${args.join(' ')}\``;
  }

  /** The `bpmn ext add` arguments that address `type` through the slot (`X 'definition.camunda:field'`). */
  extTarget(type: string): string | undefined {
    return this.target ? `${this.target} ${sh(`${this.slot}${type}`)}` : undefined;
  }
}
