import { Option, type Command as CommandType } from 'commander';
import { COLOR_VALUES } from '../ops/utils/op-fields.js';
import type { ColorOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

export class ColorCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.withSelectors(this.define(program, 'color').addOption(new Option('--color <color>', COLOR_VALUES.join(' | ')).choices([...COLOR_VALUES]).makeOptionMandatory()), 'colour'),
    ).action((file: string, ids: string[], o: RawOpts) =>
      this.cli.guarded(async () => {
        const op: ColorOp = { op: 'color', ...this.selectorsOf(ids, o, true), color: o['color'] as ColorOp['color'] };
        await this.runFormat(file, op, o);
      }, !!o['json']),
    );
  }
}
