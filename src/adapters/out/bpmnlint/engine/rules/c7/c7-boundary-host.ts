import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, type ModdleElement, type Reporter } from '../CamundaRules.js';
import { CompensationHandlerBoundary } from '../CompensationHandlerBoundary.js';

import { C7ExecutableScope } from './events/C7ExecutableScope.js';

/** Reports a boundary event attached to a compensation handler, which Camunda 7 refuses to deploy. */
class C7BoundaryHost extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (is(node, 'bpmn:BoundaryEvent') && C7ExecutableScope.contains(node)) {
      CompensationHandlerBoundary.check(node, reporter, 'the engines refuse');
    }
  }
}

export default defineRule(
  { ruleName: 'c7-boundary-host', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7BoundaryHost,
);
