import { is } from 'bpmnlint-utils';
import { defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { CamundaAttributes } from './implementation/CamundaAttributes.js';
import { ReferenceBinding } from './implementation/ReferenceBinding.js';
import { C7Diagram } from './C7Diagram.js';

/**
 * Reports a binding of `version` or `versionTag` without the version or tag it binds to, on a call
 * activity, business rule task or form reference: Camunda 7 refuses the file.
 */
class C7BindingVersion extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    for (const binding of ReferenceBinding.forElement(node)) {
      const problem = binding.problem;
      if (problem === 'version') {
        this.report(node, binding.binding, 'version', binding.version, '<n>', reporter);
      } else if (problem === 'versionTag') {
        this.report(node, binding.binding, 'versionTag', binding.versionTag!, '<tag>', reporter);
      }
    }
    if (is(node, 'bpmn:UserTask') || is(node, 'bpmn:StartEvent')) {
      this.checkFormBinding(node, reporter);
    }
  }

  private checkFormBinding(node: ModdleElement, reporter: Reporter): void {
    const attributes = new CamundaAttributes(node);
    if (
      attributes.defined('formRef') !== undefined &&
      attributes.defined('formRefBinding') === 'version' &&
      attributes.defined('formRefVersion') === undefined
    ) {
      this.report(node, 'formRefBinding', 'version', 'formRefVersion', '<n>', reporter);
    }
  }

  private report(
    node: ModdleElement,
    binding: string,
    value: string,
    missing: string,
    placeholder: string,
    reporter: Reporter,
  ): void {
    const prefix = C7Diagram.of(node).prefix;
    const latest = `${prefix}:${binding}=latest`;
    const alternative = binding === 'formRefBinding' ? latest : `\`${latest}\``;
    reportErrors(node, reporter, {
      message: `${describeElement(node)} has ${prefix}:${binding}="${value}" but no ${prefix}:${missing}; the engines refuse the file`,
      path: [missing],
      data: {
        type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
        node,
        parentNode: null,
        property: binding,
        dependentRequiredProperty: missing,
        hint: `\`bpmn set <file> ${node.id} ${prefix}:${missing}=${placeholder}\` (or ${alternative}).`,
      },
    });
  }
}

export default defineRule(
  { ruleName: 'c7-binding-version', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7BindingVersion,
);
