import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Bindings } from './support/C7Bindings.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

const FORM_BINDINGS = ['deployment', 'latest', 'version'];

/**
 * A camunda:formRef of a user task or start event without a camunda:formRefBinding of deployment,
 * latest or version.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a form reference without binding
 * <bpmn:userTask id="Review" camunda:formRef="review" />  <!-- camunda:formRefBinding="latest" -->
 */
class C7FormRefNeedsBindingRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    const attributes = new CamundaAttributes(node);
    const binding = attributes.defined('formRefBinding');
    if (!C7Bindings.hasFormRef(node, attributes) || (binding !== undefined && FORM_BINDINGS.includes(binding))) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    const found = binding === undefined ? `no ${prefix}:formRefBinding` : `${prefix}:formRefBinding="${binding}"`;
    const problem = binding === undefined ? { type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'formRefBinding' } : { type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'formRefBinding' };
    this.report(node, `${ElementKinds.describe(node)} has ${prefix}:formRef but ${found} (one of ${FORM_BINDINGS.join(', ')} is required); the engines refuse the file`, { path: ['formRefBinding'], ...problem, hint: `\`bpmn set <file> ${node.id} ${prefix}:formRefBinding=latest\`.` });
  }
}

export default defineRule({ ruleName: 'c7-form-ref-needs-binding', code: 'W_C7_DEPLOY_FORM', impact: 'deploy' }, C7FormRefNeedsBindingRule);
