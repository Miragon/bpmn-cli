import { Option, type Command as CommandType } from 'commander';
import { LABEL_SIDE_VALUES } from '../../../domain/commands/utils/op-fields.js';
import type { PlaceLabel } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: puts the external label of an element on one side (`bpmn label`).
 */
export class LabelSideCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'label').addOption(new Option('--side <side>', LABEL_SIDE_VALUES.join(' | ')).choices([...LABEL_SIDE_VALUES]).makeOptionMandatory())).action(
      (file: string, id: string, options: RawOpts) => {
        const op: PlaceLabel = { op: 'label', id, side: options['side'] as PlaceLabel['side'] };
        return this.runFormat(file, op, options);
      },
    );
  }
}
