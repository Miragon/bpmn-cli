import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { describeElement, triggerName } from '../../describe.js';
import { C7EventDefinitions } from './C7EventDefinitions.js';

/**
 * How a report about one event definition names and addresses it: on its event (with an id) as
 * `Conditional event X`, or among several definitions as `The conditional definition of <event>`;
 * on the definition itself when no event with an id holds it.
 */
export class C7DefinitionSubject {
  private readonly event: ModdleElement | undefined;

  constructor(private readonly definition: ModdleElement) {
    const parent = definition.$parent;
    this.event = parent && is(parent, 'bpmn:Event') && parent.id ? parent : undefined;
  }

  /** The element the report is on. */
  get target(): ModdleElement {
    return this.event ?? this.definition;
  }

  /** The event that holds the definition, `null` when the report is on the definition itself. */
  get parentNode(): ModdleElement | null {
    return this.event ?? null;
  }

  /** The subject of the message; `single` names the kind of a one-definition event (`Link event`). */
  name(single: string): string {
    const event = this.event;
    if (!event) {
      return `${this.definition.$type}${this.definition.id ? ` ${this.definition.id}` : ''}`;
    }
    const definitions = new C7EventDefinitions(event);
    if (definitions.all().length > 1) {
      return `The ${triggerName(this.definition)} definition of ${describeElement(event)}`;
    }
    return `${single} ${event.id}`;
  }

  /**
   * The fix `bpmn set <file> <event> <command>` (with `keeps` in brackets), or among several
   * definitions how to drop this one when the engines act on another one.
   */
  hint(command: string, keeps = ''): string {
    const event = this.event;
    if (!event) {
      return 'Fix it in the XML.';
    }
    const definitions = new C7EventDefinitions(event);
    if (definitions.all().length < 2) {
      return `\`bpmn set <file> ${event.id} ${command}\`${keeps ? ` (${keeps})` : ''}.`;
    }
    const only = `\`bpmn set <file> ${event.id} ${command}\` (keeps only the ${triggerName(this.definition)} definition)`;
    const acting = definitions.acting();
    if (!acting || acting === this.definition) {
      return `${only}.`;
    }
    const trigger = triggerName(acting);
    return `The engines act on the ${trigger} definition and ignore this one, but they validate it too: drop it with \`bpmn set <file> ${event.id} trigger=${trigger}\` (keeps only the ${trigger}), or ${only}.`;
  }

  /** The report path from the target to the definition's `rest`. */
  path(...rest: string[]): (string | number)[] {
    return this.event ? new C7EventDefinitions(this.event).pathTo(this.definition, ...rest) : rest;
  }
}
