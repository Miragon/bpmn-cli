import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { CamundaAttributes } from './implementation/CamundaAttributes.js';
import { C7Diagram } from './C7Diagram.js';

/** Reports a call activity that calls nothing, or both a process and a case: Camunda 7 refuses the file. */
class C7CalledElement extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:CallActivity')) {
      return;
    }
    const calledElement: string | undefined = node.get('calledElement');
    const caseRef = new CamundaAttributes(node).defined('caseRef');
    const prefix = C7Diagram.of(node).prefix;
    if (calledElement === undefined && caseRef === undefined) {
      reportErrors(node, reporter, {
        message: `Call activity ${node.id} has no calledElement (nor ${prefix}:caseRef); the engines refuse the file`,
        path: ['calledElement'],
        data: {
          type: ERROR_TYPES.PROPERTY_REQUIRED,
          node,
          parentNode: null,
          requiredProperty: 'calledElement',
          hint: `\`bpmn set <file> ${node.id} calledElement=<processId>\`.`,
        },
      });
    } else if (calledElement !== undefined && caseRef !== undefined) {
      reportErrors(node, reporter, {
        message: `Call activity ${node.id} has both calledElement and ${prefix}:caseRef; the engines refuse the file`,
        path: ['caseRef'],
        data: {
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node,
          parentNode: null,
          property: 'caseRef',
          hint: `Keep one: \`bpmn set <file> ${node.id} ${prefix}:caseRef=\`.`,
        },
      });
    }
  }
}

export default defineRule(
  { ruleName: 'c7-called-element', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7CalledElement,
);
