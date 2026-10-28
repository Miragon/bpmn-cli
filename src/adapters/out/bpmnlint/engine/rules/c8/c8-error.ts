import { is } from 'bpmnlint-utils';
import { defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8EventPosition } from './events/C8EventPosition.js';
import { C8SubscriptionRule, type DuplicateReport } from './events/C8SubscriptionRule.js';
import type { Duplicate, SubscriptionGroups } from './events/SubscriptionGroups.js';
import { isBlank, isFeel } from './events/utils/c8Values.js';

/**
 * Reports error catch events Camunda 8 refuses to deploy: one whose error code is a FEEL
 * expression, a non-interrupting one, and one error code (or two catch-alls) twice among the
 * boundary events of an activity or the starts of a scope's event sub-processes.
 */
class C8Error extends C8SubscriptionRule {
  protected checkSubscriber(node: ModdleElement, reporter: Reporter): void {
    if (is(node, 'bpmn:CatchEvent')) {
      this.checkCatch(node, reporter);
    }
  }

  private checkCatch(node: ModdleElement, reporter: Reporter): void {
    const definition = C8EventPosition.definitionOfType(node, 'bpmn:ErrorEventDefinition');
    if (!definition) {
      return;
    }
    const error = definition.get('errorRef');
    const code = error?.get('errorCode');
    if (isFeel(code)) {
      reportErrors(node, reporter, {
        message: `${describeElement(node)} catches the error code "${code}", an expression; Camunda 8 needs a static code on catching error events and refuses the file`,
        path: ['eventDefinitions', 0, 'errorRef', 'errorCode'],
        data: {
          type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED,
          node: error,
          parentNode: node,
          property: 'errorCode',
          hint: `\`bpmn set <file> ${node.id} errorCode=<CODE>\` (or no code: it catches every error).`,
        },
      });
    }
    const interruptingProperty = is(node, 'bpmn:BoundaryEvent')
      ? 'cancelActivity'
      : 'isInterrupting';
    if (is(node, 'bpmn:IntermediateCatchEvent') || node.get(interruptingProperty) !== false) {
      return;
    }
    reportErrors(node, reporter, {
      message: `${describeElement(node)} is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)`,
      path: [interruptingProperty],
      data: {
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        node,
        parentNode: null,
        property: interruptingProperty,
        hint: `\`bpmn set <file> ${node.id} nonInterrupting=false\`.`,
      },
    });
  }

  protected checkScope(groups: SubscriptionGroups, scope: ModdleElement, reporter: Reporter): void {
    for (const { activity, boundaries } of groups.boundaryGroups()) {
      this.reportDuplicates(boundaries, `the boundary events of ${activity.id}`, reporter);
    }
    this.reportDuplicates(
      groups.eventSubProcessStarts(),
      `the event sub-processes of ${scope.id}`,
      reporter,
    );
  }

  protected duplicateReport({ first, el, key }: Duplicate, where: string): DuplicateReport {
    return {
      message: key
        ? `${describeElement(el)} catches the error code "${key}" like ${describeElement(first)} (${where}); Camunda 8 refuses one code twice in a scope`
        : `${describeElement(el)} and ${describeElement(first)} both catch every error (no error code) (${where}); Camunda 8 allows one catch-all per scope`,
      path: ['eventDefinitions', 0, 'errorRef'],
      property: 'errorCode',
      hint: `Catch another error: \`bpmn set <file> ${el.id} error=<OtherError> errorCode=<OTHER_CODE>\` (the events share no bpmn:Error then), or remove one of them.`,
    };
  }

  /** The error code `el` catches, `''` for every error, `undefined` for no error event. */
  protected subscriptionKeyOf(el: ModdleElement): string | undefined {
    const definition = C8EventPosition.onlyDefinition(el, 'bpmn:ErrorEventDefinition');
    if (!definition) {
      return undefined;
    }
    const code = definition.get('errorRef')?.get('errorCode');
    return isBlank(code) ? '' : code;
  }
}

export default defineRule(
  { ruleName: 'c8-error', kind: 'engine-specific', targetEngine: 'c8', impact: 'deploy' },
  C8Error,
);
