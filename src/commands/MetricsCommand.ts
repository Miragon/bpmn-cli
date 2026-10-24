import type { Command as CommandType } from 'commander';
import { layoutProblems } from '../diagram/metrics.js';
import { metricsJson } from '../report/utils/metrics-json.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { MetricsText } from '../report/MetricsText.js';

export class MetricsCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(this.define(program, 'metrics')).action((file: string, o: RawOpts) =>
      this.cli.guarded(async () => {
        const doc = await this.cli.readDocArg(file);
        const m = layoutProblems(doc.definitions);
        if (o['json']) this.cli.printJson({ file, ...metricsJson(m) }, !!o['pretty']);
        else this.cli.print(new MetricsText(m).text());
      }, !!o['json']),
    );
  }
}
