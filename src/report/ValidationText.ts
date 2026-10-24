import type { ValidationReport } from './command-report.js';
import { WarningLines } from './WarningLines.js';
import { advisoryOf } from './utils/findings.js';
import { validatorLines } from './utils/mutation-lines.js';

/** The text `bpmn validate` prints. */
export class ValidationText {
  constructor(private readonly report: ValidationReport) {}

  text(): string {
    const report = this.report;
    const { errors, warnings, platform } = report;
    const lines: string[] = [];
    if (report.importWarnings.length) lines.push(...report.importWarnings.map((w) => `import: ${w}`));
    const findings = new WarningLines(advisoryOf(report.validators));
    if (errors.length) lines.push(findings.problems(errors).trimEnd());
    if (warnings.length) lines.push(findings.problems(warnings).trimEnd());
    if (platform) {
      // plain BPMN has no engine rules: a count of 0 would read as "checked and fine"
      const counts = platform.platform === 'c7' || platform.platform === 'c8' ? ` - ${platform.counts.deploy} refused at deploy, ${platform.counts.runtime} runtime, ${platform.counts.practice} practice finding(s)` : '';
      lines.push(`platform: ${platform.platform} (${platform.detail})${counts}`);
    }
    lines.push(...validatorLines(report.validators, 'file'));
    lines.push(report.layout.status === 'ok' ? 'layout: ok' : report.layout.status === 'failed' ? `layout: failed (${report.layout.error.code})` : 'layout: skipped');
    const imported = report.importWarnings.length ? `, ${report.importWarnings.length} import warning(s)` : '';
    lines.push(errors.length ? `${errors.length} error(s), ${warnings.length} warning(s)${imported}` : `valid, ${warnings.length} warning(s)${imported}`);
    return lines.join('\n');
  }
}
