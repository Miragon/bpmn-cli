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
        .option('--platform <platform>', 'engine profile: auto (default: detected from modeler:executionPlatform / the vendor namespace), c7, c8 or none', (v: string) => {
          if (!(PLATFORM_CHOICES as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${PLATFORM_CHOICES.join(', ')}`);
          return v;
        }),
    ).action((file: string, o: RawOpts) =>
      this.cli.guarded(async () => {
        const checkOpts = { platform: (o['platform'] as PlatformChoice | undefined) ?? 'auto', ...this.lintOptions(o) };
        const report = new ValidationReportBuilder(file === '-' ? await new DocFile(await this.cli.readDocArg(file)).check(checkOpts) : await new ModelFile(file).check(checkOpts)).report();
        if (o['json']) {
          const { ok, ...rest } = report;
          this.cli.printJson({ ok, file, ...rest }, !!o['pretty']);
        } else {
          this.cli.print(new ValidationText(report).text());
        }
        if (report.errors.length) this.cli.exitCode = 2;
        // content the reader could not keep (duplicates, unknown elements) fails --strict too
        else if (o['strict'] && (report.warnings.length || report.importWarnings.length)) this.cli.exitCode = 5;
      }, !!o['json']),
    );
  }
}
