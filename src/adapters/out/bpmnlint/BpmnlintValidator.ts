import { BpmnModdle, type ImportWarning } from 'bpmn-moddle';
import { isDecisionLinkWarning, reportedImportWarnings } from '../../../domain/editing/utils/decision-link-warnings.js';
import type { BpmnlintEngine, BpmnlintUnavailable, ResolvedBpmnlintConfig } from './bpmnlint-contract.js';
import { bpmnlintUnavailableFindings } from './utils/bpmnlint.js';
import { LintRun } from './LintRun.js';
import type { NamedValidator, ValidatorContext, ValidatorFinding } from '../../../domain/validation/validators.js';
import { firstLine } from '../../../domain/document/utils/text.js';

export const BPMNLINT_VALIDATOR = 'bpmnlint';

/** bpmn-cli's lint warnings a bpmnlint rule says again about the same element. */
export const BPMNLINT_COVERS: Record<string, string> = {
  'start-event-required': 'W_NO_START',
  'end-event-required': 'W_NO_END',
  'no-implicit-end': 'W_DEAD_END',
};

const NOT_LINTED = 'W_LINT_FAILED, no rule ran';

const IMPORT_HINT =
  "bpmnlint parses the file with the .bpmnlintrc's moddle extensions only and reports this as an error; bpmnlint in CI fails on it too. Fix the XML the message names: an unknown attribute needs a moddle extension that declares it (a JSON descriptor in moddleExtensions) or goes (`bpmn set <file> <id> <attr>=`), a reference needs the element it names; bpmn-cli's own finding about the same content has its command. --no-lint-config skips bpmnlint.";

const DECISION_LINK_HINT =
  "bpmn-cli's decision link in a model without an engine (an unprefixed calledDecision on a business rule task; bpmn-cli's reader keeps it): keep it. bpmnlint does not know the attribute and fails on it in CI too; a JSON descriptor in the .bpmnlintrc's moddleExtensions that adds calledDecision (isAttr) to bpmn:BusinessRuleTask declares it.";

export interface BpmnlintValidatorOptions {
  /** why it runs, e.g. `.bpmnlintrc in models` */
  detail?: string;
  /** default false: introduced errors are reported among the warnings */
  blocks?: boolean;
  /** what the host left out besides the configuration's own */
  unavailable?: BpmnlintUnavailable[];
  /** findings about the configuration itself, reported in every run */
  notes?: ValidatorFinding[];
}

/**
 * A resolved bpmnlint configuration as a validator. It lints the XML parsed again with the
 * configuration's moddle extensions only, as CI sees it, and never throws: what goes wrong
 * is W_LINT_FAILED.
 */
export class BpmnlintValidator {
  /** resolved once: no extends to walk and no unresolvable name per run */
  private readonly rules: Record<string, unknown> = {};
  private readonly notes: ValidatorFinding[];
  private moddle: BpmnModdle | undefined;

  constructor(
    private readonly engine: BpmnlintEngine,
    private readonly resolved: ResolvedBpmnlintConfig,
    private readonly opts: BpmnlintValidatorOptions = {},
  ) {
    for (const [name, setting] of Object.entries(resolved.rules)) {
      if (setting.severity !== 'off') {
        this.rules[name] = [setting.severity, setting.config];
      }
    }
    this.notes = [...bpmnlintUnavailableFindings([...resolved.unavailable, ...(opts.unavailable ?? [])]), ...(opts.notes ?? [])];
  }

  named(): NamedValidator {
    return {
      name: BPMNLINT_VALIDATOR,
      ...(this.opts.detail ? { detail: this.opts.detail } : {}),
      blocks: this.opts.blocks ?? false,
      covers: BPMNLINT_COVERS,
      validate: (xml: string, ctx: ValidatorContext) => this.validate(xml, ctx),
    };
  }

  /** Runs bpmnlint; when it fails, a W_LINT_FAILED warning says no rule ran, which a write counts as left out. */
  async validate(xml: string, ctx: ValidatorContext): Promise<ValidatorFinding[]> {
    const out: ValidatorFinding[] = [...this.notes];
    if (!Object.keys(this.rules).length) return out;
    const run = new LintRun(this.engine, ctx, out);
    try {
      this.moddle ??= new BpmnModdle(this.resolved.moddleExtensions);
      const { rootElement, warnings } = await this.moddle.fromXML(xml);
      await run.lint(this.rules, rootElement);
      if (warnings?.length) await this.importWarnings(warnings, ctx, out);
    } catch (err) {
      out.push({ severity: 'warning', code: 'W_LINT_FAILED', message: `bpmnlint could not lint the model: ${firstLine(err)}`, key: 'failed|', hint: "No rule ran. Check the .bpmnlintrc's moddleExtensions (a descriptor bpmnlint cannot load fails in CI too); else report the file and the .bpmnlintrc. --no-lint-config skips bpmnlint.", ...(ctx.phase === 'check' ? {} : { leftOut: NOT_LINTED }) });
    }
    return out;
  }

  /** bpmnlint's CLI reports the lint parse's import warnings as errors. */
  private async importWarnings(warnings: ImportWarning[], ctx: ValidatorContext, out: ValidatorFinding[]): Promise<void> {
    const doc = await ctx.doc();
    const own = new Set(reportedImportWarnings(doc).map((warning) => warning.message.split('\n')[0]));
    for (const warning of warnings) {
      const msg = warning.message.split('\n')[0]!;
      if (own.has(msg)) continue;
      const id = (warning.element as { id?: string } | undefined)?.id;
      const hint = isDecisionLinkWarning(warning) && doc.platform() === 'none' ? DECISION_LINK_HINT : IMPORT_HINT;
      out.push({ severity: 'error', code: 'import-warning', message: `Import warning: ${msg}`, ...(id ? { element: id } : {}), key: `import|${id ?? ''}|${msg}`, hint });
    }
  }
}
