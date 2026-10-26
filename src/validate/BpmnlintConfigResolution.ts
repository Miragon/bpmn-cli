import { BpmnModdle } from 'bpmn-moddle';
import type { BpmnlintConfig, BpmnlintEngine, BpmnlintLinter, BpmnlintRuleSetting, BpmnlintSeverity, BpmnlintUnavailable, ResolvedBpmnlintConfig } from './bpmnlint-validator.js';
import { MODDLE_NOT_A_MAP, moddleEntries } from './utils/bpmnlint.js';
import { firstLine } from '../shared/utils/text.js';

const MAX_DEPTH = 16;

const CYCLE = 'it extends itself, directly or through the configs it extends (a cycle; bpmnlint fails on the whole file with it); its rules apply once';

/**
 * The effective configuration of a .bpmnlintrc, walking `extends` like bpmnlint's Linter.
 * Where bpmnlint fails on the whole file (an unresolvable config or rule, a cycle, a rejected
 * moddle descriptor), only that part is left out and listed as `unavailable`.
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

  /** A name on `stack` again closes a cycle. */
  private async flatten(cfg: BpmnlintConfig, stack: readonly string[]): Promise<Record<string, unknown>> {
    const merged: Record<string, unknown> = {};
    const parents = cfg.extends === undefined ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends];
    for (const name of parents as unknown[]) {
      if (typeof name !== 'string') {
        this.unavailable.push({ kind: 'config', name: JSON.stringify(name) ?? String(name), pkg: '', reason: 'extends takes config names (strings)', hint: 'Write it as bpmnlint:<config> or plugin:<plugin>/<config>.' });
        continue;
      }
      if (stack.includes(name)) {
        if (!this.unavailable.some((entry) => entry.name === name && entry.reason === CYCLE)) this.unavailable.push({ kind: 'config', name, pkg: '', reason: CYCLE });
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
    // one entry at a time: a name bpmnlint cannot parse leaves out only that entry
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
    // a string instead of prefix -> descriptor: one entry, not one per character
    const map: unknown = this.config.moddleExtensions;
    if (typeof map === 'string') this.unavailable.push({ kind: 'moddle', name: 'moddleExtensions', pkg: JSON.stringify(map), reason: MODDLE_NOT_A_MAP, hint: 'Write it as an object of prefix -> descriptor, e.g. { "camunda": "camunda-bpmn-moddle/resources/camunda.json" }.' });
    for (const [prefix, value] of moddleEntries(this.config)) {
      if (value && typeof value === 'object') moddleExtensions[prefix] = value;
      else if (typeof value !== 'string') this.unavailable.push({ kind: 'moddle', name: prefix, pkg: JSON.stringify(value) ?? String(value), reason: 'neither a descriptor object nor a module path (bpmnlint fails on the whole file with it)', hint: 'Name the JSON descriptor (e.g. camunda-bpmn-moddle/resources/camunda.json), or remove the moddleExtensions entry.' });
      else if (this.opts.moddleExtensions?.[prefix]) moddleExtensions[prefix] = this.opts.moddleExtensions[prefix]!;
      // the node layer resolves module paths and lists what it cannot itself
      else if (!this.opts.moddleExtensions) this.unavailable.push({ kind: 'moddle', name: prefix, pkg: String(value), reason: 'a module path, which the host resolves', hint: 'Put the descriptor object into the configuration, or pass it in resolveBpmnlintConfig\'s moddleExtensions.' });
    }
    // a descriptor BpmnModdle rejects would stop every rule: it alone is left out
    for (const [prefix, why] of this.rejectedDescriptors(moddleExtensions)) {
      const value = moddleEntries(this.config).find(([entryPrefix]) => entryPrefix === prefix)?.[1];
      delete moddleExtensions[prefix];
      this.unavailable.push({ kind: 'moddle', name: prefix, pkg: typeof value === 'string' ? value : 'descriptor object', reason: `BpmnModdle rejects it (${why})`, hint: 'Fix the descriptor, or remove the moddleExtensions entry; bpmnlint in CI fails on the whole file with it.' });
    }
    return moddleExtensions;
  }

  /** All at once first, so a configuration BpmnModdle accepts costs one construction. */
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
