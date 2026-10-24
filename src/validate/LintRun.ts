import type { BpmnlintEngine, BpmnlintResolver, BpmnlintRule } from './bpmnlint-validator.js';
import type { ValidatorContext, ValidatorFinding } from './validators.js';
import { firstLine } from '../shared/utils/text.js';

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

/** Why a write leaves a list-rule finding the element's sequence flows contradict out of its comparison (ValidatorFinding.leftOut). */
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
 * One lint of one document with a NEW Linter over the effective rules (rule
 * instances live as long as their Linter, and stateful rules such as
 * no-duplicate-sequence-flows report false findings on a reused one). Its
 * findings go to `out`: the rules' reports, then a W_LINT_FAILED per rule left
 * out of the run. A rule that throws (its factory on the options, or its check
 * on an element) is left out of the run, nothing on stderr; so is an async
 * check that rejects and a factory that returns a promise (bpmnlint rules are
 * synchronous). A finding of a rule that reads the incoming / outgoing lists
 * (LIST_RULES) the element's sequence flows contradict carries a hint, and a
 * write leaves it out of its comparison.
 */
export class LintRun {
  /** rule -> why it is left out of this run */
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
    // async checks: what rejects within a turn of the event loop is a W_LINT_FAILED (one that never settles does not hold the run)
    if (this.pending.length) await Promise.race([Promise.all(this.pending), new Promise<void>((done) => (typeof setTimeout === 'function' ? setTimeout(done, 0) : done()))]);
    for (const [rule, reports] of Object.entries(results)) {
      if (this.failures.has(rule)) continue;
      for (const r of reports) {
        if (r.category === 'rule-error') {
          this.failures.set(rule, firstLine(r.message));
          continue;
        }
        const id = r.id === undefined || r.id === null ? undefined : String(r.id);
        let hint: string | undefined;
        let leftOut: string | undefined;
        const list = LIST_RULES[rule];
        if (list && id) {
          this.ends ??= this.flowEnds(rootElement as ModdleNode);
          if (list(id, this.ends)) {
            hint = `The element has sequence flows the file does not list under incoming / outgoing, which ${rule} reads (bpmnlint in CI reports it too); bpmn-cli writes those lists only where the file keeps them.`;
            // a write compares what it changed: a finding of the lists the file does not keep is not news, it is counted as left out
            if (this.ctx.phase !== 'check') leftOut = LISTS_LEFT_OUT;
          }
        }
        const path = (r.path ?? []).filter((p) => typeof p !== 'number').join('.');
        this.out.push({ severity: r.category === 'error' ? 'error' : 'warning', code: rule, message: String(r.message), ...(id ? { element: id } : {}), key: `${id ?? ''}|${path}|${r.message}`, ...(hint ? { hint } : {}), ...(leftOut ? { leftOut } : {}) });
      }
    }
    for (const [rule, msg] of this.failures) {
      this.out.push({ severity: 'warning', code: 'W_LINT_FAILED', message: `bpmnlint rule ${rule} failed: ${msg}; its findings are left out`, key: `failed|${rule}`, hint: 'Fix the rule or its options in the .bpmnlintrc; --no-lint-config skips bpmnlint.' });
    }
  }

  /**
   * A resolver whose rule factories cannot throw: a factory that fails on its
   * options becomes a rule without findings, recorded; so does one that
   * returns a promise (bpmnlint rules are synchronous; a rejection nobody
   * handles would end the process).
   */
  private guardedResolver(): BpmnlintResolver {
    const resolver = this.engine.resolver;
    return {
      resolveConfig: (pkg, name) => resolver.resolveConfig(pkg, name),
      resolveRule: async (pkg, ruleName) => {
        const factory = await resolver.resolveRule(pkg, ruleName);
        if (typeof factory !== 'function') return factory;
        return (options: unknown): BpmnlintRule => {
          try {
            const rule = (factory as (o: unknown) => BpmnlintRule)(options);
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
   * transformRule: a check that throws ends its rule for this run (bpmnlint
   * would print to stderr and drop it); a rule without check, too. An async
   * check (bpmnlint does not wait for it) keeps what it reported before its
   * first await; its rejection is recorded like a throw (`pending`: settled
   * before the findings are read), never left unhandled.
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

  /** The ids of the flow nodes sequence flows leave (how many) and enter, from the flows themselves (not the lists). */
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

  /** A promise or another thenable (an async rule's answer). */
  private isThenable(value: unknown): value is PromiseLike<unknown> {
    return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function';
  }

  /** The result key of a rule (bpmnlint's normalised name). */
  private ruleKey(pkg: string, ruleName: string): string {
    return pkg === 'bpmnlint' ? ruleName : `${pkg.replace(/(^|\/)bpmnlint-plugin-/, '$1')}/${ruleName}`;
  }
}
