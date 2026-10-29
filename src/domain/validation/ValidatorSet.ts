import { modelError } from '../document/utils/errors.js';
import { withUnserialised } from '../document/utils/finding.js';
import type { NamedValidator, Validator, ValidatorContext, ValidatorFinding, ValidatorInput, ValidatorIssue, ValidatorRun, ValidatorSeverity } from './validators.js';

/** The validators of one call, each with a name. */
export class ValidatorSet {
  private readonly validators: NamedValidator[];

  constructor(list: readonly Validator[] | undefined) {
    this.validators = (list ?? []).map((validator, index) => {
      if (typeof validator === 'function') {
        return { name: validator.name || `validator${index + 1}`, validate: validator };
      }
      if (!validator || typeof validator !== 'object' || (typeof validator.validate !== 'function' && typeof validator.validateDoc !== 'function')) {
        throw modelError('E_VALIDATOR_FAILED', `Validator ${index + 1} is neither a function nor an object with a validate function`, {
          hint: 'Pass `validators: [(xml, ctx) => findings]` or `[{ name, validate: (xml, ctx) => findings }]`.',
        });
      }
      return { ...validator, name: validator.name || `validator${index + 1}` };
    });
  }

  get size(): number {
    return this.validators.length;
  }

  /** A throwing validator fails the whole run: nothing is written. */
  async run(input: ValidatorInput, ctx: Omit<ValidatorContext, 'doc'>): Promise<ValidatorRun[]> {
    const runs: ValidatorRun[] = [];
    const context: ValidatorContext = { ...ctx, doc: input.doc };
    for (const validator of this.validators) {
      let found: ValidatorFinding[];
      try {
        found = validator.validateDoc ? await validator.validateDoc(await input.doc(), context) : await validator.validate!(await input.xml(), context);
      } catch (err) {
        throw modelError('E_VALIDATOR_FAILED', `Validator ${validator.name} failed on the ${ctx.phase === 'before' ? 'document before the change' : ctx.phase === 'after' ? 'changed document' : 'file'}: ${String((err as Error)?.message ?? err).split('\n')[0]}; nothing was written`, {
          validator: validator.name,
          hint: 'The validator threw instead of returning findings. Fix the validator (or the input it cannot read), or run without it.',
        });
      }
      if (!Array.isArray(found)) {
        throw modelError('E_VALIDATOR_FAILED', `Validator ${validator.name} returned ${typeof found} instead of an array of findings; nothing was written`, { validator: validator.name });
      }
      runs.push({ name: validator.name, ...(validator.detail ? { detail: validator.detail } : {}), ...(validator.blocks === false ? { blocks: false as const } : {}), issues: found.map((finding) => ValidatorSet.issueOf(validator.name, finding)), ...(validator.covers ? { covers: validator.covers } : {}) });
    }
    return runs;
  }

  private static issueOf(name: string, finding: ValidatorFinding): ValidatorIssue {
    const issue: ValidatorIssue = { code: String(finding.code ?? finding.ruleId ?? 'FINDING'), message: String(finding.message ?? ''), validator: name, severity: ValidatorSet.severityOf(finding.severity) };
    if (finding.element) issue.element = String(finding.element);
    if (finding.related?.length) issue.related = finding.related.map(String);
    if (finding.hint) issue.hint = String(finding.hint);
    return withUnserialised(issue, { ...(finding.key ? { key: String(finding.key) } : {}), ...(finding.leftOut ? { leftOut: String(finding.leftOut) } : {}) });
  }

  private static severityOf(raw: unknown): ValidatorSeverity {
    return String(raw ?? '').trim().toLowerCase() === 'error' ? 'error' : 'warning';
  }
}
