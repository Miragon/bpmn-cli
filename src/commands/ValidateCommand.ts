import { InvalidArgumentError, type Command as CommandType } from 'commander';
import { checkFile, checkLoadedDoc } from '../node/files.js';
import { PLATFORM_CHOICES, type PlatformChoice } from '../platform/profiles/profile.js';
import { renderValidation, validationReport } from '../report/command-report.js';
import { CliCommand, type RawOpts } from './CliCommand.js';

export class ValidateCommand extends CliCommand {
  register(program: CommandType): void {
    this.withLintOptions(
      this.withJsonOptions(this.define(program, 'validate'))
        .option(...CliCommand.catalogue.commonOption('--strict'))
        .option('--platform <platform>', 'engine profile: auto (default: detected from modeler:executionPlatform / the vendor namespace), c7, c8 or none', (v: string) => {
          if (!(PLATFORM_CHOICES as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${PLATFORM_CHOICES.join(', ')}`);
          return v;
        }),
    ).action((file: string, o: RawOpts) =>
      this.cli.guarded(async () => {
        const checkOpts = { platform: (o['platform'] as PlatformChoice | undefined) ?? 'auto', ...this.lintOptions(o) };
        const report = validationReport(file === '-' ? await checkLoadedDoc(await this.cli.readDocArg(file), checkOpts) : await checkFile(file, checkOpts));
        if (o['json']) {
          const { ok, ...rest } = report;
          this.cli.printJson({ ok, file, ...rest }, !!o['pretty']);
        } else {
          this.cli.print(renderValidation(report));
        }
        if (report.errors.length) this.cli.exitCode = 2;
        // content the reader could not keep (duplicate elements, unknown elements, ...) fails --strict like a warning
        else if (o['strict'] && (report.warnings.length || report.importWarnings.length)) this.cli.exitCode = 5;
      }, !!o['json']),
    );
  }
}
