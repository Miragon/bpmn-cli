import type { RuleEntry } from '@miragon/bpmnlint-plugin-rules/engine';
import type { CamundaRuleFactory, Findings, Impact } from './CamundaRules.js';

const CATEGORY_OF_IMPACT: Record<Impact, RuleEntry['category']> = { deploy: 'error', runtime: 'warn', practice: 'info' };

/** bpmn-cli's rules ready to run, as `bpmn-cli/<rule>`: the category of their strictest finding, told the `<major>.<minor>` engine version. */
export class RuleEntries {
  static of(rules: readonly CamundaRuleFactory[], version: string | undefined): RuleEntry[] {
    const minor = version && /^\s*(\d+\.\d+)/.exec(version)?.[1];
    return rules.map((rule) => ({ name: `bpmn-cli/${rule.ruleName}`, category: RuleEntries.categoryOf(rule.findings), rule: rule(minor ? { version: minor } : undefined) }));
  }

  /** The findings of all `rules` by name. */
  static findingsOf(rules: readonly CamundaRuleFactory[]): Findings {
    return Object.assign({}, ...rules.map((rule) => rule.findings));
  }

  private static categoryOf(findings: Findings): RuleEntry['category'] {
    const impacts = Object.values(findings).map(([, impact]) => impact);
    return CATEGORY_OF_IMPACT[(['deploy', 'runtime', 'practice'] as const).find((impact) => impacts.includes(impact)) ?? 'runtime'];
  }
}
