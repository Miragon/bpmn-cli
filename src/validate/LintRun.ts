import type { BpmnlintEngine, BpmnlintResolver, BpmnlintRule } from './bpmnlint-validator.js';
import type { ValidatorContext, ValidatorFinding } from './validators.js';
import { firstLine } from '../shared/utils/text.js';

/** From the sequence flows themselves, not the incoming / outgoing lists. */
interface FlowEnds {
  incoming: Set<string>;
  outgoing: Map<string, number>;
}

/** Rules that read the incoming / outgoing lists, and when the node's flows contradict them. */
const LIST_RULES: Record<string, (id: string, ends: FlowEnds) => boolean> = {
  'no-implicit-end': (id, ends) => ends.outgoing.has(id),
  'no-implicit-start': (id, ends) => ends.incoming.has(id),
  'no-disconnected': (id, ends) => ends.outgoing.has(id) || ends.incoming.has(id),
  // its other finding is about a conditional flow, which the lists never contradict
  'event-based-gateway': (id, ends) => (ends.outgoing.get(id) ?? 0) >= 2,
};

const LISTS_LEFT_OUT = 'incoming / outgoing lists the file does not keep';

interface ModdleNode {
  $type?: string;
  id?: string;
  rootElements?: ModdleNode[];
  flowElements?: ModdleNode[];
  sourceRef?: ModdleNode;
  targetRef?: ModdleNode;
}

/**
 * One lint of one document with a NEW Linter: stateful rules such as
 * no-duplicate-sequence-flows report false findings on a reused one.
 * A rule that throws or answers with a promise is left out as W_LINT_FAILED.
 */
export class LintRun {
  private readonly failures = new Map<string, string>();
  private readonly pending: Array<Promise<unknown>> = [];
  private ends: FlowEnds | undefined;

  constructor(
    private readonly engine: BpmnlintEngine,
    private readonly ctx: ValidatorContext,
    private readonly out: ValidatorFinding[],
  ) {}

  async lint(rules: Record<string, unknown>, rootElement: unknown): Promise<void> {
    const linter = new this.engine.Linter({ config: { rules }, resolver: this.guardedResolver(), transformRule: (rule, info) => this.guardRule(rule, info) });
    const results = await linter.lint(rootElement);
    // an async check that never settles must not hold the run: wait one event loop turn
    if (this.pending.length) await Promise.race([Promise.all(this.pending), new Promise<void>((done) => (typeof setTimeout === 'function' ? setTimeout(done, 0) : done()))]);
    for (const [rule, reports] of Object.entries(results)) {
      if (this.failures.has(rule)) continue;
      for (const report of reports) {
        if (report.category === 'rule-error') {
          this.failures.set(rule, firstLine(report.message));
          continue;
        }
        const id = report.id === undefined || report.id === null ? undefined : String(report.id);
        let hint: string | undefined;
        let leftOut: string | undefined;
        const list = LIST_RULES[rule];
        if (list && id) {
          this.ends ??= this.flowEnds(rootElement as ModdleNode);
          if (list(id, this.ends)) {
            hint = `The element has sequence flows the file does not list under incoming / outgoing, which ${rule} reads (bpmnlint in CI reports it too); bpmn-cli writes those lists only where the file keeps them.`;
            // a finding about lists the file does not keep is not news to a write
            if (this.ctx.phase !== 'check') leftOut = LISTS_LEFT_OUT;
          }
        }
        const path = (report.path ?? []).filter((segment) => typeof segment !== 'number').join('.');
        this.out.push({ severity: report.category === 'error' ? 'error' : 'warning', code: rule, message: String(report.message), ...(id ? { element: id } : {}), key: `${id ?? ''}|${path}|${report.message}`, ...(hint ? { hint } : {}), ...(leftOut ? { leftOut } : {}) });
      }
    }
    for (const [rule, msg] of this.failures) {
      this.out.push({ severity: 'warning', code: 'W_LINT_FAILED', message: `bpmnlint rule ${rule} failed: ${msg}; its findings are left out`, key: `failed|${rule}`, hint: 'Fix the rule or its options in the .bpmnlintrc; --no-lint-config skips bpmnlint.' });
    }
  }

  /** bpmnlint rules are synchronous; a rejection nobody handles would end the process. */
  private guardedResolver(): BpmnlintResolver {
    const resolver = this.engine.resolver;
    return {
      resolveConfig: (pkg, name) => resolver.resolveConfig(pkg, name),
      resolveRule: async (pkg, ruleName) => {
        const factory = await resolver.resolveRule(pkg, ruleName);
        if (typeof factory !== 'function') return factory;
        return (options: unknown): BpmnlintRule => {
          try {
            const rule = (factory as (ruleOptions: unknown) => BpmnlintRule)(options);
            if (!this.isThenable(rule)) return rule;
            Promise.resolve(rule).then(undefined, () => undefined);
            this.failures.set(this.ruleKey(pkg, ruleName), 'the rule factory returned a promise (bpmnlint rules are synchronous)');
          } catch (err) {
            this.failures.set(this.ruleKey(pkg, ruleName), firstLine(err));
          }
          return { check: () => undefined };
        };
      },
    };
  }

  /**
   * bpmnlint would print a throwing check to stderr and drop it. It does not wait for an
   * async check: its rejection is recorded like a throw, never left unhandled.
   */
  private guardRule(rule: BpmnlintRule, { pkg, ruleName }: { pkg: string; ruleName: string }): BpmnlintRule {
    const name = this.ruleKey(pkg, ruleName);
    const guard = (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
      if (this.failures.has(name)) return false;
      try {
        const result = fn(...args);
        if (!this.isThenable(result)) return result;
        this.pending.push(Promise.resolve(result).then(undefined, (err: unknown) => void (this.failures.has(name) || this.failures.set(name, firstLine(err)))));
        return undefined;
      } catch (err) {
        this.failures.set(name, firstLine(err));
        return false;
      }
    };
    const check = rule?.check;
    if (typeof check === 'function') return { ...rule, check: guard(check as (...args: unknown[]) => unknown) };
    const parts = check && typeof check === 'object' ? (check as { enter?: unknown; leave?: unknown }) : {};
    const guarded: Record<string, unknown> = {};
    for (const part of ['enter', 'leave'] as const) if (typeof parts[part] === 'function') guarded[part] = guard(parts[part] as (...args: unknown[]) => unknown);
    if (!Object.keys(guarded).length) {
      this.failures.set(name, 'the rule has no check');
      return { ...rule, check: () => undefined };
    }
    return { ...rule, check: guarded };
  }

  private flowEnds(root: ModdleNode): FlowEnds {
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

  private isThenable(value: unknown): value is PromiseLike<unknown> {
    return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function';
  }

  /** bpmnlint's normalised name */
  private ruleKey(pkg: string, ruleName: string): string {
    return pkg === 'bpmnlint' ? ruleName : `${pkg.replace(/(^|\/)bpmnlint-plugin-/, '$1')}/${ruleName}`;
  }
}
