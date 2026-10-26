import type { Command as CommandType } from 'commander';
import { assertKindToken } from '../model/utils/kinds.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { ElementFinder } from '../query/ElementFinder.js';
import { renderFind } from '../report/utils/view-lines.js';

/**
 * Finds elements by id, name or vendor attribute value (`bpmn find`).
 */
export class FindCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(this.define(program, 'find').option('--kind <kind>', 'restrict to a kind', (raw: string) => this.kindArg(raw))).action((file: string, text: string, options: RawOpts) =>
      this.cli.guarded(async () => {
        const doc = await this.cli.readDocArg(file);
        const hits = new ElementFinder(doc).find(text, options['kind'] as string | undefined);
        if (options['json']) this.cli.printJson(hits, !!options['pretty']);
        else this.cli.print(renderFind(hits));
      }, !!options['json']),
    );
  }

  /** Kind tokens fail with the documented kind codes (like `add`), not commander's text. */
  private kindArg(value: string): string {
    assertKindToken(value);
    return value;
  }
}
