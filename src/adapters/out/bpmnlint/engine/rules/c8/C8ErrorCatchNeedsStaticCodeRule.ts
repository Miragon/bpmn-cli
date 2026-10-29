import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { Values } from '../support/Values.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';

/**
 * An error catch event whose error code is a FEEL expression.
 * Camunda 8 matches a thrown error against static codes on catching events and refuses the file.
 *
 * @example an error boundary event with a FEEL code
 * <bpmn:error id="Declined" errorCode="=code" />  <!-- a static code -->
 */
class C8ErrorCatchNeedsStaticCodeRule extends C8Rule {
  protected visit(event: ModdleElement): void {
    if (!EngineScope.C8.contains(event) || !is(event, 'bpmn:CatchEvent')) return;
    const definition = C8EventDefinitions.definitionOfType(event, 'bpmn:ErrorEventDefinition');
    const error = definition?.get('errorRef');
    const code = error?.get('errorCode');
    if (!definition || !Values.isFeel(code)) return;
    this.report(event, `${ElementKinds.describe(event)} catches the error code "${code}", an expression; Camunda 8 needs a static code on catching error events and refuses the file`, { path: ['eventDefinitions', 0, 'errorRef', 'errorCode'], type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED, node: error, property: 'errorCode', hint: `\`bpmn set <file> ${event.id} errorCode=<CODE>\` (or no code: it catches every error).` });
  }
}

export default defineRule({ ruleName: 'c8-error-catch-needs-static-code', code: 'W_C8_DEPLOY_ERROR', impact: 'deploy' }, C8ErrorCatchNeedsStaticCodeRule);
