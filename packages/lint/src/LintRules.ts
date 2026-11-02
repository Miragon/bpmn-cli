import { LintFindings, type LintUnavailable } from './LintFindings.js';
import type { Linter, LintPlugins } from './LintPlugins.js';

export type EnabledRules = Record<string, [category: string, options: unknown]>;

const MAX_DEPTH = 16;
const CYCLE = 'it extends itself, directly or through the configs it extends (a cycle; bpmnlint fails on the whole file with it); its rules apply once';

export class LintRules {
  readonly unavailable: LintUnavailable[] = [];
  private readonly linter: Linter;

  constructor(
    private readonly plugins: LintPlugins,
    private readonly content: Record<string, unknown>,
  ) {
    this.linter = plugins.linter();
  }

  async enabled(): Promise<EnabledRules> {
    const enabled: EnabledRules = {};
    const merged = await this.flatten(this.content, []);
    for (const [name, value] of Object.entries(merged)) {
      const { category, config } = this.linter.parseRuleValue(value);
      if (category !== 'off' && (await this.resolves(name))) {
        enabled[name] = [category === 'error' || category === 'info' ? category : 'warn', config];
      }
    }
    return enabled;
  }

  private async resolves(name: string): Promise<boolean> {
    const { pkg, ruleName } = this.linter.parseRuleName(name);
    try {
      const factory = await this.plugins.resolveRule(pkg, ruleName);
      if (typeof factory !== 'function') {
        throw new Error(`unknown rule <${name}>`);
      }
      return true;
    } catch (error) {
      this.unavailable.push({ kind: 'rule', name, pkg, reason: LintFindings.firstLine(error), ...LintRules.hintOf(error) });
      return false;
    }
  }

  private async flatten(content: Record<string, unknown>, stack: readonly string[]): Promise<Record<string, unknown>> {
    const merged: Record<string, unknown> = {};
    const parents = content['extends'] === undefined ? [] : [content['extends']].flat();
    for (const parent of parents as unknown[]) {
      Object.assign(merged, await this.rulesOfParent(parent, stack));
    }
    const own = content['rules'];
    const rules = own && typeof own === 'object' && !Array.isArray(own) ? own : {};
    for (const [name, value] of Object.entries(rules)) {
      Object.assign(merged, this.normalized(name, value));
    }
    return merged;
  }

  private async rulesOfParent(parent: unknown, stack: readonly string[]): Promise<Record<string, unknown>> {
    if (typeof parent !== 'string') {
      this.unavailable.push({ kind: 'config', name: JSON.stringify(parent) ?? String(parent), pkg: '', reason: 'extends takes config names (strings)', hint: 'Write it as bpmnlint:<config> or plugin:<plugin>/<config>.' });
      return {};
    }
    if (stack.includes(parent)) {
      if (!this.unavailable.some(({ name, reason }) => name === parent && reason === CYCLE)) {
        this.unavailable.push({ kind: 'config', name: parent, pkg: '', reason: CYCLE });
      }
      return {};
    }
    if (stack.length >= MAX_DEPTH) {
      this.unavailable.push({ kind: 'config', name: parent, pkg: '', reason: `extends nests deeper than ${MAX_DEPTH} levels` });
      return {};
    }
    let pkg = '';
    try {
      pkg = this.linter.parseConfigName(parent).pkg;
      return await this.flatten(await this.linter.resolveConfig(parent), [...stack, parent]);
    } catch (error) {
      this.unavailable.push({ kind: 'config', name: parent, pkg, reason: LintFindings.firstLine(error), ...LintRules.hintOf(error) });
      return {};
    }
  }

  private normalized(name: string, value: unknown): Record<string, unknown> {
    try {
      return this.linter.normalizeConfig({ rules: { [name]: value } }, 'bpmnlint').rules;
    } catch {
      this.unavailable.push({ kind: 'rule', name, pkg: '', reason: 'unparseable rule name', hint: 'Write it as <rule>, <plugin>/<rule> or @scope/<plugin>/<rule> (bpmnlint fails on the whole file with it).' });
      return {};
    }
  }

  private static hintOf(error: unknown): { hint?: string } {
    const hint = (error as { hint?: unknown }).hint;
    return typeof hint === 'string' ? { hint } : {};
  }
}
