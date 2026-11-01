import type { Finding, ValidationReport, ValidatorSummary } from '../../api/index.js';
import { FindingLines } from './FindingLines.js';

export class ValidationText {
  private static readonly ENGINE_PLATFORMS = ['c7', 'c8'];

  constructor(
    private readonly report: ValidationReport,
    private readonly path: string,
  ) {}

  private static validatorLine({ name, detail, errors, warnings }: ValidatorSummary): string {
    return `validator ${name}${detail ? ` (${detail})` : ''}: ${errors} error(s), ${warnings} warning(s) in the file`;
  }

  text(): string {
    const { findings, importWarnings, validators } = this.report;
    const isError = ({ severity }: Finding): boolean => severity === 'error';
    const lines = new FindingLines(this.path, new Set(validators.filter(({ blocks }) => blocks === false).map(({ name }) => name)));
    return [
      ...importWarnings.map((warning) => `import: ${warning}`),
      ...lines.problems(findings.filter(isError)),
      ...lines.problems(findings.filter((finding) => !isError(finding))),
      this.platformLine(),
      ...validators.map(ValidationText.validatorLine),
      this.layoutLine(),
      this.verdictLine(),
    ].join('\n');
  }

  private platformLine(): string {
    const { platform, detail, counts } = this.report.platform;
    const found = ValidationText.ENGINE_PLATFORMS.includes(platform) ? ` - ${counts.deploy} refused at deploy, ${counts.runtime} runtime, ${counts.practice} practice finding(s)` : '';
    return `platform: ${platform} (${detail})${found}`;
  }

  private layoutLine(): string {
    const { layout } = this.report;
    return layout.status === 'failed' ? `layout: failed (${layout.error.code})` : `layout: ${layout.status}`;
  }

  private verdictLine(): string {
    const { state: { errors, warnings }, importWarnings } = this.report;
    const imported = importWarnings.length ? `, ${importWarnings.length} import warning(s)` : '';
    return `${errors ? `${errors} error(s)` : 'valid'}, ${warnings} warning(s)${imported}`;
  }
}
