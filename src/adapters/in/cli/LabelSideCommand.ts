import { Option, type Command as CommandType } from 'commander';
import type { PlaceLabel } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: puts the external label of an element on one side (`bpmn label`).
 */
export class LabelSideCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'label').addOption(new Option('--side <side>').makeOptionMandatory())).action(
      (file: string, id: string, options: RawOpts) => {
        const command: PlaceLabel = { op: 'label', id, side: options['side'] as PlaceLabel['side'] };
        return this.runFormat(file, command, options);
      },
    );
  }
}
