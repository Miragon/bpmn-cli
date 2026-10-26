import type { Command as CommandType } from 'commander';
import { AgentGuide } from '../report/AgentGuide.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import { CliCommand, type RawOpts } from './CliCommand.js';

/**
 * Prints the cheat sheet for AI agents (`bpmn guide`).
 */
export class GuideCommand extends CliCommand {
  register(program: CommandType): void {
    this.define(program, 'guide')
      .option('--short', 'the core: contract, reading, ops keys, placement, top errors (at most 5 KB)')
      .action((topic: string | undefined, options: RawOpts) =>
        this.cli.guarded(async () => {
          if (topic !== undefined && options['short']) throw usageError('--short and a topic cannot be combined', { hint: 'Use `bpmn guide --short` or `bpmn guide <topic>`.' });
          const guide = new AgentGuide();
          this.cli.print(options['short'] ? guide.short() : topic !== undefined ? guide.topic(topic) : guide.text());
        }),
      );
  }
}
