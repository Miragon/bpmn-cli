import type { Command as CommandType } from 'commander';
import { KINDS_SECTION_NAMES, KindsReference } from '../report/KindsReference.js';
import { CliCommand, type RawOpts } from './CliCommand.js';

export class KindsCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(this.define(program, 'kinds').option('--section <names>', `only these parts (comma-separated): ${KINDS_SECTION_NAMES}`)).action((o: RawOpts) =>
      this.cli.guarded(async () => {
        const kinds = new KindsReference();
        const sections = o['section'] !== undefined ? kinds.sections(String(o['section'])) : undefined;
        if (o['json']) this.cli.printJson(sections ? kinds.sectionJson(sections) : kinds.json(), !!o['pretty']);
        else this.cli.print(sections ? kinds.sectionText(sections) : kinds.text());
      }, !!o['json']),
    );
  }
}
