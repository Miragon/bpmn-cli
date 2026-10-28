import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8Events } from './tasks/C8Events.js';
import { ExecutableScope } from './tasks/ExecutableScope.js';
import { ModdlePath } from './tasks/ModdlePath.js';
import { hasName } from './tasks/utils/value.js';

/**
 * Reports a send task or message throw event whose message has no name: Camunda 8 refuses the
 * file. camunda-compat checks the message name of catching elements only.
 */
class C8Implementation extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    const holder = this.messageHolderOf(node);
    const message = holder?.messageRef;
    if (!message || hasName(message) || !ExecutableScope.covers(node)) {
      return;
    }

    reportErrors(node, reporter, {
      message: `Message ${message.id} of ${describeElement(node)} has no name; Camunda 8 refuses the file`,
      path: [...ModdlePath.between(node, holder), 'messageRef', 'name'],
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node: message,
        parentNode: node,
        requiredProperty: 'name',
        hint: `\`bpmn set <file> ${message.id} name=<MessageName>\`.`,
      },
    });
  }

  private messageHolderOf(node: ModdleElement): ModdleElement | undefined {
    if (is(node, 'bpmn:SendTask')) {
      return node;
    }
    if (!is(node, 'bpmn:ThrowEvent')) {
      return undefined;
    }
    const definition = C8Events.definitionOf(node);
    return definition && is(definition, 'bpmn:MessageEventDefinition') ? definition : undefined;
  }
}

export default defineRule(
  { ruleName: 'c8-implementation', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-implementation': ['W_C8_DEPLOY_IMPLEMENTATION', 'deploy'] } },
  C8Implementation,
);
