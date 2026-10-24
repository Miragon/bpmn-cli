import type { Command as CommandType } from 'commander';
import { KINDS_SECTION_NAMES, kindsJson, kindsSectionJson, kindsSectionText, kindsSections, kindsText } from '../report/guide.js';
import { CliCommand, type RawOpts } from './CliCommand.js';

export class KindsCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(this.define(program, 'kinds').option('--section <names>', `only these parts (comma-separated): ${KINDS_SECTION_NAMES}`)).action((o: RawOpts) =>
      this.cli.guarded(async () => {
        const sections = o['section'] !== undefined ? kindsSections(String(o['section'])) : undefined;
        if (o['json']) this.cli.printJson(sections ? kindsSectionJson(sections) : kindsJson(), !!o['pretty']);
        else this.cli.print(sections ? kindsSectionText(sections) : kindsText());
      }, !!o['json']),
    );
  }
}
