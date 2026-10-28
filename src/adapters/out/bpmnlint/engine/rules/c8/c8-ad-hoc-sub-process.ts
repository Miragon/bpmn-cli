import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8EventPosition } from './events/C8EventPosition.js';

/**
 * Reports a start or end event inside an ad-hoc sub-process, which Camunda 8 refuses to deploy. The
 * report goes on the ad-hoc sub-process, with the path to the event to remove.
 */
class C8AdHocSubProcess extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:AdHocSubProcess') || !C8EventPosition.isExecutable(node)) {
      return;
    }

    (node.get('flowElements') as ModdleElement[]).forEach((child, index) => {
      if (!isAny(child, ['bpmn:StartEvent', 'bpmn:EndEvent'])) {
        return;
      }
      reportErrors(node, reporter, {
        message: `Ad-hoc sub-process ${node.id} contains the ${is(child, 'bpmn:StartEvent') ? 'start' : 'end'} event ${child.id}; Camunda 8 refuses start and end events in ad-hoc sub-processes`,
        path: ['flowElements', index],
        data: {
          type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
          node: child,
          parentNode: node,
          hint: `\`bpmn remove <file> ${child.id}\`.`,
        },
      });
    });
  }
}

export default defineRule(
  { ruleName: 'c8-ad-hoc-sub-process', kind: 'engine-specific', targetEngine: 'c8', impact: 'deploy' },
  C8AdHocSubProcess,
);
