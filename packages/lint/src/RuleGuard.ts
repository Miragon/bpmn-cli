import { LintFindings } from './LintFindings.js';
import type { LintResolver, LintRule } from './LintPlugins.js';

type Check = (...args: unknown[]) => unknown;

export class RuleGuard {
  readonly failures = new Map<string, string>();
  private readonly pending: Array<Promise<unknown>> = [];

  constructor(private readonly plugins: LintResolver) {}

  resolver(): LintResolver {
    return {
      resolveConfig: (pkg, name) => this.plugins.resolveConfig(pkg, name),
      resolveRule: async (pkg, ruleName) => {
        const factory = await this.plugins.resolveRule(pkg, ruleName);
        return typeof factory === 'function' ? this.guardedFactory(factory as (options: unknown) => LintRule, RuleGuard.ruleKey(pkg, ruleName)) : factory;
      },
    };
  }

  guarded(rule: LintRule, { pkg, ruleName }: { pkg: string; ruleName: string }): LintRule {
    const name = RuleGuard.ruleKey(pkg, ruleName);
    const { check } = rule;
    if (typeof check === 'function') {
      return { ...rule, check: this.guardedCheck(check as Check, name) };
    }
    const parts = Object.entries(check && typeof check === 'object' ? check : {}).filter(([key, part]) => (key === 'enter' || key === 'leave') && typeof part === 'function');
    const guardedParts = Object.fromEntries(parts.map(([key, part]) => [key, this.guardedCheck(part as Check, name)]));
    if (!Object.keys(guardedParts).length) {
      this.failures.set(name, 'the rule has no check');
      return { ...rule, check: () => undefined };
    }
    return { ...rule, check: guardedParts };
  }

  async settled(): Promise<void> {
    if (this.pending.length) {
      await Promise.race([Promise.all(this.pending), new Promise((done) => setTimeout(done, 0))]);
    }
  }

  private guardedFactory(factory: (options: unknown) => LintRule, name: string): (options: unknown) => LintRule {
    return (options) => {
      try {
        const rule = factory(options);
        if (!RuleGuard.isThenable(rule)) {
          return rule;
        }
        Promise.resolve(rule).then(undefined, () => undefined);
        this.failures.set(name, 'the rule factory returned a promise (bpmnlint rules are synchronous)');
      } catch (error) {
        this.failures.set(name, LintFindings.firstLine(error));
      }
      return { check: () => undefined };
    };
  }

  private guardedCheck(check: Check, name: string): Check {
    return (...args) => {
      try {
        const result = this.failures.has(name) ? false : check(...args);
        if (!RuleGuard.isThenable(result)) {
          return result;
        }
        this.pending.push(Promise.resolve(result).catch((error: unknown) => this.noteFailure(name, error)));
        return undefined;
      } catch (error) {
        this.noteFailure(name, error);
        return false;
      }
    };
  }

  private noteFailure(name: string, error: unknown): void {
    if (!this.failures.has(name)) {
      this.failures.set(name, LintFindings.firstLine(error));
    }
  }

  private static isThenable(value: unknown): value is PromiseLike<unknown> {
    return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function';
  }

  private static ruleKey(pkg: string, ruleName: string): string {
    return pkg === 'bpmnlint' ? ruleName : `${pkg.replace(/(^|\/)bpmnlint-plugin-/, '$1')}/${ruleName}`;
  }
}
