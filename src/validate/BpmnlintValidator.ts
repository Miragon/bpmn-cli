import { BpmnModdle, type ImportWarning } from 'bpmn-moddle';
import { isDecisionLinkWarning, reportedImportWarnings } from '../ops/utils/decision-link-warnings.js';
import type { BpmnlintEngine, BpmnlintUnavailable, ResolvedBpmnlintConfig } from './bpmnlint-validator.js';
import { bpmnlintUnavailableFindings } from './utils/bpmnlint.js';
import { LintRun } from './LintRun.js';
import type { NamedValidator, ValidatorContext, ValidatorFinding } from './validators.js';
import { firstLine } from '../shared/utils/text.js';

export const BPMNLINT_VALIDATOR = 'bpmnlint';

/**
 * bpmn-cli's lint warnings a bpmnlint rule says again about the same element
 * (NamedValidator.covers): where the rule reports, the warning is dropped and
 * the finding takes its hint. A rule that is off reports nothing and covers nothing.
 */
export const BPMNLINT_COVERS: Record<string, string> = {
  'start-event-required': 'W_NO_START',
  'end-event-required': 'W_NO_END',
  'no-implicit-end': 'W_DEAD_END',
};

/** Why a write leaves the W_LINT_FAILED of a model bpmnlint could not lint out of its comparison: its validator line says that no rule ran. */
const NOT_LINTED = 'W_LINT_FAILED, no rule ran';

/** The hint of an import warning of the lint parse. */
const IMPORT_HINT =
  "bpmnlint parses the file with the .bpmnlintrc's moddle extensions only and reports this as an error; bpmnlint in CI fails on it too. Fix the XML the message names: an unknown attribute needs a moddle extension that declares it (a JSON descriptor in moddleExtensions) or goes (`bpmn set <file> <id> <attr>=`), a reference needs the element it names; bpmn-cli's own finding about the same content has its command. --no-lint-config skips bpmnlint.";

/** The hint of bpmn-cli's decision link in a model without an engine, which the lint parse does not know. */
const DECISION_LINK_HINT =
  "bpmn-cli's decision link in a model without an engine (an unprefixed calledDecision on a business rule task; bpmn-cli's reader keeps it): keep it. bpmnlint does not know the attribute and fails on it in CI too; a JSON descriptor in the .bpmnlintrc's moddleExtensions that adds calledDecision (isAttr) to bpmn:BusinessRuleTask declares it.";

export interface BpmnlintValidatorOptions {
  /** why it runs, e.g. `.bpmnlintrc in models` (the validator line of results) */
  detail?: string;
  /** introduced bpmnlint errors block the write like other validator errors (default false: reported among the warnings) */
  blocks?: boolean;
  /** what the host left out besides the configuration's own (moddle extensions) */
  unavailable?: BpmnlintUnavailable[];
  /** findings about the configuration itself, reported in every run like W_LINT_UNAVAILABLE (W_CONFIG_IGNORED: values of element-id-naming new ids do not follow, src/ids/IdConventionsReader.ts) */
  notes?: ValidatorFinding[];
}

/**
 * A resolved configuration as a validator (src/validate/validators.ts). Each
 * document is linted by a LintRun on the XML parsed again with the
 * configuration's moddle extensions only: what is written, incoming /
 * outgoing lists as the file keeps them, as CI sees it.
 *
 * Findings: code = the rule's normalised name, element = the report's id,
 * severity error for category error (warn and info: warning), key = id +
 * the report's path without array indices + message (compareRuns renames the
 * ids in it; an earlier sibling removed does not change it). Besides:
 *  - `notes`: the host's findings about the configuration (W_CONFIG_IGNORED),
 *    in every run, so a write only counts them;
 *  - a rule left out of a run (LintRun): W_LINT_FAILED; a model it cannot lint
 *    at all (a descriptor BpmnModdle accepts but cannot parse with): one
 *    W_LINT_FAILED, which a write leaves out (ValidatorFinding.leftOut: its
 *    validator line says that no rule ran);
 *  - what could not be resolved: W_LINT_UNAVAILABLE, one per package and reason;
 *  - the import warnings of the lint parse bpmn-cli's reader does not report
 *    itself: `import-warning` errors, as bpmnlint's CLI reports them, with a
 *    hint (bpmn-cli's decision link in a model without an engine: its own);
 *  - no-implicit-end, no-implicit-start, no-disconnected and
 *    event-based-gateway (which counts the outgoing list) read the incoming /
 *    outgoing lists, which bpmn-cli writes only where a file keeps them: a
 *    finding the element's sequence flows contradict is left out of a
 *    write's comparison (before / after: ValidatorFinding.leftOut, counted)
 *    and carries a hint in `bpmn validate` (check);
 *  - BPMNLINT_COVERS: bpmn-cli's lint warning about the same element is
 *    dropped where a covering rule reports, and the finding takes its hint.
 * The validator never throws: what goes wrong is W_LINT_FAILED.
 */
export class BpmnlintValidator {
  /** the effective, resolvable, enabled rules: no extends to walk and no unresolvable name per run */
  private readonly rules: Record<string, unknown> = {};
  private readonly notes: ValidatorFinding[];
  private moddle: BpmnModdle | undefined;

  constructor(
    private readonly engine: BpmnlintEngine,
    private readonly resolved: ResolvedBpmnlintConfig,
    private readonly opts: BpmnlintValidatorOptions = {},
  ) {
    for (const [name, s] of Object.entries(resolved.rules)) if (s.severity !== 'off') this.rules[name] = [s.severity, s.config];
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
      // a write counts it as left out: its validator line says that no rule ran
      out.push({ severity: 'warning', code: 'W_LINT_FAILED', message: `bpmnlint could not lint the model: ${firstLine(err)}`, key: 'failed|', hint: "No rule ran. Check the .bpmnlintrc's moddleExtensions (a descriptor bpmnlint cannot load fails in CI too); else report the file and the .bpmnlintrc. --no-lint-config skips bpmnlint.", ...(ctx.phase === 'check' ? {} : { leftOut: NOT_LINTED }) });
    }
    return out;
  }

  /** The lint parse's import warnings (bpmnlint's CLI reports them as errors) that bpmn-cli's reader does not report itself. */
  private async importWarnings(warnings: ImportWarning[], ctx: ValidatorContext, out: ValidatorFinding[]): Promise<void> {
    const doc = await ctx.doc();
    const own = new Set(reportedImportWarnings(doc).map((w) => w.message.split('\n')[0]));
    for (const w of warnings) {
      const msg = w.message.split('\n')[0]!;
      if (own.has(msg)) continue;
      const id = (w.element as { id?: string } | undefined)?.id;
      const hint = isDecisionLinkWarning(w) && doc.platform() === undefined ? DECISION_LINK_HINT : IMPORT_HINT;
      out.push({ severity: 'error', code: 'import-warning', message: `Import warning: ${msg}`, ...(id ? { element: id } : {}), key: `import|${id ?? ''}|${msg}`, hint });
    }
  }
}
