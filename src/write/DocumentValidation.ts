import { ModelChecks } from '../checks/index.js';
import { DiagramDrawing, DrawingSnapshot } from '../drawing/index.js';
import { type BpmnDocument, BpmnError, ChangeSet, DocumentReader, type Finding, type FindingCounts, Findings, PlatformDetection, type PlatformInfo, type Severity } from '../model/index.js';
import { HostValidators, type Validator, type ValidatorRun } from './HostValidators.js';

export interface ValidateOptions {
  validators?: readonly Validator[] | undefined;
}

export interface PlatformSummary extends PlatformInfo {
  counts: Record<Severity, number>;
}

export interface ValidatorSummary extends FindingCounts {
  name: string;
  detail?: string;
  blocks?: false;
}

export type LayoutCheck = { status: 'ok' | 'skipped' } | { status: 'failed'; error: Finding };

export interface ValidationReport {
  ok: boolean;
  findings: Finding[];
  state: FindingCounts;
  platform: PlatformSummary;
  validators: ValidatorSummary[];
  layout: LayoutCheck;
  importWarnings: string[];
}

export class DocumentValidation {
  constructor(private readonly options: ValidateOptions = {}) {}

  private static failureOf(error: unknown): Finding {
    const failure = BpmnError.from(error);
    const known = failure instanceof BpmnError;
    const element = known ? failure.details.element : undefined;
    return { code: known ? failure.code : 'E_INTERNAL', message: BpmnError.firstLine(failure), severity: 'error', ...(element ? { element } : {}) };
  }

  private static countsPerSeverity(findings: readonly Finding[]): Record<Severity, number> {
    const counts = Object.fromEntries(Findings.SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
    for (const { severity } of findings) {
      if (severity !== undefined && severity in counts) {
        counts[severity as Severity]++;
      }
    }
    return counts;
  }

  private static summaryOf({ issues, ...run }: ValidatorRun): ValidatorSummary {
    return { ...run, ...Findings.countOf(issues) };
  }

  async report(xml: string): Promise<ValidationReport> {
    const document = await new DocumentReader().read(xml);
    const { reportedImportWarnings: importWarnings, file } = document;
    const platform = new PlatformDetection(document.tree.definitions).info();
    const checks = new ModelChecks(document).all();
    const hosts = new HostValidators(this.options.validators, { platform: platform.platform, file, operations: [], importWarnings });
    const runs = await hosts.run(xml, 'check');
    const { layout, warnings } = checks.some(({ severity }) => severity === 'error') ? { layout: { status: 'skipped' } as const, warnings: [] } : await this.layoutDryRun(document);
    const findings = [...checks, ...runs.flatMap(({ issues }) => issues), ...(layout.status === 'failed' ? [layout.error] : []), ...warnings];
    const state = Findings.countOf(findings);
    return {
      ok: state.errors === 0,
      findings: findings.sort((first, second) => Number(second.severity === 'error') - Number(first.severity === 'error')),
      state,
      platform: { ...platform, counts: DocumentValidation.countsPerSeverity(checks) },
      validators: runs.map(DocumentValidation.summaryOf),
      layout,
      importWarnings: importWarnings.map(({ message }) => message.split('\n')[0]!),
    };
  }

  private async layoutDryRun(ownCopy: BpmnDocument): Promise<{ layout: LayoutCheck; warnings: Finding[] }> {
    try {
      const { warnings } = await new DiagramDrawing(ownCopy).update(DrawingSnapshot.of(ownCopy), new ChangeSet(), [{ op: 'layout' }]);
      return { layout: { status: 'ok' }, warnings: warnings.map(Findings.ofLayout) };
    } catch (error) {
      return { layout: { status: 'failed', error: DocumentValidation.failureOf(error) }, warnings: [] };
    }
  }
}
