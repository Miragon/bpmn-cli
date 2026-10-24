import type { Command as CommandType } from 'commander';
import { assertKindToken } from '../model/kinds.js';
import { findElements } from '../query/model-view.js';
import { renderFind } from '../report/view-text.js';
import { CliCommand, type RawOpts } from './CliCommand.js';

export class FindCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(this.define(program, 'find').option('--kind <kind>', 'restrict to a kind', (v: string) => this.kindArg(v))).action((file: string, text: string, o: RawOpts) =>
      this.cli.guarded(async () => {
        const doc = await this.cli.readDocArg(file);
        const hits = findElements(doc, text, o['kind'] as string | undefined);
        if (o['json']) this.cli.printJson(hits, !!o['pretty']);
        else this.cli.print(renderFind(hits));
      }, !!o['json']),
    );
  }

  /** Option parser for kind tokens: the documented kind codes (usage errors, like `add`) instead of commander's generic text. */
  private kindArg(value: string): string {
    assertKindToken(value);
    return value;
  }
}
