import { modelError } from '../shared/utils/errors.js';
import { ISSUE_KEY, LEFT_OUT, type KeyedIssue } from './utils/validator-issues.js';
import type { NamedValidator, Validator, ValidatorContext, ValidatorFinding, ValidatorInput, ValidatorIssue, ValidatorRun, ValidatorSeverity } from './validators.js';

/** The validators of one call, each with a name. */
export class ValidatorSet {
  private readonly validators: NamedValidator[];

  constructor(list: readonly Validator[] | undefined) {
    this.validators = (list ?? []).map((v, i) => {
      if (typeof v === 'function') return { name: v.name || `validator${i + 1}`, validate: v };
      if (!v || typeof v !== 'object' || (typeof v.validate !== 'function' && typeof v.validateDoc !== 'function')) {
        throw modelError('E_VALIDATOR_FAILED', `Validator ${i + 1} is neither a function nor an object with a validate function`, {
          hint: 'Pass `validators: [(xml, ctx) => findings]` or `[{ name, validate: (xml, ctx) => findings }]`.',
        });
      }
      return { ...v, name: v.name || `validator${i + 1}` };
    });
  }

  get size(): number {
    return this.validators.length;
  }

  /** A throwing validator fails the whole run: nothing is written. */
  async run(input: ValidatorInput, ctx: Omit<ValidatorContext, 'doc'>): Promise<ValidatorRun[]> {
    const runs: ValidatorRun[] = [];
    const context: ValidatorContext = { ...ctx, doc: input.doc };
    for (const v of this.validators) {
      let found: ValidatorFinding[];
      try {
        found = v.validateDoc ? await v.validateDoc(await input.doc(), context) : await v.validate!(await input.xml(), context);
      } catch (err) {
        throw modelError('E_VALIDATOR_FAILED', `Validator ${v.name} failed on the ${ctx.phase === 'before' ? 'document before the change' : ctx.phase === 'after' ? 'changed document' : 'file'}: ${String((err as Error)?.message ?? err).split('\n')[0]}; nothing was written`, {
          validator: v.name,
          hint: 'The validator threw instead of returning findings. Fix the validator (or the input it cannot read), or run without it.',
        });
      }
      if (!Array.isArray(found)) {
        throw modelError('E_VALIDATOR_FAILED', `Validator ${v.name} returned ${typeof found} instead of an array of findings; nothing was written`, { validator: v.name });
      }
      runs.push({ name: v.name, ...(v.detail ? { detail: v.detail } : {}), ...(v.blocks === false ? { blocks: false as const } : {}), issues: found.map((f) => ValidatorSet.issueOf(v.name, f)), ...(v.covers ? { covers: v.covers } : {}) });
    }
    return runs;
  }

  private static issueOf(name: string, f: ValidatorFinding): ValidatorIssue {
    const issue: KeyedIssue = { code: String(f.code ?? f.ruleId ?? 'FINDING'), message: String(f.message ?? ''), validator: name, severity: ValidatorSet.severityOf(f.severity) };
    if (f.element) issue.element = String(f.element);
    if (f.related?.length) issue.related = f.related.map(String);
    if (f.hint) issue.hint = String(f.hint);
    if (f.key) Object.defineProperty(issue, ISSUE_KEY, { value: String(f.key), enumerable: false });
    if (f.leftOut) Object.defineProperty(issue, LEFT_OUT, { value: String(f.leftOut), enumerable: false });
    return issue;
  }

  private static severityOf(raw: unknown): ValidatorSeverity {
    return String(raw ?? '').trim().toLowerCase() === 'error' ? 'error' : 'warning';
  }
}
