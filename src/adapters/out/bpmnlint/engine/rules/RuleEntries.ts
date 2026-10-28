import type { RuleEntry } from '@miragon/bpmnlint-plugin-rules/engine';
import type { EngineKit } from '../../engine-kit.js';
import type { EngineEntry } from '../EngineRun.js';
import type { CamundaRuleFactory, Findings, Impact } from './CamundaRules.js';
import { RuleKit } from './RuleKit.js';

const CATEGORY_OF_IMPACT: Record<Impact, RuleEntry['category']> = { deploy: 'error', runtime: 'warn', practice: 'info' };

/** What the plugin exports for an engine: camunda-compat's rules for an engine version, and the moddle extension they read. */
interface EnginePlugin {
  moddleExtensions: Record<string, unknown>;
  compatRules(version: string | undefined): RuleEntry[];
}

/** bpmn-cli's rules ready to run, as `bpmn-cli/<rule>`: the category of their strictest finding, told the `<major>.<minor>` engine version. */
export class RuleEntries {
  /** camunda-compat's rules for an engine version with bpmn-cli's `rules`, and the moddle extension they read. */
  static entry(kit: EngineKit, rules: readonly CamundaRuleFactory[], { moddleExtensions, compatRules }: EnginePlugin, afterParse?: EngineEntry['afterParse']): EngineEntry {
    RuleKit.use(kit);
    return { moddleExtensions, findings: Object.assign({}, ...rules.map((rule) => rule.findings)), rules: (version) => [...compatRules(version), ...RuleEntries.of(rules, version)], afterParse };
  }

  private static of(rules: readonly CamundaRuleFactory[], version: string | undefined): RuleEntry[] {
    const minor = version && /^\s*(\d+\.\d+)/.exec(version)?.[1];
    return rules.map((rule) => ({ name: `bpmn-cli/${rule.ruleName}`, category: RuleEntries.categoryOf(rule.findings), rule: rule(minor ? { version: minor } : undefined) }));
  }

  private static categoryOf(findings: Findings): RuleEntry['category'] {
    const impacts = Object.values(findings).map(([, impact]) => impact);
    return CATEGORY_OF_IMPACT[(['deploy', 'runtime', 'practice'] as const).find((impact) => impacts.includes(impact)) ?? 'runtime'];
  }
}
