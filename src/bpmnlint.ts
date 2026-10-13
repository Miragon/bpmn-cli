/**
 * A project's bpmnlint configuration (.bpmnlintrc) as a validator
 * (src/validators.ts). Browser-safe: bpmnlint itself is injected, this module
 * never imports it; the node layer (src/node/bpmnlint.ts) finds the
 * .bpmnlintrc, loads bpmnlint and @miragon/bpmnlint-plugin-rules and builds
 * the resolver.
 *
 *   const engine = { Linter, resolver }                      bpmnlint's Linter + a resolver (bundled, chained)
 *   const resolved = await resolveBpmnlintConfig(engine, rc)  extends flattened, every rule resolved once
 *   bpmnlintValidator(engine, resolved, { detail })           a NamedValidator, advisory unless `blocks`
 *
 * resolveBpmnlintConfig walks `extends` like bpmnlint's Linter (parents in
 * order, then the config's own rules, per rule the last one wins), but a
 * config it cannot resolve is left out and listed (`unavailable`) instead of
 * failing the whole configuration, and so is a rule name it cannot parse or a
 * rule it cannot resolve. A config that extends itself, directly or through
 * others (bpmnlint has no guard and fails on it), is walked once: its rules
 * apply, the extends that closes the cycle is listed. `rules` are the
 * effective settings, keyed by bpmnlint's normalised names (`label-required`,
 * `camunda-compat/history-time-to-live`, `@miragon/rules/element-id-naming`),
 * `off` ones included: `{ severity, config }`, `config` as bpmnlint hands it
 * to the rule (`{}` for a bare flag, undefined for `["warn"]`). A flag other
 * than off / 0 / error / 2 / info / 3 runs the rule as a warning, like
 * bpmnlint.
 *
 * The validator lints each document with a NEW Linter over the effective
 * rules (rule instances live as long as their Linter, and stateful rules such
 * as no-duplicate-sequence-flows report false findings on a reused one), on
 * the XML parsed again with the configuration's moddle extensions only: what
 * is written, incoming / outgoing lists as the file keeps them, as CI sees it.
 *
 * Findings: code = the rule's normalised name, element = the report's id,
 * severity error for category error (warn and info: warning), key = id +
 * the report's path without array indices + message (compareRuns renames the
 * ids in it; an earlier sibling removed does not change it). Besides:
 *  - `notes`: the host's findings about the configuration (W_CONFIG_IGNORED),
 *    in every run, so a write only counts them;
 *  - a rule that throws (its factory on the options, or its check on an
 *    element) is left out of that run: W_LINT_FAILED, nothing on stderr; so
 *    is an async check that rejects and a factory that returns a promise
 *    (bpmnlint rules are synchronous);
 *  - what could not be resolved: W_LINT_UNAVAILABLE, one per package and reason;
 *  - the import warnings of the lint parse bpmn-cli's reader does not report
 *    itself: `import-warning` errors, as bpmnlint's CLI reports them, with a
 *    hint (bpmn-cli's decision link in a model without an engine: its own);
 *  - no-implicit-end, no-implicit-start, no-disconnected and
 *    event-based-gateway (which counts the outgoing list) read the incoming /
 *    outgoing lists, which bpmn-cli writes only where a file keeps them: a
 *    finding the element's sequence flows contradict is left out of a write
 *    (before / after) and carries a hint in `bpmn validate` (check);
 *  - BPMNLINT_COVERS: bpmn-cli's lint warning about the same element is
 *    dropped where a covering rule reports, and the finding takes its hint.
 * The validator never throws: what goes wrong is W_LINT_FAILED.
 */
import { BpmnModdle } from 'bpmn-moddle';
import { isDecisionLinkWarning, reportedImportWarnings } from './ops/decision.js';
import type { NamedValidator, ValidatorContext, ValidatorFinding } from './validators.js';

export const BPMNLINT_VALIDATOR = 'bpmnlint';

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

