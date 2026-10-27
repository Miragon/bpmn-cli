import type { Command as CommandType } from 'commander';
import { assertKindToken } from '../../../domain/document/utils/kinds.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { renderFind } from '../report/utils/view-lines.js';

/**
 * Finds elements by id, name or vendor attribute value (`bpmn find`).
 */
export class FindCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(this.define(program, 'find').option('--kind <kind>', 'restrict to a kind', (raw: string) => this.kindArg(raw))).action(async (file: string, text: string, options: RawOpts) => {
      const doc = await this.cli.readDocArg(file);
      const hits = this.cli.useCases.findElements.find({ doc, text, ...(options['kind'] !== undefined ? { kind: options['kind'] as string } : {}) });
      if (options['json']) this.cli.printJson(hits, !!options['pretty']);
      else this.cli.print(renderFind(hits));
    });
  }

  /** Kind tokens fail with the documented kind codes (like `add`), not commander's text. */
  private kindArg(value: string): string {
    assertKindToken(value);
    return value;
  }
}
