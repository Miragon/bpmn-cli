import type { Doc } from '../model/Doc.js';
import type { CliError } from '../shared/CliError.js';
import { LayoutDebug } from '../layout/LayoutDebug.js';
import { FullLayout } from '../layout/FullLayout.js';
import { reportedImportWarnings } from '../ops/utils/decision-link-warnings.js';
import { PlatformDetection } from '../platform/PlatformDetection.js';
import { PLATFORM_PROFILES } from '../platform/profiles/PlatformProfiles.js';
import { StructuralValidator } from '../validate/StructuralValidator.js';
import { ValidatorSet } from '../validate/ValidatorSet.js';
import { counts, withValidatorReports } from '../validate/utils/validator-issues.js';
import { once } from '../validate/utils/once.js';
import type { ValidatorReport, ValidatorRun } from '../validate/validators.js';
import { toCliError } from './utils/cli-error.js';
import type { CheckOptions, CheckResult } from './index.js';

/**
 * `bpmn validate` on a document: validation, the validators and a layout dry run.
 * The dry run redraws the in-memory document: pass a document of its own.
 */
export class DocCheck {
  constructor(private readonly opts: CheckOptions = {}) {}

  async run(doc: Doc): Promise<CheckResult> {
    const opts = this.opts;
    return LayoutDebug.during(opts.debug, async () => {
      await PLATFORM_PROFILES.ensure(doc, opts.platform ?? 'auto');
      let validation = new StructuralValidator(doc).validate({ platform: opts.platform ?? 'auto' });
      const structuralErrors = validation.errors.length;
      const importWarnings = reportedImportWarnings(doc).map((w) => w.message.split('\n')[0]!);
      const file = opts.file ?? doc.file;
      const validators = new ValidatorSet(opts.validators);
      if (validators.size) {
        // before the layout dry run redraws the model: validators see the document's diagram
        const runs = await validators.run({ xml: once(async () => doc.source?.text ?? (await doc.toXml())), doc: async () => doc }, { ...(file ? { file } : {}), phase: 'check', platform: PlatformDetection.of(doc).resolve(opts.platform ?? 'auto').platform, ops: [] });
        validation = withValidatorReports(validation, DocCheck.reports(runs), runs);
      }
      let layout: CheckResult['layout'];
      if (structuralErrors) {
        layout = { status: 'skipped', warnings: [], expanded: [] };
      } else {
        try {
          const r = await new FullLayout(doc.model, {}).run();
          layout = { status: 'ok', warnings: r.warnings, expanded: r.expanded };
        } catch (err) {
          const e = toCliError(err) as CliError;
          layout = { status: 'failed', error: { code: e.code, message: e.message, element: e.details?.element as string | undefined } };
        }
      }
      return { validation, layout, importWarnings };
    });
  }

  private static reports(runs: ValidatorRun[]): ValidatorReport[] {
    return runs.map((run) => ({
      name: run.name,
      ...(run.detail ? { detail: run.detail } : {}),
      ...(run.blocks === false ? { blocks: false as const } : {}),
      errors: run.issues.filter((i) => i.severity === 'error'),
      warnings: run.issues.filter((i) => i.severity === 'warning'),
      preexisting: [],
      resolved: [],
      counts: counts(run.issues),
    }));
  }
}
