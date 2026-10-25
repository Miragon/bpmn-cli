import { Option, type Command as CommandType } from 'commander';
import { LABEL_SIDE_VALUES } from '../ops/utils/op-fields.js';
import type { LabelOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: puts the external label of an element on one side (`bpmn label`).
 */
export class LabelSideCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'label').addOption(new Option('--side <side>', LABEL_SIDE_VALUES.join(' | ')).choices([...LABEL_SIDE_VALUES]).makeOptionMandatory())).action(
      (file: string, id: string, o: RawOpts) => {
        const op: LabelOp = { op: 'label', id, side: o['side'] as LabelOp['side'] };
        return this.runFormat(file, op, o);
      },
    );
  }
}
