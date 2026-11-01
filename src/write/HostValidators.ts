import { BpmnError, Findings, type Platform, type ValidatorFinding, type ValidatorIssue, type ValidatorSeverity } from '../model/index.js';
import type { OperationInput } from '../operations/index.js';

export type ValidatorPhase = 'before' | 'after' | 'check';

export interface ValidatorContext {
  phase: ValidatorPhase;
  platform: Platform;
  file?: string | undefined;
  operations: readonly OperationInput[];
  importWarnings: ReadonlyArray<{ message: string }>;
}

export type HostContext = Omit<ValidatorContext, 'phase'>;

export interface Validator {
  name: string;
  detail?: string | undefined;
  blocks?: boolean | undefined;
  validate(xml: string, context: ValidatorContext): ValidatorFinding[] | Promise<ValidatorFinding[]>;
}

export interface ValidatorRun {
  name: string;
  detail?: string;
  blocks?: false;
  issues: ValidatorIssue[];
}

export class HostValidators {
  private static readonly TEXT_OF_PHASE: Readonly<Record<ValidatorPhase, string>> = { before: 'document before the change', after: 'changed document', check: 'file' };

  private readonly validators: readonly Validator[];

  constructor(
    validators: readonly Validator[] | undefined,
    private readonly context: HostContext,
  ) {
    this.validators = validators ?? [];
    this.validators.forEach(HostValidators.assertRunnable);
  }

  private static assertRunnable(validator: Validator, index: number): void {
    if (typeof validator?.validate !== 'function') {
      throw BpmnError.model('E_VALIDATOR_FAILED', `Validator ${index + 1} is no object with a validate function`, { hint: 'Pass `validators: [{ name, validate: (xml, context) => findings }]`.' });
    }
  }

  private static issueOf(name: string, finding: ValidatorFinding): ValidatorIssue {
    const { code, ruleId, message, element, related, hint, key, severity } = finding;
    const issue: ValidatorIssue = { code: String(code ?? ruleId ?? 'FINDING'), message: String(message ?? ''), validator: name, severity: HostValidators.severityOf(severity) };
    if (element) {
      issue.element = String(element);
    }
    if (related?.length) {
      issue.related = related.map(String);
    }
    if (hint) {
      issue.hint = String(hint);
    }
    return Findings.withUnserialised(issue, key ? { key: String(key) } : {});
  }

  private static severityOf(severity: unknown): ValidatorSeverity {
    return String(severity ?? '').trim().toLowerCase() === 'error' ? 'error' : 'warning';
  }

  async run(xml: string, phase: ValidatorPhase): Promise<ValidatorRun[]> {
    const runs: ValidatorRun[] = [];
    for (const validator of this.validators) {
      runs.push(await this.runOne(validator, xml, phase));
    }
    return runs;
  }

  private async runOne(validator: Validator, xml: string, phase: ValidatorPhase): Promise<ValidatorRun> {
    const { name, detail, blocks } = validator;
    const found = await this.findingsOf(validator, xml, phase);
    if (!Array.isArray(found)) {
      throw BpmnError.model('E_VALIDATOR_FAILED', `Validator ${name} returned ${typeof found} instead of an array of findings; nothing was written`, { validator: name });
    }
    return { name, ...(detail ? { detail } : {}), ...(blocks === false ? { blocks } : {}), issues: found.map((finding) => HostValidators.issueOf(name, finding)) };
  }

  private async findingsOf(validator: Validator, xml: string, phase: ValidatorPhase): Promise<ValidatorFinding[]> {
    try {
      return await validator.validate(xml, { ...this.context, phase });
    } catch (error) {
      throw BpmnError.model('E_VALIDATOR_FAILED', `Validator ${validator.name} failed on the ${HostValidators.TEXT_OF_PHASE[phase]}: ${BpmnError.firstLine(error)}; nothing was written`, {
        validator: validator.name,
        hint: 'The validator threw instead of returning findings. Fix the validator (or the input it cannot read), or run without it.',
      });
    }
  }
}
