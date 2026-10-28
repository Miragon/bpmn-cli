import type { RuleEntry } from '@miragon/bpmnlint-plugin-rules/engine';
import type { CamundaRuleFactory, Impact } from './CamundaRules.js';

const CATEGORY_OF_IMPACT: Record<Impact, RuleEntry['category']> = { deploy: 'error', runtime: 'warn', practice: 'info' };

/** bpmn-cli's rules ready to run, as `bpmn-cli/<rule>`: the category from the impact, told the `<major>.<minor>` engine version. */
export class RuleEntries {
  static of(rules: readonly CamundaRuleFactory[], version: string | undefined): RuleEntry[] {
    const minor = version && /^\s*(\d+\.\d+)/.exec(version)?.[1];
    return rules.map((rule) => ({ name: `bpmn-cli/${rule.ruleName}`, category: CATEGORY_OF_IMPACT[rule.impact], rule: rule(minor ? { version: minor } : undefined) }));
  }
}