/** The reason of a moddleExtensions that is a string, not an object of prefix -> descriptor. */
const MODDLE_NOT_A_MAP = 'it is not an object of prefix -> descriptor or module path (bpmnlint fails on the whole file with it)';

/**
 * The entries of a configuration's moddleExtensions: prefix -> descriptor or
 * module path. An object only (an array too, like bpmnlint's for-in); a
 * string, a number or a boolean has none (a string: MODDLE_NOT_A_MAP).
 */
export function moddleEntries(config: BpmnlintConfig): Array<[string, unknown]> {
  const map: unknown = config.moddleExtensions;
  return map && typeof map === 'object' ? Object.entries(map) : [];
}

/** How deep `extends` may nest (cycles are cut before: CYCLE). */
const MAX_DEPTH = 16;

/** The reason of an extends that closes a cycle. */
const CYCLE = 'it extends itself, directly or through the configs it extends (a cycle; bpmnlint fails on the whole file with it); its rules apply once';

function firstLine(err: unknown): string {
  return String((err as Error)?.message ?? err).split('\n')[0]!;
}

function hintOf(err: unknown): { hint?: string } {
  const hint = (err as { hint?: unknown })?.hint;
  return typeof hint === 'string' ? { hint } : {};
}

function severityOf(category: unknown): BpmnlintSeverity {
  if (category === 'off') return 'off';
  return category === 'error' || category === 'info' ? category : 'warn';
}

/**
 * The effective configuration (see the module header). `opts.moddleExtensions`:
 * descriptors the host resolved for the module paths of `config.moddleExtensions`
 * (descriptor objects in the configuration are used as they are).
 */
