import type { Command as CommandType } from 'commander';
import { KINDS_SECTION_NAMES, KindsReference } from '../report/KindsReference.js';
import { CliCommand, type RawOpts } from './CliCommand.js';

/**
 * Prints the element kinds, triggers, settable keys, ops schema and error codes
 * (`bpmn kinds`).
 */
export class KindsReferenceCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(this.define(program, 'kinds').option('--section <names>', `only these parts (comma-separated): ${KINDS_SECTION_NAMES}`)).action(async (options: RawOpts) => {
      const kinds = new KindsReference();
      const sections = options['section'] !== undefined ? kinds.sections(String(options['section'])) : undefined;
      if (options['json']) {
        this.cli.printJson(sections ? kinds.sectionJson(sections) : kinds.json(), !!options['pretty']);
      } else {
        this.cli.print(sections ? kinds.sectionText(sections) : kinds.text());
      }
    });
  }
}
