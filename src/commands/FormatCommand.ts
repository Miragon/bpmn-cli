import type { Command as CommandType } from 'commander';
import type { Op, PlaceOp } from '../ops/types.js';
import { usageError } from '../shared/utils/errors.js';
import { groupViolation } from '../ops/parsing/utils/op-rules.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { assertPathFlags, flag } from './utils/flags.js';

/**
 * Base of the diagram-only commands (place, align, color, label, route, space, tidy,
 * compact): element selectors and flag groups.
 */
export abstract class FormatCommand extends MutationCommand {
  protected withSelectors(cmd: CommandType, what: string): CommandType {
    return cmd
      .option('--path <ids...>', `${what} every node${what === 'colour' ? ' and flow' : ''} on the shortest sequence-flow path <fromId> <toId>`)
      .option('--via <flowIds...>', 'with --path: flows the path must pass, in order')
      .option('--kind <kind>', `${what} every element of this kind (find --kind grammar: endEvent, userTask, ...)`)
      .option('--branch <flowId>', `${what} the branch this sequence flow starts, up to the join`);
  }

  /** The ids and selectors of a format command; `need`: ids or a selector are required. */
  protected selectorsOf(ids: string[], o: RawOpts, need: boolean): Pick<PlaceOp, 'ids' | 'path' | 'via' | 'kind' | 'branch'> {
    const path = o['path'] as string[] | undefined;
    assertPathFlags(path, o['via'], { path: 'Put the other ids before --path, or end the list with --: `bpmn color f.bpmn --path Event_Start Event_Done --color green`.' });
    const out = { ...(ids.length ? { ids } : {}), ...(path ? { path } : {}), ...(o['via'] ? { via: o['via'] as string[] } : {}), ...this.pick(o, ['kind', 'branch'] as const) };
    if (need && !ids.length && !path && !out.kind && !out.branch) throw usageError('name the elements: ids and / or --path <fromId> <toId>, --kind <kind>, --branch <flowId>');
    return out;
  }

  /** At most one flag per group, and (with `need`) at least one of all. */
  protected checkFlagGroups(o: RawOpts, groups: string[][], need?: string): void {
    const violation = groupViolation(Object.keys(o).filter((k) => o[k] !== undefined), groups, flag);
    if (violation) throw usageError(violation.message, { hint: violation.hint });
    if (need && !groups.flat().some((k) => o[k] !== undefined)) throw usageError(need);
  }

  protected pick<K extends string>(o: RawOpts, keys: readonly K[]): Partial<Record<K, string>> {
    const out: Partial<Record<K, string>> = {};
    for (const k of keys) if (o[k] !== undefined) out[k] = String(o[k]);
    return out;
  }

  protected async runFormat(file: string, op: Op, o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
