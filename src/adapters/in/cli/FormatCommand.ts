import type { Command as CommandType } from 'commander';
import type { EditCommand, PlaceShapes } from '../../../domain/commands/types.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import { groupViolation } from '../../../domain/commands/utils/op-rules.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { assertPathFlags } from './utils/flags.js';
import { flag } from '../report/utils/option-flags.js';

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
  protected selectorsOf(ids: string[], options: RawOpts, need: boolean): Pick<PlaceShapes, 'ids' | 'path' | 'via' | 'kind' | 'branch'> {
    const path = options['path'] as string[] | undefined;
    assertPathFlags(path, options['via'], { path: 'Put the other ids before --path, or end the list with --: `bpmn color f.bpmn --path Event_Start Event_Done --color green`.' });
    const out = { ...(ids.length ? { ids } : {}), ...(path ? { path } : {}), ...(options['via'] ? { via: options['via'] as string[] } : {}), ...this.pick(options, ['kind', 'branch'] as const) };
    if (need && !ids.length && !path && !out.kind && !out.branch) throw usageError('name the elements: ids and / or --path <fromId> <toId>, --kind <kind>, --branch <flowId>');
    return out;
  }

  /** At most one flag per group, and (with `need`) at least one of all. */
  protected checkFlagGroups(options: RawOpts, groups: string[][], need?: string): void {
    const violation = groupViolation(Object.keys(options).filter((key) => options[key] !== undefined), groups, flag);
    if (violation) throw usageError(violation.message, { hint: violation.hint });
    if (need && !groups.flat().some((key) => options[key] !== undefined)) throw usageError(need);
  }

  protected pick<TKey extends string>(options: RawOpts, keys: readonly TKey[]): Partial<Record<TKey, string>> {
    const out: Partial<Record<TKey, string>> = {};
    for (const key of keys) if (options[key] !== undefined) out[key] = String(options[key]);
    return out;
  }

  protected async runFormat(file: string, op: EditCommand, options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    await this.cli.guarded(async () => {
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