export async function resolveBpmnlintConfig(engine: BpmnlintEngine, config: BpmnlintConfig, opts: { moddleExtensions?: Record<string, object> } = {}): Promise<ResolvedBpmnlintConfig> {
  const linter = new engine.Linter({ resolver: engine.resolver });
  const unavailable: BpmnlintUnavailable[] = [];

  // `stack`: the configs being walked (a name on it again closes a cycle, listed once)
  const flatten = async (cfg: BpmnlintConfig, stack: readonly string[]): Promise<Record<string, unknown>> => {
    const merged: Record<string, unknown> = {};
    const parents = cfg.extends === undefined ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends];
    for (const name of parents as unknown[]) {
      if (typeof name !== 'string') {
        unavailable.push({ kind: 'config', name: JSON.stringify(name) ?? String(name), pkg: '', reason: 'extends takes config names (strings)', hint: 'Write it as bpmnlint:<config> or plugin:<plugin>/<config>.' });
        continue;
      }
      if (stack.includes(name)) {
        if (!unavailable.some((u) => u.name === name && u.reason === CYCLE)) unavailable.push({ kind: 'config', name, pkg: '', reason: CYCLE });
        continue;
      }
      if (stack.length >= MAX_DEPTH) {
        unavailable.push({ kind: 'config', name, pkg: '', reason: `extends nests deeper than ${MAX_DEPTH} levels` });
        continue;
      }
      let pkg = '';
      let parent: BpmnlintConfig;
      try {
        pkg = linter.parseConfigName(name).pkg;
        parent = await linter.resolveConfig(name);
      } catch (err) {
        unavailable.push({ kind: 'config', name, pkg, reason: firstLine(err), ...hintOf(err) });
        continue;
      }
      Object.assign(merged, await flatten(parent, [...stack, name]));
    }
    // one entry at a time: a name bpmnlint cannot parse leaves out only that entry (bpmnlint fails on the whole file)
    const own = cfg.rules && typeof cfg.rules === 'object' && !Array.isArray(cfg.rules) ? cfg.rules : {};
    for (const [name, value] of Object.entries(own)) {
      try {
        Object.assign(merged, linter.normalizeConfig({ rules: { [name]: value } }, 'bpmnlint').rules);
      } catch {
        unavailable.push({ kind: 'rule', name, pkg: '', reason: 'unparseable rule name', hint: 'Write it as <rule>, <plugin>/<rule> or @scope/<plugin>/<rule> (bpmnlint fails on the whole file with it).' });
      }
    }
    return merged;
  };

  const rules: Record<string, BpmnlintRuleSetting> = {};
  for (const [name, value] of Object.entries(await flatten(config, []))) {
    const parsed = linter.parseRuleValue(value);
    const severity = severityOf(parsed.category);
    if (severity !== 'off') {
      const { pkg, ruleName } = linter.parseRuleName(name);
      try {
        const factory = await engine.resolver.resolveRule(pkg, ruleName);
        if (typeof factory !== 'function') throw new Error(`unknown rule <${name}>`);
      } catch (err) {
        unavailable.push({ kind: 'rule', name, pkg, reason: firstLine(err), ...hintOf(err) });
        continue;
      }
    }
    rules[name] = { severity, config: parsed.config };
  }

  const moddleExtensions: Record<string, object> = {};
  // a string instead of prefix -> descriptor: one entry, not one per character (bpmnlint fails on the whole file with it)
  const map: unknown = config.moddleExtensions;
  if (typeof map === 'string') unavailable.push({ kind: 'moddle', name: 'moddleExtensions', pkg: JSON.stringify(map), reason: MODDLE_NOT_A_MAP, hint: 'Write it as an object of prefix -> descriptor, e.g. { "camunda": "camunda-bpmn-moddle/resources/camunda.json" }.' });
  for (const [prefix, value] of moddleEntries(config)) {
    if (value && typeof value === 'object') moddleExtensions[prefix] = value;
    // a number, a boolean, null: bpmnlint fails on the whole file with it
    else if (typeof value !== 'string') unavailable.push({ kind: 'moddle', name: prefix, pkg: JSON.stringify(value) ?? String(value), reason: 'neither a descriptor object nor a module path (bpmnlint fails on the whole file with it)', hint: 'Name the JSON descriptor (e.g. camunda-bpmn-moddle/resources/camunda.json), or remove the moddleExtensions entry.' });
    else if (opts.moddleExtensions?.[prefix]) moddleExtensions[prefix] = opts.moddleExtensions[prefix]!;
    // a module path the host resolved nothing for (the node layer resolves them and lists what it cannot itself)
    else if (!opts.moddleExtensions) unavailable.push({ kind: 'moddle', name: prefix, pkg: String(value), reason: 'a module path, which the host resolves', hint: 'Put the descriptor object into the configuration, or pass it in resolveBpmnlintConfig\'s moddleExtensions.' });
  }
  return { rules, unavailable, moddleExtensions };
}

/**
 * bpmn-cli's lint warnings a bpmnlint rule says again about the same element
 * (NamedValidator.covers): where the rule reports, the warning is dropped and
 * the finding takes its hint. A rule that is off reports nothing and covers nothing.
 */
export const BPMNLINT_COVERS: Record<string, string> = {
  'start-event-required': 'W_NO_START',
  'end-event-required': 'W_NO_END',
  'no-implicit-end': 'W_DEAD_END',
};

/** The sequence flows of a model by flow node id: the ids they enter, and how many leave each id (from the flows, not the lists). */
interface FlowEnds {
  incoming: Set<string>;
  outgoing: Map<string, number>;
}

/** The rules that read the incoming / outgoing lists of a flow node, and when the node's sequence flows make their finding false. */
const LIST_RULES: Record<string, (id: string, ends: FlowEnds) => boolean> = {
  'no-implicit-end': (id, e) => e.outgoing.has(id),
  'no-implicit-start': (id, e) => e.incoming.has(id),
  'no-disconnected': (id, e) => e.outgoing.has(id) || e.incoming.has(id),
  // counts the outgoing list (its other finding is on a conditional flow: a flow id, never contradicted)
  'event-based-gateway': (id, e) => (e.outgoing.get(id) ?? 0) >= 2,
};

