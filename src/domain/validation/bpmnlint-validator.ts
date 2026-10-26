/** The contract with an injected bpmnlint; browser-safe because this module never imports it. */

/** bpmnlint's resolver contract; an answer may be a promise. */
export interface BpmnlintResolver {
  resolveRule(pkg: string, ruleName: string): unknown;
  resolveConfig(pkg: string, configName: string): unknown;
}

export interface BpmnlintConfig {
  extends?: string | string[];
  rules?: Record<string, unknown>;
  /** prefix -> moddle descriptor, or a module path the node layer resolves */
  moddleExtensions?: Record<string, unknown>;
}

export interface BpmnlintReport {
  id?: string;
  message: string;
  path?: Array<string | number>;
  category: string;
}

export interface BpmnlintRule {
  check?: unknown;
  meta?: unknown;
}

export interface BpmnlintLinter {
  lint(root: unknown): Promise<Record<string, BpmnlintReport[]>>;
  resolveConfig(name: string): Promise<BpmnlintConfig>;
  normalizeConfig(config: BpmnlintConfig, localPackage: string): BpmnlintConfig & { rules: Record<string, unknown> };
  parseRuleName(name: string, localPackage?: string): { pkg: string; ruleName: string };
  parseConfigName(name: string): { pkg: string; configName: string };
  parseRuleValue(value: unknown): { category: unknown; config: unknown };
}

export type BpmnlintLinterClass = new (options: {
  config?: BpmnlintConfig;
  resolver: BpmnlintResolver;
  transformRule?: (rule: BpmnlintRule, info: { pkg: string; ruleName: string }) => BpmnlintRule;
}) => BpmnlintLinter;

export interface BpmnlintEngine {
  Linter: BpmnlintLinterClass;
  resolver: BpmnlintResolver;
}

export type { BpmnlintRuleSetting, BpmnlintSeverity } from '../document/ids/bpmnlint-rule-setting.js';
import type { BpmnlintRuleSetting, BpmnlintSeverity } from '../document/ids/bpmnlint-rule-setting.js';

/** A config, rule, moddle extension or file left out, or bpmnlint that could not be loaded. */
export interface BpmnlintUnavailable {
  kind: 'config' | 'rule' | 'moddle' | 'file' | 'engine';
  /** as the configuration names it, e.g. `plugin:missing/recommended` */
  name: string;
  /** the package bpmnlint resolves it from; moddle and file: the path */
  pkg: string;
  reason: string;
  hint?: string;
}

export interface ResolvedBpmnlintConfig {
  /** normalised names, `off` ones included; an unresolvable rule is in `unavailable` instead */
  rules: Record<string, BpmnlintRuleSetting>;
  unavailable: BpmnlintUnavailable[];
  moddleExtensions: Record<string, object>;
}
