import { EngineRule, type Engine } from '@miragon/bpmnlint-plugin-rules/engine';

export { defineRule, type ModdleElement, type Reporter, type ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
export { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
export { reportErrors } from 'bpmnlint-plugin-camunda-compat/rules/utils/reporter.js';
export { describeElement, triggerName } from './describe.js';

/** A rule that checks the diagrams targeting Camunda 7. */
export abstract class C7Rule extends EngineRule {
  protected readonly engine: Engine = 'c7';
}

/** A rule that checks the diagrams targeting Camunda 8. */
export abstract class C8Rule extends EngineRule {
  protected readonly engine: Engine = 'c8';
}