/** The hint of an import warning of the lint parse. */
const IMPORT_HINT =
  "bpmnlint parses the file with the .bpmnlintrc's moddle extensions only and reports this as an error; bpmnlint in CI fails on it too. Fix the XML the message names: an unknown attribute needs a moddle extension that declares it (a JSON descriptor in moddleExtensions) or goes (`bpmn set <file> <id> <attr>=`), a reference needs the element it names; bpmn-cli's own finding about the same content has its command. --no-lint-config skips bpmnlint.";

/** The hint of bpmn-cli's decision link in a model without an engine, which the lint parse does not know. */
const DECISION_LINK_HINT =
  "bpmn-cli's decision link in a model without an engine (an unprefixed calledDecision on a business rule task; bpmn-cli's reader keeps it): keep it. bpmnlint does not know the attribute and fails on it in CI too; a JSON descriptor in the .bpmnlintrc's moddleExtensions that adds calledDecision (isAttr) to bpmn:BusinessRuleTask declares it.";

export interface BpmnlintValidatorOptions {
  /** why it runs, e.g. `.bpmnlintrc in models` (the validator line of results) */
  detail?: string;
  /** introduced bpmnlint errors block the write like other validator errors (default false: reported among the warnings) */
  blocks?: boolean;
  /** what the host left out besides the configuration's own (moddle extensions) */
  unavailable?: BpmnlintUnavailable[];
  /** findings about the configuration itself, reported in every run like W_LINT_UNAVAILABLE (W_CONFIG_IGNORED: values of element-id-naming new ids do not follow, src/conventions.ts) */
  notes?: ValidatorFinding[];
}

/** The unavailable entries as findings: one W_LINT_UNAVAILABLE per package and reason (the same in every phase: a write only counts them). */
export function bpmnlintUnavailableFindings(list: readonly BpmnlintUnavailable[]): ValidatorFinding[] {
  const groups = new Map<string, BpmnlintUnavailable[]>();
  for (const u of list) {
    const key = `${u.kind === 'config' || u.kind === 'rule' ? 'package' : u.kind}|${u.pkg}|${u.reason}`;
    const group = groups.get(key);
    if (group) group.push(u);
    else groups.set(key, [u]);
  }
  return [...groups].map(([key, group]) => {
    const first = group[0]!;
    const names = group.map((u) => u.name).join(', ');
    const message =
      first.kind === 'file' || first.kind === 'engine'
        ? `${first.reason}; bpmnlint did not run`
        : first.kind === 'moddle' && first.reason === MODDLE_NOT_A_MAP
          ? `moddleExtensions ${first.pkg} left out: ${first.reason}; rules reading the properties of a moddle extension may report findings that are not there`
          : first.kind === 'moddle'
            ? `moddle extension ${names} (${first.pkg}) left out: ${first.reason}; rules reading ${group.map((u) => `${u.name}:`).join(', ')} properties may report findings that are not there`
            : `${names} left out: ${first.reason}`;
    return { severity: 'warning', code: 'W_LINT_UNAVAILABLE', message, key: `unavailable|${key}|${names}`, ...(first.hint ? { hint: first.hint } : {}) };
  });
}

type Failures = Map<string, string>;

/** A promise or another thenable (an async rule's answer). */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/** The result key of a rule (bpmnlint's normalised name). */
function ruleKey(pkg: string, ruleName: string): string {
  return pkg === 'bpmnlint' ? ruleName : `${pkg.replace(/(^|\/)bpmnlint-plugin-/, '$1')}/${ruleName}`;
}

/**
 * A resolver whose rule factories cannot throw: a factory that fails on its
 * options becomes a rule without findings, recorded; so does one that
 * returns a promise (bpmnlint rules are synchronous; a rejection nobody
 * handles would end the process).
 */
