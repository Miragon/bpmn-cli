import { isAny } from 'bpmnlint-utils';
import { defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { CamundaAttributes } from './implementation/CamundaAttributes.js';
import { C7Diagram } from './C7Diagram.js';

const FORM_BINDINGS = ['deployment', 'latest', 'version'];

/**
 * Reports a `camunda:formRef` next to a `camunda:formKey`, or without a known `camunda:formRefBinding`:
 * Camunda 7 refuses the file.
 */
class C7Form extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    if (!isAny(node, ['bpmn:UserTask', 'bpmn:StartEvent'])) {
      return;
    }
    const attributes = new CamundaAttributes(node);
    if (attributes.defined('formRef') === undefined) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    if (attributes.defined('formKey') !== undefined) {
      reportErrors(node, reporter, {
        message: `${describeElement(node)} has both ${prefix}:formKey and ${prefix}:formRef; the engines refuse the file`,
        path: ['formKey'],
        data: {
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node,
          parentNode: null,
          property: 'formKey',
          hint: `Keep one: \`bpmn set <file> ${node.id} ${prefix}:formKey=\` (or ${prefix}:formRef=).`,
        },
      });
    }
    this.checkBinding(node, attributes.defined('formRefBinding'), prefix, reporter);
  }

  private checkBinding(
    node: ModdleElement,
    binding: string | undefined,
    prefix: string,
    reporter: Reporter,
  ): void {
    if (binding !== undefined && FORM_BINDINGS.includes(binding)) {
      return;
    }
    const found =
      binding === undefined ? `no ${prefix}:formRefBinding` : `${prefix}:formRefBinding="${binding}"`;
    const hint = `\`bpmn set <file> ${node.id} ${prefix}:formRefBinding=latest\`.`;
    reportErrors(node, reporter, {
      message: `${describeElement(node)} has ${prefix}:formRef but ${found} (one of ${FORM_BINDINGS.join(', ')} is required); the engines refuse the file`,
      path: ['formRefBinding'],
      data:
        binding === undefined
          ? {
              type: ERROR_TYPES.PROPERTY_REQUIRED,
              node,
              parentNode: null,
              requiredProperty: 'formRefBinding',
              hint,
            }
          : {
              type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
              node,
              parentNode: null,
              property: 'formRefBinding',
              hint,
            },
    });
  }
}

export default defineRule(
  { ruleName: 'c7-form', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7Form,
);
