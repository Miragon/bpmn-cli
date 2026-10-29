import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Bindings } from './support/C7Bindings.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

/**
 * A camunda:formRef next to a camunda:formKey on a user task or start event.
 * Camunda 7 takes one form and refuses to deploy the file.
 *
 * @example two forms on one task
 * <bpmn:userTask id="Review" camunda:formKey="review.html" camunda:formRef="review" camunda:formRefBinding="latest" />
 */
class C7FormRefNoFormKeyRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    const attributes = new CamundaAttributes(node);
    if (!C7Bindings.hasFormRef(node, attributes) || attributes.defined('formKey') === undefined) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    this.report(node, `${ElementKinds.describe(node)} has both ${prefix}:formKey and ${prefix}:formRef; the engines refuse the file`, { path: ['formKey'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'formKey', hint: `Keep one: \`bpmn set <file> ${node.id} ${prefix}:formKey=\` (or ${prefix}:formRef=).` });
  }
}

export default defineRule({ ruleName: 'c7-form-ref-no-form-key', code: 'W_C7_DEPLOY_FORM', impact: 'deploy' }, C7FormRefNoFormKeyRule);
