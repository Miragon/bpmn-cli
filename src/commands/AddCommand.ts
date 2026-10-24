import type { Command as CommandType } from 'commander';
import type { AddOp } from '../ops/types.js';
import { usageError } from '../shared/utils/errors.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { parseKeyValues, splitList } from './utils/flags.js';

export class AddCommand extends MutationCommand {
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
    ).action((file: string, kind: string, name: string | undefined, keyValues: string[], o: RawOpts) => this.run(file, kind, name, keyValues, o));
  }

  private async run(file: string, kind: string, name: string | undefined, keyValues: string[], o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      const kv = [...keyValues];
      if (name && /^[A-Za-z_][\w:.-]*=/.test(name)) {
        kv.unshift(name);
        name = undefined;
      }
      this.checkPlacementFlags(o);
      this.checkFlowFlags(o, true);
      if (o['ifAbsent'] && !o['id']) {
        throw usageError('--if-absent needs an explicit --id to check for', { hint: 'Pass --id <Prefix>_<Name> (the id add would generate), or drop --if-absent.' });
      }
      const op: AddOp = {
        op: 'add',
        kind,
        ...(name !== undefined ? { name } : {}),
        ...(o['id'] ? { id: String(o['id']) } : {}),
        ...(o['after'] ? { after: String(o['after']) } : {}),
        ...(o['before'] ? { before: String(o['before']) } : {}),
        ...(o['flow'] ? { flow: String(o['flow']) } : {}),
        ...(o['in'] ? { in: String(o['in']) } : {}),
        ...(o['on'] ? { on: String(o['on']) } : {}),
        ...(o['to'] ? { to: String(o['to']) } : {}),
        ...(o['lane'] ? { lane: String(o['lane']) } : {}),
        ...(o['flowName'] ? { flowName: String(o['flowName']) } : {}),
        ...(o['flowId'] ? { flowId: String(o['flowId']) } : {}),
        ...(o['condition'] !== undefined ? { condition: String(o['condition']) } : {}),
        ...(o['language'] ? { language: String(o['language']) } : {}),
        ...(o['default'] ? { default: true } : {}),
        ...(o['collapsed'] ? { collapsed: true } : {}),
        ...(o['ifAbsent'] ? { ifAbsent: true } : {}),
        ...(o['doc'] ? { doc: String(o['doc']) } : {}),
        ...(o['text'] ? { text: String(o['text']) } : {}),
        ...(o['process'] ? { process: String(o['process']) } : {}),
        ...(o['blackBox'] ? { blackBox: true } : {}),
        ...(o['members'] ? { members: splitList(String(o['members'])) } : {}),
        ...(kv.length ? { set: parseKeyValues(kv) } : {}),
        ...this.triggerOptions(o),
      };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
