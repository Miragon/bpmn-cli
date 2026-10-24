import { BpmnModdle } from 'bpmn-moddle';
import type { BpmnlintConfig, BpmnlintEngine, BpmnlintLinter, BpmnlintRuleSetting, BpmnlintSeverity, BpmnlintUnavailable, ResolvedBpmnlintConfig } from './bpmnlint-validator.js';
import { MODDLE_NOT_A_MAP, moddleEntries } from './utils/bpmnlint.js';
import { firstLine } from '../shared/utils/text.js';

/** How deep `extends` may nest (cycles are cut before: CYCLE). */
const MAX_DEPTH = 16;

/** The reason of an extends that closes a cycle. */
const CYCLE = 'it extends itself, directly or through the configs it extends (a cycle; bpmnlint fails on the whole file with it); its rules apply once';

/**
 * The effective configuration of a .bpmnlintrc. It walks `extends` like
 * bpmnlint's Linter (parents in order, then the config's own rules, per rule
 * the last one wins), but a config it cannot resolve is left out and listed
 * (`unavailable`) instead of failing the whole configuration, and so is a rule
 * name it cannot parse or a rule it cannot resolve. A config that extends
 * itself, directly or through others (bpmnlint has no guard and fails on it),
 * is walked once: its rules apply, the extends that closes the cycle is
 * listed. So is a moddle descriptor BpmnModdle rejects (a prefix or uri
 * already defined, an extends of an unknown type; bpmnlint fails on the whole
 * file with it): the descriptors are added one prefix at a time, the rules run
 * with the ones it accepts. `rules` are the effective settings, keyed by
 * bpmnlint's normalised names (`label-required`,
 * `camunda-compat/history-time-to-live`, `@miragon/rules/element-id-naming`),
 * `off` ones included: `{ severity, config }`, `config` as bpmnlint hands it
 * to the rule (`{}` for a bare flag, undefined for `["warn"]`). A flag other
 * than off / 0 / error / 2 / info / 3 runs the rule as a warning, like
 * bpmnlint.
 *
 * `opts.moddleExtensions`: descriptors the host resolved for the module paths
 * of `config.moddleExtensions` (descriptor objects in the configuration are
 * used as they are).
 */
export class BpmnlintConfigResolution {
  private readonly linter: BpmnlintLinter;
  private readonly unavailable: BpmnlintUnavailable[] = [];

  constructor(
    private readonly engine: BpmnlintEngine,
    private readonly config: BpmnlintConfig,
    private readonly opts: { moddleExtensions?: Record<string, object> } = {},
  ) {
    this.linter = new engine.Linter({ resolver: engine.resolver });
  }

  async resolve(): Promise<ResolvedBpmnlintConfig> {
    const rules = await this.rules(await this.flatten(this.config, []));
    return { rules, unavailable: this.unavailable, moddleExtensions: this.moddleExtensions() };
  }