function guardedResolver(resolver: BpmnlintResolver, failures: Failures): BpmnlintResolver {
  return {
    resolveConfig: (pkg, name) => resolver.resolveConfig(pkg, name),
    async resolveRule(pkg, ruleName) {
      const factory = await resolver.resolveRule(pkg, ruleName);
      if (typeof factory !== 'function') return factory;
      return (options: unknown): BpmnlintRule => {
        try {
          const rule = (factory as (o: unknown) => BpmnlintRule)(options);
          if (!isThenable(rule)) return rule;
          Promise.resolve(rule).then(undefined, () => undefined);
          failures.set(ruleKey(pkg, ruleName), 'the rule factory returned a promise (bpmnlint rules are synchronous)');
        } catch (err) {
          failures.set(ruleKey(pkg, ruleName), firstLine(err));
        }
        return { check: () => undefined };
      };
    },
  };
}

/**
 * transformRule: a check that throws ends its rule for this run (bpmnlint
 * would print to stderr and drop it); a rule without check, too. An async
 * check (bpmnlint does not wait for it) keeps what it reported before its
 * first await; its rejection is recorded like a throw (`pending`: settled
 * before the findings are read), never left unhandled.
 */
function guardRule(failures: Failures, pending: Array<Promise<unknown>>) {
  return (rule: BpmnlintRule, { pkg, ruleName }: { pkg: string; ruleName: string }): BpmnlintRule => {
    const name = ruleKey(pkg, ruleName);
    const guard = (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
      if (failures.has(name)) return false;
      try {
        const result = fn(...args);
        if (!isThenable(result)) return result;
        pending.push(Promise.resolve(result).then(undefined, (err: unknown) => void (failures.has(name) || failures.set(name, firstLine(err)))));
        return undefined;
      } catch (err) {
        failures.set(name, firstLine(err));
        return false;
      }
    };
    const check = rule?.check;
    if (typeof check === 'function') return { ...rule, check: guard(check as (...args: unknown[]) => unknown) };
    const parts = check && typeof check === 'object' ? (check as { enter?: unknown; leave?: unknown }) : {};
    const guarded: Record<string, unknown> = {};
    for (const part of ['enter', 'leave'] as const) if (typeof parts[part] === 'function') guarded[part] = guard(parts[part] as (...args: unknown[]) => unknown);
    if (!Object.keys(guarded).length) {
      failures.set(name, 'the rule has no check');
      return { ...rule, check: () => undefined };
    }
    return { ...rule, check: guarded };
  };
}

interface ModdleNode {
  $type?: string;
  id?: string;
  rootElements?: ModdleNode[];
  flowElements?: ModdleNode[];
  sourceRef?: ModdleNode;
  targetRef?: ModdleNode;
}

/** The ids of the flow nodes sequence flows leave (how many) and enter, from the flows themselves (not the lists). */
function flowEnds(root: ModdleNode): FlowEnds {
  const incoming = new Set<string>();
  const outgoing = new Map<string, number>();
  const visit = (el: ModdleNode, depth: number): void => {
    if (depth > 64) return;
    for (const child of el.flowElements ?? []) {
      if (child.$type === 'bpmn:SequenceFlow') {
        if (child.sourceRef?.id) outgoing.set(child.sourceRef.id, (outgoing.get(child.sourceRef.id) ?? 0) + 1);
        if (child.targetRef?.id) incoming.add(child.targetRef.id);
      }
      visit(child, depth + 1);
    }
  };
  for (const el of root.rootElements ?? []) visit(el, 0);
  return { incoming, outgoing };
}

