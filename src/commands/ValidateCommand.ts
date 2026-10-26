import { InvalidArgumentError, type Command as CommandType } from 'commander';
import { DocFile } from '../node/DocFile.js';
import { ModelFile } from '../node/ModelFile.js';
import { PLATFORM_CHOICES, type PlatformChoice } from '../platform/PlatformDetection.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { ValidationReportBuilder } from '../report/ValidationReportBuilder.js';
import { ValidationText } from '../report/ValidationText.js';

/**
 * Checks a model: structure, lint, engine profile and a layout dry run;
 * writes nothing (`bpmn validate`).
 */
export class ValidateCommand extends CliCommand {
  register(program: CommandType): void {
    this.withLintOptions(
      this.withJsonOptions(this.define(program, 'validate'))
        .option(...CliCommand.catalogue.commonOption('--strict'))
        .option('--platform <platform>', 'engine profile: auto (default: detected from modeler:executionPlatform / the vendor namespace), c7, c8 or none', (raw: string) => {
          if (!(PLATFORM_CHOICES as readonly string[]).includes(raw)) throw new InvalidArgumentError(`expected ${PLATFORM_CHOICES.join(', ')}`);
          return raw;
        }),
    ).action((file: string, options: RawOpts) =>
      this.cli.guarded(async () => {
        const checkOpts = { platform: (options['platform'] as PlatformChoice | undefined) ?? 'auto', ...this.lintOptions(options) };
        const report = new ValidationReportBuilder(file === '-' ? await new DocFile(await this.cli.readDocArg(file)).check(checkOpts) : await new ModelFile(file).check(checkOpts)).report();
        if (options['json']) {
          const { ok, ...rest } = report;
          this.cli.printJson({ ok, file, ...rest }, !!options['pretty']);
        } else {
          this.cli.print(new ValidationText(report).text());
        }
        if (report.errors.length) this.cli.exitCode = 2;
        // content the reader could not keep (duplicates, unknown elements) fails --strict too
        else if (options['strict'] && (report.warnings.length || report.importWarnings.length)) this.cli.exitCode = 5;
      }, !!options['json']),
    );
  }
}
