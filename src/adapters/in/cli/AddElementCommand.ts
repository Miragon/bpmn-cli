import type { Command as CommandType } from 'commander';
import type { AddElement } from '../../../domain/commands/types.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { givenFlags, givenStrings, parseKeyValues, splitList } from './utils/flags.js';

/**
 * Creates an element and wires it into the process (`bpmn add`).
 */
export class AddElementCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withTriggerOptions(
      this.withMutationOptions(
        this.define(program, 'add')
          .option('--id <id>')
          .option('--after <id>')
          .option('--before <id>')
          .option('--flow <flowId>')
          .option('--in <scopeId>')
          .option('--on <activityId>')
          .option('--to <id>')
          .option('--lane <laneId>')
          .option('--flow-name <text>')
          .option('--flow-id <id>')
          .option('--condition <expr>')
          .option('--language <lang>')
          .option('--default')
          .option('--collapsed')
          .option('--if-absent')
          .option('--doc <text>')
          .option('--text <text>')
          .option('--process <id>')
          .option('--black-box')
          .option('--members <ids>'),
      ),
    ).action((file: string, kind: string, name: string | undefined, keyValues: string[], options: RawOpts) => this.run(file, kind, name, keyValues, options));
  }

  private async run(file: string, kind: string, name: string | undefined, keyValues: string[], options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    const kv = [...keyValues];
    if (name && /^[A-Za-z_][\w:.-]*=/.test(name)) {
      kv.unshift(name);
      name = undefined;
    }
    this.checkPlacementFlags(options);
    this.checkFlowFlags(options, true);
    if (options['ifAbsent'] && !options['id']) {
      throw usageError('--if-absent needs an explicit --id to check for', { hint: 'Pass --id <Prefix>_<Name> (the id add would generate), or drop --if-absent.' });
    }
    const op: AddElement = {
      op: 'add',
      kind,
      ...(name !== undefined ? { name } : {}),
      ...givenStrings(options, ['id', 'after', 'before', 'flow', 'in', 'on', 'to', 'lane', 'flowName', 'flowId', 'language', 'doc', 'text', 'process']),
      ...givenFlags(options, ['default', 'collapsed', 'ifAbsent', 'blackBox']),
      ...(options['condition'] !== undefined ? { condition: String(options['condition']) } : {}),
      ...(options['members'] ? { members: splitList(String(options['members'])) } : {}),
      ...(kv.length ? { set: parseKeyValues(kv) } : {}),
      ...this.triggerOptions(options),
    };
    await this.mutate(file, [op], opts);
  }
}