/** The NamedValidator of a resolved configuration (see the module header). */
export function bpmnlintValidator(engine: BpmnlintEngine, resolved: ResolvedBpmnlintConfig, opts: BpmnlintValidatorOptions = {}): NamedValidator {
  // the Linter gets the effective, resolvable, enabled rules: no extends to walk and no unresolvable name per run
  const rules: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(resolved.rules)) if (s.severity !== 'off') rules[name] = [s.severity, s.config];
  const notes = [...bpmnlintUnavailableFindings([...resolved.unavailable, ...(opts.unavailable ?? [])]), ...(opts.notes ?? [])];
  let moddle: BpmnModdle | undefined;
  return {
    name: BPMNLINT_VALIDATOR,
    ...(opts.detail ? { detail: opts.detail } : {}),
    blocks: opts.blocks ?? false,
    covers: BPMNLINT_COVERS,
    async validate(xml: string, ctx: ValidatorContext): Promise<ValidatorFinding[]> {
      const out: ValidatorFinding[] = [...notes];
      if (!Object.keys(rules).length) return out;
      const failures: Failures = new Map();
      const pending: Array<Promise<unknown>> = [];
      try {
        moddle ??= new BpmnModdle(resolved.moddleExtensions);
        const { rootElement, warnings } = await moddle.fromXML(xml);
        const linter = new engine.Linter({ config: { rules }, resolver: guardedResolver(engine.resolver, failures), transformRule: guardRule(failures, pending) });
        const results = await linter.lint(rootElement);
        // async checks: what rejects within a turn of the event loop is a W_LINT_FAILED (one that never settles does not hold the run)
        if (pending.length) await Promise.race([Promise.all(pending), new Promise<void>((done) => (typeof setTimeout === 'function' ? setTimeout(done, 0) : done()))]);
        let ends: ReturnType<typeof flowEnds> | undefined;
        for (const [rule, reports] of Object.entries(results)) {
          if (failures.has(rule)) continue;
          for (const r of reports) {
            if (r.category === 'rule-error') {
              failures.set(rule, firstLine(r.message));
              continue;
            }
            const id = r.id === undefined || r.id === null ? undefined : String(r.id);
            let hint: string | undefined;
            const list = LIST_RULES[rule];
            if (list && id) {
              ends ??= flowEnds(rootElement as ModdleNode);
              if (list(id, ends)) {
                // a write compares what it changed: a finding of the lists the file does not keep is not news
                if (ctx.phase !== 'check') continue;
                hint = `The element has sequence flows the file does not list under incoming / outgoing, which ${rule} reads (bpmnlint in CI reports it too); bpmn-cli writes those lists only where the file keeps them.`;
              }
            }
            const path = (r.path ?? []).filter((p) => typeof p !== 'number').join('.');
            out.push({ severity: r.category === 'error' ? 'error' : 'warning', code: rule, message: String(r.message), ...(id ? { element: id } : {}), key: `${id ?? ''}|${path}|${r.message}`, ...(hint ? { hint } : {}) });
          }
        }
        for (const [rule, msg] of failures) {
          out.push({ severity: 'warning', code: 'W_LINT_FAILED', message: `bpmnlint rule ${rule} failed: ${msg}; its findings are left out`, key: `failed|${rule}`, hint: 'Fix the rule or its options in the .bpmnlintrc; --no-lint-config skips bpmnlint.' });
        }
        if (warnings?.length) {
          // the lint parse's import warnings (bpmnlint's CLI reports them as errors) that bpmn-cli's reader does not report itself
          const doc = await ctx.doc();
          const own = new Set(reportedImportWarnings(doc).map((w) => w.message.split('\n')[0]));
          for (const w of warnings) {
            const msg = w.message.split('\n')[0]!;
            if (own.has(msg)) continue;
            const id = (w.element as { id?: string } | undefined)?.id;
            const hint = isDecisionLinkWarning(w) && doc.platform() === undefined ? DECISION_LINK_HINT : IMPORT_HINT;
            out.push({ severity: 'error', code: 'import-warning', message: `Import warning: ${msg}`, ...(id ? { element: id } : {}), key: `import|${id ?? ''}|${msg}`, hint });
          }
        }
      } catch (err) {
        out.push({ severity: 'warning', code: 'W_LINT_FAILED', message: `bpmnlint could not lint the model: ${firstLine(err)}`, key: 'failed|', hint: "No rule ran. Check the .bpmnlintrc's moddleExtensions (a descriptor bpmnlint cannot load fails in CI too); else report the file and the .bpmnlintrc. --no-lint-config skips bpmnlint." });
      }
      return out;
    },
  };
}
