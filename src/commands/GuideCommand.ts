import type { Command as CommandType } from 'commander';
import { guideShort, guideText, guideTopic } from '../report/guide.js';
import { usageError } from '../shared/utils/errors.js';
import { CliCommand, type RawOpts } from './CliCommand.js';

export class GuideCommand extends CliCommand {
  register(program: CommandType): void {
    this.define(program, 'guide')
      .option('--short', 'the core: contract, reading, ops keys, placement, top errors (at most 5 KB)')
      .action((topic: string | undefined, o: RawOpts) =>
        this.cli.guarded(async () => {
          if (topic !== undefined && o['short']) throw usageError('--short and a topic cannot be combined', { hint: 'Use `bpmn guide --short` or `bpmn guide <topic>`.' });
          this.cli.print(o['short'] ? guideShort() : topic !== undefined ? guideTopic(topic) : guideText());
        }),
      );
  }
}
