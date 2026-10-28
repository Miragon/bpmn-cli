import { is, isAny } from 'bpmnlint-utils';
import { C7Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7EventDefinitions } from './events/C7EventDefinitions.js';
import { C7ExecutableScope } from './events/C7ExecutableScope.js';

const ESCALATION_HOSTS = ['bpmn:SubProcess', 'bpmn:CallActivity', 'bpmn:UserTask'];

/**
 * Reports the escalations Camunda 7 refuses to deploy: a throw event without an escalation or with
 * an escalation without an escalationCode, and an escalation boundary event on an activity other
 * than a sub-process, call activity or user task.
 */
class C7Escalation extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:Event') || !C7ExecutableScope.contains(node)) {
      return;
    }

    const definitions = new C7EventDefinitions(node);
    const escalations = definitions
      .actedOn()
      .filter((definition) => is(definition, 'bpmn:EscalationEventDefinition'));
    if (isAny(node, ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'])) {
      for (const definition of escalations) {
        this.checkThrown(node, definition, definitions, reporter);
      }
    } else if (is(node, 'bpmn:BoundaryEvent') && escalations.length) {
      this.checkHost(node, reporter);
    }
  }

  private checkThrown(
    event: ModdleElement,
    definition: ModdleElement,
    definitions: C7EventDefinitions,
    reporter: Reporter,
  ): void {
    const label = describeElement(event);
    const escalation = definition.escalationRef;
    if (!escalation) {
      reportErrors(event, reporter, {
        message: `${label} throws no escalation (no escalationRef); the engines refuse the file`,
        path: definitions.pathTo(definition, 'escalationRef'),
        data: {
          type: ERROR_TYPES.PROPERTY_REQUIRED,
          node: definition,
          parentNode: event,
          requiredProperty: 'escalationRef',
          hint: `\`bpmn set <file> ${event.id} escalation=<Name> escalationCode=<CODE>\`.`,
        },
      });
    } else if (!String(escalation.escalationCode ?? '').trim()) {
      reportErrors(event, reporter, {
        message: `Escalation ${escalation.id} thrown by ${label} has no escalationCode; the engines refuse the file`,
        path: definitions.pathTo(definition, 'escalationRef', 'escalationCode'),
        data: {
          type: ERROR_TYPES.PROPERTY_REQUIRED,
          node: escalation,
          parentNode: event,
          requiredProperty: 'escalationCode',
          hint: `\`bpmn set <file> ${event.id} escalationCode=<CODE>\`.`,
        },
      });
    }
  }

  private checkHost(event: ModdleElement, reporter: Reporter): void {
    const host = event.attachedToRef;
    if (!host || isAny(host, ESCALATION_HOSTS)) {
      return;
    }
    reportErrors(event, reporter, {
      message: `Escalation boundary event ${event.id} is attached to ${describeElement(host)}; the engines allow it only on sub-processes, call activities and user tasks and refuse the file`,
      path: ['attachedToRef'],
      data: {
        type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED,
        node: event,
        parentNode: null,
        attachedToRef: host,
        hint: `Attach it elsewhere (\`bpmn move <file> ${event.id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${event.id}\`.`,
      },
    });
  }
}

export default defineRule(
  { ruleName: 'c7-escalation', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7Escalation,
);
