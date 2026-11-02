import type { RuleEntry } from '@miragon/bpmnlint-plugin-rules/engine';
import type { EngineKit } from '../../engine-kit.js';
import type { EngineEntry } from '../run/EngineRun.js';
import type { CamundaRuleFactory, Impact } from './CamundaRule.js';
import { RuleKit } from './RuleKit.js';

const CATEGORY_OF_IMPACT: Record<Impact, RuleEntry['category']> = { deploy: 'error', runtime: 'warn', practice: 'info' };

/** What the plugin exports for an engine: camunda-compat's rules for an engine version, and the moddle extension they read. */
interface EnginePlugin {
  moddleExtensions: Record<string, unknown>;
  compatRules(version: string | undefined): RuleEntry[];
}

/** bpmn-cli's rules ready to run, as `bpmn-cli/<rule>`: the category of their impact, told the `<major>.<minor>` engine version. */
export class RuleEntries {
  /** camunda-compat's rules for an engine version with bpmn-cli's `rules` and the `writtenFileRules` after them, and the moddle extension they read. */
  static entry(kit: EngineKit, rules: readonly CamundaRuleFactory[], writtenFileRules: readonly CamundaRuleFactory[], { moddleExtensions, compatRules }: EnginePlugin, afterParse?: EngineEntry['afterParse']): EngineEntry {
    RuleKit.use(kit);
    const own = [...rules, ...writtenFileRules];
    return { moddleExtensions, codes: Object.fromEntries(own.map((rule) => [`bpmn-cli/${rule.ruleName}`, [rule.code, rule.impact]])), rules: (version) => [...compatRules(version), ...RuleEntries.of(own, version)], writtenFileRules: new Set(writtenFileRules.map((rule) => `bpmn-cli/${rule.ruleName}`)), afterParse };
  }

  private static of(rules: readonly CamundaRuleFactory[], version: string | undefined): RuleEntry[] {
    const minor = version && /^\s*(\d+\.\d+)/.exec(version)?.[1];
    return rules.map((rule) => ({ name: `bpmn-cli/${rule.ruleName}`, category: CATEGORY_OF_IMPACT[rule.impact], rule: rule(minor ? { version: minor } : undefined) }));
  }
}
