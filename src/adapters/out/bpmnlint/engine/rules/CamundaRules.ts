import { defineRule as declareRule, EngineRule, type DeclaredRuleFactory, type Engine, type RuleDeclaration } from '@miragon/bpmnlint-plugin-rules/engine';

export type { ModdleElement, Reporter, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
export { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
export { reportErrors } from 'bpmnlint-plugin-camunda-compat/rules/utils/reporter.js';
export { describeElement, triggerName } from './describe.js';

/** What the engine does with a file the rule reports: refuses it, fails or ignores a setting when it runs, or runs it other than a reader expects. */
export type Impact = 'deploy' | 'runtime' | 'practice';

/** A bpmn-cli engine rule: the plugin's rule factory and the impact its findings have. */
export type CamundaRuleFactory = DeclaredRuleFactory & { impact: Impact };

/** The plugin's `defineRule` with the rule's impact, from which bpmn-cli takes its category. */
export function defineRule<const Name extends string>(declaration: RuleDeclaration<Name> & { impact: Impact }, RuleClass: new (config?: object) => EngineRule): CamundaRuleFactory {
  const { impact, ...rest } = declaration;
  return Object.assign(declareRule(rest, RuleClass), { impact });
}

/** A rule that checks the diagrams targeting Camunda 7. */
export abstract class C7Rule extends EngineRule {
  protected readonly engine: Engine = 'c7';
}

/** A rule that checks the diagrams targeting Camunda 8. */
export abstract class C8Rule extends EngineRule {
  protected readonly engine: Engine = 'c8';
}
