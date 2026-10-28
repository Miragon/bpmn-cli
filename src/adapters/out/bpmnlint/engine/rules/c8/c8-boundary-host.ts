import { C8Rule, defineRule, type ModdleElement, type Reporter } from '../CamundaRules.js';
import { CompensationHandlerBoundary } from '../CompensationHandlerBoundary.js';

/** Reports a boundary event attached to a compensation handler, which Camunda 8 refuses to deploy. */
class C8BoundaryHost extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    CompensationHandlerBoundary.check(node, reporter, 'Camunda 8 refuses');
  }
}

export default defineRule(
  { ruleName: 'c8-boundary-host', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-boundary-host': ['W_C8_DEPLOY_BOUNDARY_HOST', 'deploy'] } },
  C8BoundaryHost,
);
