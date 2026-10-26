import type { Command as CommandType } from 'commander';
import type { AddElement } from '../../../domain/commands/types.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { parseKeyValues, splitList } from './utils/flags.js';

/**
 * Creates an element and wires it into the process (`bpmn add`).
 */
export class AddElementCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withTriggerOptions(
      this.withMutationOptions(
        this.define(program, 'add')
          .option('--id <id>', "explicit id (default: in the file's id style, else <Prefix>_<NameSlug>)")
          .option('--after <id>', 'append after a gateway / unconnected node, or insert into the node\'s single outgoing flow')
          .option('--before <id>', 'prepend before a join / unconnected node, or insert into the node\'s single incoming flow')
          .option('--flow <flowId>', 'insert into this sequence flow')
          .option('--in <scopeId>', 'create unconnected in this process / sub-process / participant')
          .option('--on <activityId>', 'boundary events: attach to this activity')
          .option('--to <id>', 'also connect the new node to this target')
          .option('--lane <laneId>', 'lane membership (default: inherited from the anchor)')
          .option('--flow-name <text>', 'name of the flow into the new node')
          .option('--flow-id <id>', 'id of the flow into the new node')
          .option('--condition <expr>', 'condition of the flow into the new node')
          .option('--language <lang>', 'expression language of the condition')
          .option('--default', 'the flow into the new node is the gateway\'s default flow')
          .option('--collapsed', 'sub-processes: draw collapsed')
          .option('--if-absent', 'with --id: succeed silently when the element exists')
          .option('--doc <text>', 'documentation')
          .option('--text <text>', 'text annotations: the text')
          .option('--process <id>', 'participants: bind this existing process')
          .option('--black-box', 'participants: no process')
          .option('--members <ids>', 'lanes / groups: comma-separated member ids (a group is drawn around them)'),
      ),
    ).action((file: string, kind: string, name: string | undefined, keyValues: string[], options: RawOpts) => this.run(file, kind, name, keyValues, options));
  }

  private async run(file: string, kind: string, name: string | undefined, keyValues: string[], options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    await this.cli.guarded(async () => {
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
        ...(options['id'] ? { id: String(options['id']) } : {}),
        ...(options['after'] ? { after: String(options['after']) } : {}),
        ...(options['before'] ? { before: String(options['before']) } : {}),
        ...(options['flow'] ? { flow: String(options['flow']) } : {}),
        ...(options['in'] ? { in: String(options['in']) } : {}),
        ...(options['on'] ? { on: String(options['on']) } : {}),
        ...(options['to'] ? { to: String(options['to']) } : {}),
        ...(options['lane'] ? { lane: String(options['lane']) } : {}),
        ...(options['flowName'] ? { flowName: String(options['flowName']) } : {}),
        ...(options['flowId'] ? { flowId: String(options['flowId']) } : {}),
        ...(options['condition'] !== undefined ? { condition: String(options['condition']) } : {}),
        ...(options['language'] ? { language: String(options['language']) } : {}),
        ...(options['default'] ? { default: true } : {}),
        ...(options['collapsed'] ? { collapsed: true } : {}),
        ...(options['ifAbsent'] ? { ifAbsent: true } : {}),
        ...(options['doc'] ? { doc: String(options['doc']) } : {}),
        ...(options['text'] ? { text: String(options['text']) } : {}),
        ...(options['process'] ? { process: String(options['process']) } : {}),
        ...(options['blackBox'] ? { blackBox: true } : {}),
        ...(options['members'] ? { members: splitList(String(options['members'])) } : {}),
        ...(kv.length ? { set: parseKeyValues(kv) } : {}),
        ...this.triggerOptions(options),
      };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
