import type { Doc } from '../document/Doc.js';
import type { ProfileFinding, Severity } from '../document/Finding.js';
import { SEVERITIES } from '../document/utils/finding.js';
import { PlatformDetection, type PlatformChoice, type PlatformInfo } from '../document/vendor/PlatformDetection.js';
import type { EngineLint } from './EngineLint.js';

export interface ProfileReport extends PlatformInfo {
  findings: ProfileFinding[];
}

export interface PlatformSummary extends PlatformInfo {
  /** all findings, also the ones a mutation did not introduce */
  counts: Record<Severity, number>;
  added?: ProfileFinding[];
  resolved?: ProfileFinding[];
}

/** The engine-specific findings on top of the structural validation, from the injected engine lint. */
export class PlatformCheck {
  constructor(private readonly engine: EngineLint | undefined) {}

  /** No engine lint, or a document for no engine: the platform with no finding. */
  async run(doc: Doc, choice: PlatformChoice = 'auto'): Promise<ProfileReport> {
    const info = PlatformDetection.of(doc).resolve(choice);
    if (info.platform === 'none' || !this.engine) return { ...info, findings: [] };
    return { ...info, findings: await this.engine.findings(doc, { ...info, platform: info.platform }) };
  }

  static summarize(report: ProfileReport): PlatformSummary {
    const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
    for (const finding of report.findings) counts[finding.severity]++;
    return { platform: report.platform, source: report.source, detail: report.detail, ...(report.operaton ? { operaton: true } : {}), ...(report.version ? { version: report.version } : {}), counts };
  }
}
