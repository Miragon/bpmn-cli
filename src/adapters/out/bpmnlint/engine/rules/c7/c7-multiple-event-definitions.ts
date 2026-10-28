import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, triggerName, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7EventDefinitions } from './events/C7EventDefinitions.js';
import { C7ExecutableScope } from './events/C7ExecutableScope.js';

/**
 * Reports an event with several event definitions: Camunda 7 acts on one of them and ignores the
 * others (a message + timer catch event creates only the timer job). It deploys.
 */
class C7MultipleEventDefinitions extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:Event') || !C7ExecutableScope.contains(node)) {
      return;
    }

    const definitions = new C7EventDefinitions(node);
    const all = definitions.all();
    if (all.length < 2) {
      return;
    }

    const kinds = all.map((definition) => triggerName(definition));
    reportErrors(node, reporter, {
      message: `${describeElement(node)} has ${all.length} event definitions (${kinds.join(', ')}); ${this.consequence(definitions)}`,
      path: ['eventDefinitions'],
      data: {
        type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
        node,
        parentNode: null,
        kept: definitions.acting(),
        hint: this.hint(node, definitions),
      },
    });
  }

  private hint(event: ModdleElement, definitions: C7EventDefinitions): string {
    const acting = definitions.acting();
    const keep = acting ? triggerName(acting) : '<trigger>';
    return `Keep one: \`bpmn set <file> ${event.id} trigger=${keep}\` (keeps that definition, drops the others), and model each other trigger as its own event (behind an event-based gateway, or another boundary / start event). One definition is edited with \`bpmn set <file> ${event.id} 'definition[<n>].<key>=<value>'\`.`;
  }

  private consequence(definitions: C7EventDefinitions): string {
    const acting = definitions.acting();
    if (!acting) {
      return 'the engines act on one of them only and ignore the others';
    }
    const ignored = definitions
      .all()
      .filter((definition) => definition !== acting)
      .map((definition) => triggerName(definition));
    return `the engines act on the ${triggerName(acting)} only and ignore the ${ignored.join(' and ')}`;
  }
}

export default defineRule(
  { ruleName: 'c7-multiple-event-definitions', kind: 'engine-specific', targetEngine: 'c7', impact: 'runtime' },
  C7MultipleEventDefinitions,
);
