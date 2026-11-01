import { LintConfig } from './LintConfig.js';
import { type LintFinding, LintFindings, type LintPlatform, type LintUnavailable, type ReportedImportWarning } from './LintFindings.js';
import { LintPlugins } from './LintPlugins.js';
import { type EnabledRules, LintRules } from './LintRules.js';
import { RuleGuard } from './RuleGuard.js';

export interface LintInput {
  xml: string;
  platform: LintPlatform;
  importWarnings: readonly ReportedImportWarning[];
}

export class ProjectLint {
  private loading: ReturnType<ProjectLint['load']> | undefined;

  private constructor(
    private readonly config: LintConfig,
    private readonly plugins: LintPlugins,
  ) {}

  static at(configPath: string): ProjectLint {
    const config = new LintConfig(configPath);
    return new ProjectLint(config, new LintPlugins(config));
  }

  async run({ xml, platform, importWarnings }: LintInput): Promise<LintFinding[]> {
    this.loading ??= this.load();
    const { rules, unavailable } = await this.loading;
    const notes = LintFindings.ofUnavailable(unavailable);
    if (!Object.keys(rules).length) {
      return notes;
    }
    const findings = new LintFindings(platform, importWarnings);
    try {
      const { rootElement, warnings = [] } = await this.plugins.moddle().fromXML(xml);
      const guard = new RuleGuard(this.plugins);
      const linter = this.plugins.linter({ config: { rules }, resolver: guard.resolver(), transformRule: (rule, info) => guard.guarded(rule, info) });
      const reports = await linter.lint(rootElement);
      await guard.settled();
      return [...notes, ...findings.ofReports(reports, rootElement, guard.failures), ...findings.ofImportWarnings(warnings)];
    } catch (error) {
      return [...notes, findings.ofFailure(error)];
    }
  }

  private async load(): Promise<{ rules: EnabledRules; unavailable: LintUnavailable[] }> {
    const lintRules = new LintRules(this.plugins, this.config.content);
    const rules = await lintRules.enabled();
    return { rules, unavailable: [...this.config.unavailable, ...lintRules.unavailable, ...this.plugins.unavailable] };
  }
}
