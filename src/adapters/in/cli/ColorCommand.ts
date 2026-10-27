import { Option, type Command as CommandType } from 'commander';
import type { ColorElements } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: colours shapes and connections (`bpmn color`).
 */
export class ColorCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.withSelectors(this.define(program, 'color').addOption(new Option('--color <color>').makeOptionMandatory())),
    ).action((file: string, ids: string[], options: RawOpts) =>
      this.cli.guarded(async () => {
        const op: ColorElements = { op: 'color', ...this.selectorsOf(ids, options, true), color: options['color'] as ColorElements['color'] };
        await this.runFormat(file, op, options);
      }, !!options['json']),
    );
  }
}
