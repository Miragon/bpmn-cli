import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Bindings } from './support/C7Bindings.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

/**
 * A binding of version or versionTag without the version or version tag it binds to: of a call
 * activity, a business rule task with a decision, or a form reference.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a version binding without version
 * <bpmn:callActivity id="Ship" calledElement="shipping" camunda:calledElementBinding="version" />  <!-- camunda:calledElementVersion -->
 */
class C7BindingNeedsVersionRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    const attributes = new CamundaAttributes(node);
    const bindings = new C7Bindings(attributes);
    const prefix = C7Diagram.of(node).prefix;
    for (const binding of bindings.of(node)) {
      const problem = bindings.problemOf(binding);
      if (problem === 'version') {
        this.reportBindingVersion(node, binding.binding, 'version', binding.version, '<n>', prefix);
      }
      if (problem === 'versionTag') {
        this.reportBindingVersion(node, binding.binding, 'versionTag', binding.versionTag!, '<tag>', prefix);
      }
    }
    if (C7Bindings.hasFormRef(node, attributes) && attributes.defined('formRefBinding') === 'version' && attributes.defined('formRefVersion') === undefined) {
      this.reportBindingVersion(node, 'formRefBinding', 'version', 'formRefVersion', '<n>', prefix);
    }
  }

  private reportBindingVersion(node: ModdleElement, binding: string, value: string, missing: string, placeholder: string, prefix: string): void {
    const latest = `${prefix}:${binding}=latest`;
    this.report(node, `${ElementKinds.describe(node)} has ${prefix}:${binding}="${value}" but no ${prefix}:${missing}; the engines refuse the file`, { path: [missing], type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED, property: binding, dependentRequiredProperty: missing, hint: `\`bpmn set <file> ${node.id} ${prefix}:${missing}=${placeholder}\` (or ${binding === 'formRefBinding' ? latest : `\`${latest}\``}).` });
  }
}

export default defineRule({ ruleName: 'c7-binding-needs-version', code: 'W_C7_DEPLOY_BINDING_VERSION', impact: 'deploy' }, C7BindingNeedsVersionRule);
