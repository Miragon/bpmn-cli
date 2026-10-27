import type { Command as CommandType } from 'commander';
import { LayoutAnalysis } from '../../../domain/diagram/di/LayoutAnalysis.js';
import { metricsJson } from '../report/utils/metrics-json.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { MetricsText } from '../report/MetricsText.js';

/**
 * Prints the layout quality of the drawing: score, counts and every problem
 * (`bpmn metrics`).
 */
export class LayoutMetricsCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(this.define(program, 'metrics')).action(async (file: string, options: RawOpts) => {
      const doc = await this.cli.readDocArg(file);
      const metrics = LayoutAnalysis.of(doc.definitions);
      if (options['json']) this.cli.printJson({ file, ...metricsJson(metrics) }, !!options['pretty']);
      else this.cli.print(new MetricsText(metrics).text());
    });
  }
}
