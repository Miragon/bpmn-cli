import type { Command } from 'commander';
import type { CliShell } from '../CliShell.js';
import { HelpTopics } from '../help/HelpTopics.js';

export class GuideCommand {
  constructor(private readonly shell: CliShell) {}

  register(program: Command): void {
    program
      .command('guide [topics...]')
      .description('the help: the core, or the named topics')
      .action((topics: string[]) => {
        this.shell.print(HelpTopics.text(topics));
      });
  }
}
