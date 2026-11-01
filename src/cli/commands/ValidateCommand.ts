import { resolve } from 'node:path';
import type { Command } from 'commander';
import { validateXml, type Validator } from '../../api/index.js';
import type { CliShell } from '../CliShell.js';
import { LintConfigLookup } from '../files/LintConfigLookup.js';
import { ProjectLintValidator } from '../files/ProjectLintValidator.js';
import { ExitCode } from '../output/ExitCode.js';
import { ValidationText } from '../output/ValidationText.js';

interface ValidateFlags {
  strict?: boolean;
  lintConfig?: string | false;
  json?: boolean;
}

export class ValidateCommand {
  constructor(private readonly shell: CliShell) {}

  register(program: Command): void {
    program
      .command('validate <file>')
      .description("structure checks, Camunda checks, the project's .bpmnlintrc and a layout dry run; writes nothing (file - = stdin)")
      .option('--strict', 'exit 5 on warnings')
      .option('--lint-config <path>', "the project's bpmnlint configuration (default: the nearest .bpmnlintrc above the file, up to the repository root; outside one only in the file's directory; stdin: from the working directory)")
      .option('--no-lint-config', "do not read the project's bpmnlint configuration")
      .option('--json', 'print the report as JSON')
      .action((path: string, flags: ValidateFlags) => this.run(path, flags));
  }

  private async run(path: string, { strict, lintConfig, json }: ValidateFlags): Promise<void> {
    const { shell } = this;
    const validators = await this.validators(path, lintConfig);
    const report = await validateXml(await shell.file.read(path), { validators });
    if (json) {
      const { ok, ...rest } = report;
      shell.printJson({ ok, file: path, ...rest });
    } else {
      shell.print(new ValidationText(report, path).text());
    }
    if (report.state.errors) {
      shell.exit.set(ExitCode.MODEL);
    } else if (strict && (report.state.warnings || report.importWarnings.length)) {
      shell.exit.set(ExitCode.STRICT_WARNINGS);
    }
  }

  private async validators(path: string, lintConfig: string | false | undefined): Promise<Validator[]> {
    if (lintConfig === false) {
      return [];
    }
    if (typeof lintConfig === 'string') {
      return [await this.named(lintConfig)];
    }
    const declared = await this.shell.conventions.near(path);
    const found = new LintConfigLookup(path === '-' ? process.cwd() : resolve(path, '..')).nearest();
    return found === undefined ? [] : [new ProjectLintValidator(found, declared.where ?? found, declared.notes)];
  }

  private async named(lintConfig: string): Promise<Validator> {
    const where = `--lint-config ${lintConfig}`;
    ProjectLintValidator.assertReadable(lintConfig);
    const { notes } = await this.shell.conventions.of(lintConfig, where);
    return new ProjectLintValidator(lintConfig, where, notes);
  }
}