  /** `stack`: the configs being walked (a name on it again closes a cycle, listed once). */
  private async flatten(cfg: BpmnlintConfig, stack: readonly string[]): Promise<Record<string, unknown>> {
    const merged: Record<string, unknown> = {};
    const parents = cfg.extends === undefined ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends];
    for (const name of parents as unknown[]) {
      if (typeof name !== 'string') {
        this.unavailable.push({ kind: 'config', name: JSON.stringify(name) ?? String(name), pkg: '', reason: 'extends takes config names (strings)', hint: 'Write it as bpmnlint:<config> or plugin:<plugin>/<config>.' });
        continue;
      }
      if (stack.includes(name)) {
        if (!this.unavailable.some((u) => u.name === name && u.reason === CYCLE)) this.unavailable.push({ kind: 'config', name, pkg: '', reason: CYCLE });
        continue;
      }
      if (stack.length >= MAX_DEPTH) {
        this.unavailable.push({ kind: 'config', name, pkg: '', reason: `extends nests deeper than ${MAX_DEPTH} levels` });
        continue;
      }
      let pkg = '';
      let parent: BpmnlintConfig;
      try {
        pkg = this.linter.parseConfigName(name).pkg;
        parent = await this.linter.resolveConfig(name);
      } catch (err) {
        this.unavailable.push({ kind: 'config', name, pkg, reason: firstLine(err), ...this.hintOf(err) });
        continue;
      }
      Object.assign(merged, await this.flatten(parent, [...stack, name]));
    }
    // one entry at a time: a name bpmnlint cannot parse leaves out only that entry (bpmnlint fails on the whole file)
    const own = cfg.rules && typeof cfg.rules === 'object' && !Array.isArray(cfg.rules) ? cfg.rules : {};
    for (const [name, value] of Object.entries(own)) {
      try {
        Object.assign(merged, this.linter.normalizeConfig({ rules: { [name]: value } }, 'bpmnlint').rules);
      } catch {
        this.unavailable.push({ kind: 'rule', name, pkg: '', reason: 'unparseable rule name', hint: 'Write it as <rule>, <plugin>/<rule> or @scope/<plugin>/<rule> (bpmnlint fails on the whole file with it).' });
      }
    }
    return merged;
  }

  private async rules(merged: Record<string, unknown>): Promise<Record<string, BpmnlintRuleSetting>> {
    const rules: Record<string, BpmnlintRuleSetting> = {};
    for (const [name, value] of Object.entries(merged)) {
      const parsed = this.linter.parseRuleValue(value);
      const severity = this.severityOf(parsed.category);
      if (severity !== 'off') {
        const { pkg, ruleName } = this.linter.parseRuleName(name);
        try {
          const factory = await this.engine.resolver.resolveRule(pkg, ruleName);
          if (typeof factory !== 'function') throw new Error(`unknown rule <${name}>`);
        } catch (err) {
          this.unavailable.push({ kind: 'rule', name, pkg, reason: firstLine(err), ...this.hintOf(err) });
          continue;
        }
      }
      rules[name] = { severity, config: parsed.config };
    }
    return rules;
  }

  private moddleExtensions(): Record<string, object> {
    const moddleExtensions: Record<string, object> = {};
    // a string instead of prefix -> descriptor: one entry, not one per character (bpmnlint fails on the whole file with it)
    const map: unknown = this.config.moddleExtensions;
    if (typeof map === 'string') this.unavailable.push({ kind: 'moddle', name: 'moddleExtensions', pkg: JSON.stringify(map), reason: MODDLE_NOT_A_MAP, hint: 'Write it as an object of prefix -> descriptor, e.g. { "camunda": "camunda-bpmn-moddle/resources/camunda.json" }.' });
    for (const [prefix, value] of moddleEntries(this.config)) {
      if (value && typeof value === 'object') moddleExtensions[prefix] = value;
      // a number, a boolean, null: bpmnlint fails on the whole file with it
      else if (typeof value !== 'string') this.unavailable.push({ kind: 'moddle', name: prefix, pkg: JSON.stringify(value) ?? String(value), reason: 'neither a descriptor object nor a module path (bpmnlint fails on the whole file with it)', hint: 'Name the JSON descriptor (e.g. camunda-bpmn-moddle/resources/camunda.json), or remove the moddleExtensions entry.' });
      else if (this.opts.moddleExtensions?.[prefix]) moddleExtensions[prefix] = this.opts.moddleExtensions[prefix]!;
      // a module path the host resolved nothing for (the node layer resolves them and lists what it cannot itself)
      else if (!this.opts.moddleExtensions) this.unavailable.push({ kind: 'moddle', name: prefix, pkg: String(value), reason: 'a module path, which the host resolves', hint: 'Put the descriptor object into the configuration, or pass it in resolveBpmnlintConfig\'s moddleExtensions.' });
    }
    // a descriptor BpmnModdle rejects stops every rule (bpmnlint fails on the whole file with it): it alone is left out
    for (const [prefix, why] of this.rejectedDescriptors(moddleExtensions)) {
      const value = moddleEntries(this.config).find(([p]) => p === prefix)?.[1];
      delete moddleExtensions[prefix];
      this.unavailable.push({ kind: 'moddle', name: prefix, pkg: typeof value === 'string' ? value : 'descriptor object', reason: `BpmnModdle rejects it (${why})`, hint: 'Fix the descriptor, or remove the moddleExtensions entry; bpmnlint in CI fails on the whole file with it.' });
    }
    return moddleExtensions;
  }

  /**
   * The descriptors BpmnModdle rejects (prefix -> its first line), added one
   * prefix at a time to the ones it accepted; all at once first, so a
   * configuration it accepts costs one construction.
   */
  private rejectedDescriptors(descriptors: Record<string, object>): Map<string, string> {
    const rejected = new Map<string, string>();
    const entries = Object.entries(descriptors);
    if (!entries.length) return rejected;
    try {
      void new BpmnModdle(descriptors);
      return rejected;
    } catch {
      /* one at a time */
    }
    const accepted: Record<string, object> = {};
    for (const [prefix, descriptor] of entries) {
      try {
        void new BpmnModdle({ ...accepted, [prefix]: descriptor });
        accepted[prefix] = descriptor;
      } catch (err) {
        rejected.set(prefix, firstLine(err));
      }
    }
    return rejected;
  }

  private hintOf(err: unknown): { hint?: string } {
    const hint = (err as { hint?: unknown })?.hint;
    return typeof hint === 'string' ? { hint } : {};
  }

  private severityOf(category: unknown): BpmnlintSeverity {
    if (category === 'off') return 'off';
    return category === 'error' || category === 'info' ? category : 'warn';
  }
}
