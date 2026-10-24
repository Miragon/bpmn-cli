/**
 * The contract between bpmn-cli and an injected bpmnlint (browser-safe: this
 * module never imports it): the Linter, the resolver, a .bpmnlintrc and what
 * its resolution gives. The node layer (src/node/BpmnlintLoader.ts) finds the
 * .bpmnlintrc, loads bpmnlint and @miragon/bpmnlint-plugin-rules and builds
 * the resolver; BpmnlintConfigResolution resolves a configuration,
 * BpmnlintValidator lints with it.
 *
 *   const engine = { Linter, resolver }                                  bpmnlint's Linter + a resolver (bundled, chained)
 *   const resolved = await new BpmnlintConfigResolution(engine, rc).resolve()  extends flattened, every rule resolved once
 *   new BpmnlintValidator(engine, resolved, { detail }).named()           a NamedValidator, advisory unless `blocks`
 */

/** bpmnlint's resolver contract (bpmnlint/lib/resolver/*, createBundledResolver() of @miragon/bpmnlint-plugin-rules); an answer may be a promise. */
export interface BpmnlintResolver {
  resolveRule(pkg: string, ruleName: string): unknown;
  resolveConfig(pkg: string, configName: string): unknown;
}

/** A .bpmnlintrc or shareable config. */
export interface BpmnlintConfig {
  extends?: string | string[];
  rules?: Record<string, unknown>;
  /** prefix -> moddle descriptor (an object), or a module path the node layer resolves to a JSON descriptor */
  moddleExtensions?: Record<string, unknown>;
}

/** One report of a bpmnlint rule. */
export interface BpmnlintReport {
  id?: string;
  message: string;
  path?: Array<string | number>;
  category: string;
}

/** A bpmnlint rule as its factory returns it. */
export interface BpmnlintRule {
  check?: unknown;
  meta?: unknown;
}

/** What the core uses of a bpmnlint Linter. */
export interface BpmnlintLinter {
  lint(root: unknown): Promise<Record<string, BpmnlintReport[]>>;
  resolveConfig(name: string): Promise<BpmnlintConfig>;
  normalizeConfig(config: BpmnlintConfig, localPackage: string): BpmnlintConfig & { rules: Record<string, unknown> };
  parseRuleName(name: string, localPackage?: string): { pkg: string; ruleName: string };
  parseConfigName(name: string): { pkg: string; configName: string };
  parseRuleValue(value: unknown): { category: unknown; config: unknown };
}

/** bpmnlint's Linter class (`require('bpmnlint').Linter`). */
export type BpmnlintLinterClass = new (options: {
  config?: BpmnlintConfig;
  resolver: BpmnlintResolver;
  transformRule?: (rule: BpmnlintRule, info: { pkg: string; ruleName: string }) => BpmnlintRule;
}) => BpmnlintLinter;

/** What the core needs of bpmnlint: its Linter class and a resolver. */
export interface BpmnlintEngine {
  Linter: BpmnlintLinterClass;
  resolver: BpmnlintResolver;
}

export type BpmnlintSeverity = 'error' | 'warn' | 'info' | 'off';

/** One rule's effective setting. */
export interface BpmnlintRuleSetting {
  severity: BpmnlintSeverity;
  /** the rule's options as bpmnlint hands them to it: `{}` for a bare flag, undefined for `[flag]` */
  config: unknown;
}

/** A config, rule, moddle extension or file left out, or bpmnlint that could not be loaded. */
export interface BpmnlintUnavailable {
  kind: 'config' | 'rule' | 'moddle' | 'file' | 'engine';
  /** as the configuration names it: `plugin:missing/recommended`, `missing/foo` (normalised), `camunda` (moddle prefix), the path */
  name: string;
  /** the package bpmnlint resolves it from (`bpmnlint-plugin-missing`); moddle: the module path; file: the path */
  pkg: string;
  reason: string;
  /** what to do */
  hint?: string;
}

export interface ResolvedBpmnlintConfig {
  /** the effective rules, normalised names, `off` ones included; a rule that cannot be resolved is not here but in `unavailable` */
  rules: Record<string, BpmnlintRuleSetting>;
  unavailable: BpmnlintUnavailable[];
  /** moddle descriptors by prefix */
  moddleExtensions: Record<string, object>;
}
