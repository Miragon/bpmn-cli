import { defineRule, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { Values } from '../support/Values.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';
import type { C8SubscriptionGroups } from './support/C8SubscriptionGroups.js';
import { C8SubscriptionUniqueRule } from './C8SubscriptionUniqueRule.js';

/**
 * One error code twice, or two catch-alls without code, among the boundary events of an activity
 * or the event sub-process starts of a scope.
 * Camunda 8 cannot tell which of them catches an error and refuses the file.
 *
 * @example two boundary events of one task catching the same code
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:errorEventDefinition errorRef="Declined" /></bpmn:boundaryEvent>
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:errorEventDefinition errorRef="Declined" /></bpmn:boundaryEvent>  <!-- same code -->
 */
class C8ErrorCodeUniqueRule extends C8SubscriptionUniqueRule {
  protected checkScope(groups: C8SubscriptionGroups, scope: ModdleElement): void {
    for (const { activity, boundaries } of groups.boundaryGroups) {
      this.reportErrorCodes(boundaries, `the boundary events of ${activity.id}`);
    }
    this.reportErrorCodes(groups.eventSubProcessStarts, `the event sub-processes of ${scope.id}`);
  }

  /** One error code twice; no code (`''`) catches every error. */
  private reportErrorCodes(events: ModdleElement[], where: string): void {
    const keyOf = (el: ModdleElement) => {
      const definition = C8EventDefinitions.onlyDefinition(el, 'bpmn:ErrorEventDefinition');
      const code = definition?.get('errorRef')?.get('errorCode');
      if (!definition) return undefined;
      return Values.nonEmpty(code) ? code : '';
    };
    for (const duplicate of this.duplicates(events, keyOf)) {
      const { first, el, key } = duplicate;
      const message = key ? `${ElementKinds.describe(el)} catches the error code "${key}" like ${ElementKinds.describe(first)} (${where}); Camunda 8 refuses one code twice in a scope` : `${ElementKinds.describe(el)} and ${ElementKinds.describe(first)} both catch every error (no error code) (${where}); Camunda 8 allows one catch-all per scope`;
      this.reportDuplicate(duplicate, message, ['eventDefinitions', 0, 'errorRef'], 'errorCode', `Catch another error: \`bpmn set <file> ${el.id} error=<OtherError> errorCode=<OTHER_CODE>\` (the events share no bpmn:Error then), or remove one of them.`);
    }
  }
}

export default defineRule({ ruleName: 'c8-error-code-unique', code: 'W_C8_DEPLOY_ERROR', impact: 'deploy' }, C8ErrorCodeUniqueRule);
