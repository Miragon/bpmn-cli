import type { Command as CommandType } from 'commander';
import { LayoutAnalysis } from '../drawing/LayoutAnalysis.js';
import { metricsJson } from '../report/utils/metrics-json.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { MetricsText } from '../report/MetricsText.js';

/**
 * Prints the layout quality of the drawing: score, counts and every problem
 * (`bpmn metrics`).
 */
export class LayoutMetricsCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(this.define(program, 'metrics')).action((file: string, options: RawOpts) =>
      this.cli.guarded(async () => {
        const doc = await this.cli.readDocArg(file);
        const metrics = LayoutAnalysis.of(doc.definitions);
        if (options['json']) this.cli.printJson({ file, ...metricsJson(metrics) }, !!options['pretty']);
        else this.cli.print(new MetricsText(metrics).text());
      }, !!options['json']),
    );
  }
}
