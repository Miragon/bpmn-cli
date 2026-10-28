import { is, isAny } from 'bpmnlint-utils';
import { C7Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7EventDefinitions } from './events/C7EventDefinitions.js';
import { C7ExecutableScope } from './events/C7ExecutableScope.js';
import { C7Subscriptions } from './events/C7Subscriptions.js';

/**
 * Reports the messages Camunda 7 refuses to deploy: a message catch event without a message, a
 * caught or received message without a name, and two message subscriptions with one name in one
 * engine scope.
 */
class C7Message extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!C7ExecutableScope.contains(node)) {
      return;
    }
    if (isAny(node, ['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'])) {
      this.checkCatchEvent(node, reporter);
    }
    if (is(node, 'bpmn:ReceiveTask')) {
      this.checkReceiveTask(node, reporter);
    }
    if (is(node, 'bpmn:Process')) {
      this.checkSubscriptions(node, reporter);
    }
  }

  private checkCatchEvent(event: ModdleElement, reporter: Reporter): void {
    const definitions = new C7EventDefinitions(event);
    const label = describeElement(event);
    for (const definition of definitions.actedOn()) {
      if (!is(definition, 'bpmn:MessageEventDefinition')) {
        continue;
      }
      const message = definition.messageRef;
      if (!message) {
        reportErrors(event, reporter, {
          message: `${label} has no message; the engines refuse the file`,
          path: definitions.pathTo(definition, 'messageRef'),
          data: {
            type: ERROR_TYPES.PROPERTY_REQUIRED,
            node: definition,
            parentNode: event,
            requiredProperty: 'messageRef',
            hint: `\`bpmn set <file> ${event.id} message=<MessageName>\` (creates the bpmn:Message).`,
          },
        });
      } else if (!message.name) {
        this.reportUnnamed(
          event,
          message,
          `Message ${message.id} of ${label}`,
          definitions.pathTo(definition, 'messageRef', 'name'),
          reporter,
        );
      }
    }
  }

  private checkReceiveTask(task: ModdleElement, reporter: Reporter): void {
    const message = task.messageRef;
    if (message && !message.name) {
      this.reportUnnamed(
        task,
        message,
        `Message ${message.id} of receive task ${task.id}`,
        ['messageRef', 'name'],
        reporter,
      );
    }
  }

  private reportUnnamed(
    owner: ModdleElement,
    message: ModdleElement,
    subject: string,
    path: (string | number)[],
    reporter: Reporter,
  ): void {
    reportErrors(owner, reporter, {
      message: `${subject} has no name; the engines refuse the file`,
      path,
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node: message,
        parentNode: owner,
        requiredProperty: 'name',
        hint: `\`bpmn set <file> ${message.id} name=<MessageName>\`.`,
      },
    });
  }

  private checkSubscriptions(process: ModdleElement, reporter: Reporter): void {
    for (const { first, el, name, path } of new C7Subscriptions(process).duplicates('message')) {
      reportErrors(el, reporter, {
        message: `${describeElement(el)} waits for message "${name}" like ${first.id} in the same scope; the engines refuse two message subscriptions with one name`,
        path,
        data: {
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
          node: el,
          parentNode: null,
          duplicatedProperty: 'name',
          duplicatedPropertyValue: name,
          first,
          hint: `Use another message: \`bpmn set <file> ${el.id} message=<OtherName>\`.`,
        },
      });
    }
  }
}

export default defineRule(
  { ruleName: 'c7-message', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7Message,
);
