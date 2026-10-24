import { InvalidArgumentError, type Command as CommandType } from 'commander';
import type { Doc } from '../model/document.js';
import { ImageWriter, type Shot } from '../node/ImageWriter.js';
import { mutateDocToFile, mutateFile, type FileMutationOptions } from '../node/files.js';
import { defaultWithConditionViolation, placementViolation } from '../ops/rules.js';
import type { Op, TriggerOptions } from '../ops/types.js';
import { assertLossless, LAYOUT_MODES, type LayoutMode, type MutationResult } from '../pipeline/index.js';
import { changeHighlight, RENDER_MAX_SIZE, type RenderOptions } from '../render/index.js';
import { advisoryValidators, mutationReport, mutationSummary, mutationWarnings, renderMutation, renderSummary, type MutationReport, type MutationSummary } from '../report/command-report.js';
import { RenderReport } from '../report/RenderReport.js';
import { renderView } from '../report/view-text.js';
import { isCliError, usageError } from '../shared/utils/errors.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import type { CliStream } from './Cli.js';
import { flag, renderFormat, renderTarget } from './utils/flags.js';

export interface OutputOptions {
  json?: boolean;
  /** with json: indented */
  pretty?: boolean;
  strict?: boolean;
  /** the short result (mutationSummary) */
  summary?: boolean;
  /** --render <file>: draw the result to this image */
  render?: string;
  /** the value of BPMN_KEEP_FLOW_IDS when it, not a flag, kept the flow ids: the result says so (keptByEnvNote) */
  keepFlowIdsEnv?: string;
}

export type MutationFlags = FileMutationOptions & OutputOptions;

/* The rules `apply` enforces on ops JSON (ops/rules.ts), spelled with CLI flags. */

const FLOW_FLAGS: Record<string, string> = { flowName: '--flow-name', flowId: '--flow-id', condition: '--condition', language: '--language', default: '--default' };

export abstract class MutationCommand extends CliCommand {
  protected withMutationOptions(cmd: CommandType, { layoutToggle = true } = {}): CommandType {
    const option = (long: string) => CliCommand.catalogue.commonOption(long);
    this.withJsonOptions(cmd).option(...option('--summary')).option(...option('--out')).option(...option('--dry-run')).option(...option('--render'), renderTarget);
    if (layoutToggle) {
      cmd
        .option(...option('--layout'), (v: string) => {
          if (!(LAYOUT_MODES as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${LAYOUT_MODES.join(', ')}`);
          return v;
        })
        .option(...option('--relayout'))
        .option(...option('--no-layout'));
    }
    return this.withLintOptions(cmd)
      .option(...option('--force'))
      .option(...option('--backup'))
      .option(...option('--show'))
      .option(...option('--strict'))
      .option(...option('--keep-flow-ids'))
      .option(...option('--no-keep-flow-ids'))
      .option(...option('--engine'), (v: string) => {
        if (v !== 'clean' && v !== 'auto') throw new InvalidArgumentError('expected clean or auto');
        return v;
      });
  }

  protected withTriggerOptions(cmd: CommandType): CommandType {
    return cmd
      .option('--timer <iso>', 'timer: R/PT1H (cycle), PT5M (duration) or a date')
      .option('--timer-kind <kind>', 'cycle | duration | date (default: classified from the value)')
      .option('--message <name>', 'message name (bpmn:Message is created when missing)')
      .option('--error <name>', 'error name')
      .option('--error-code <code>', 'error code')
      .option('--signal <name>', 'signal name')
      .option('--escalation <name>', 'escalation name')
      .option('--escalation-code <code>', 'escalation code')
      .option('--when <expr>', 'condition of a conditional event')
      .option('--link <name>', 'link name')
      .option('--non-interrupting', 'non-interrupting boundary / start event');
  }

  protected triggerOptions(o: RawOpts): TriggerOptions {
    const t: TriggerOptions = {};
    if (o['timer']) t.timer = String(o['timer']);
    if (o['timerKind']) t.timerKind = String(o['timerKind']) as TriggerOptions['timerKind'];
    if (o['message']) t.message = String(o['message']);
    if (o['error']) t.error = String(o['error']);
    if (o['errorCode']) t.errorCode = String(o['errorCode']);
    if (o['signal']) t.signal = String(o['signal']);
    if (o['escalation']) t.escalation = String(o['escalation']);
    if (o['escalationCode']) t.escalationCode = String(o['escalationCode']);
    if (o['when']) t.when = String(o['when']);
    if (o['link']) t.link = String(o['link']);
    if (o['nonInterrupting']) t.nonInterrupting = true;
    return t;
  }

  protected mutationOptions(o: RawOpts): MutationFlags {
    const { keep: keepFlowIds, env: keepFlowIdsEnv } = this.keepFlowIdsOption(o);
    return {
      json: !!o['json'],
      pretty: !!o['pretty'],
      summary: !!o['summary'],
      out: o['out'] as string | undefined,
      dryRun: !!o['dryRun'],
      layout: this.layoutOption(o),
      force: !!o['force'],
      backup: !!o['backup'],
      show: !!o['show'],
      strict: !!o['strict'],
      ...(o['render'] !== undefined ? { render: String(o['render']) } : {}),
      ...(o['engine'] ? { engine: o['engine'] as 'clean' | 'auto' } : {}),
      ...(keepFlowIds !== undefined ? { keepFlowIds } : {}),
      ...(keepFlowIdsEnv !== undefined ? { keepFlowIdsEnv } : {}),
      ...this.lintOptions(o),
    };
  }

  /** Exactly one placement, or --after together with --before. */
  protected checkPlacementFlags(o: RawOpts): void {
    const violation = placementViolation(Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== ''), flag);
    if (violation) throw usageError(violation.message, { hint: violation.hint });
  }

  /** Flow options describe the flow INTO the node; they need a placement that creates one. */
  protected checkFlowFlags(o: RawOpts, needsPlacement: boolean): void {
    const conditionedDefault = defaultWithConditionViolation(!!o['default'], o['condition'] !== undefined, flag);
    if (conditionedDefault) throw usageError(conditionedDefault.message, { hint: conditionedDefault.hint });
    if (!needsPlacement) return;
    const used = Object.keys(FLOW_FLAGS).filter((k) => o[k] !== undefined && o[k] !== false);
    const createsFlow = !!o['after'] || !!o['before'] || !!o['flow'];
    if (used.length && !createsFlow) {
      throw usageError(`${used.map((k) => FLOW_FLAGS[k]).join(', ')} describe the flow into the node and need --after, --before or --flow`, {
        hint: 'With --in or --on no sequence flow is created; connect the node afterwards with `bpmn connect`.',
      });
    }
  }

  /** A mutation of ops on `file` (`-`: stdin), see runMutation. */
  protected async mutate(file: string, ops: Op[], opts: MutationFlags): Promise<void> {
    try {
      await this.runMutation(
        file,
        opts,
        (o) => mutateFile(file, ops, o),
        (doc, o) => {
          assertLossless(doc, o);
          return mutateDocToFile(doc, ops, o);
        },
      );
    } catch (err) {
      throw this.withFile(this.keptIdsHint(err, ops, opts.keepFlowIdsEnv), file);
    }
  }

  /**
   * Runs a mutating command. The model comes from `file` (`-`: stdin); the
   * result goes to the file, to `-o <file>`, or to stdout (`-o -`, or a model
   * from stdin without -o; then the report goes to stderr).
   */
  protected async runMutation(
    file: string,
    opts: MutationFlags,
    fromFile: (o: FileMutationOptions) => Promise<MutationResult>,
    fromDoc: (doc: Doc, o: FileMutationOptions) => Promise<MutationResult>,
  ): Promise<void> {
    const stdout = opts.out === '-' || (file === '-' && opts.out === undefined);
    const fileOpts: FileMutationOptions = stdout ? { ...opts, out: undefined, dryRun: true, backup: false } : opts;
    const result = file === '-' ? await fromDoc(await this.cli.readDocArg('-'), fileOpts) : await fromFile(fileOpts);
    await this.emit(result, opts, stdout);
  }

  protected async emit(result: MutationResult, opts: MutationFlags, stdout: boolean): Promise<void> {
    const xmlOut = stdout && !opts.dryRun;
    if (xmlOut) {
      this.cli.io.stdout.write(result.xml.endsWith('\n') ? result.xml : `${result.xml}\n`);
      result.written = true;
      result.file = '-';
    }
    await this.printMutation(result, opts, xmlOut ? this.cli.io.stderr : this.cli.io.stdout);
  }

  /**
   * The result of a mutation (src/report/command-report.ts: the same for the CLI and the
   * in-memory API); --render draws the result (its own block / `render` key);
   * --strict exits 5 on any warning (the exit code, like every exit code:
   * process.exit would cut off what a pipe has not taken yet, beyond 64 KB on macOS).
   * Flow ids BPMN_KEEP_FLOW_IDS kept add a note (keptByEnvNote), also to --summary.
   */
  private async printMutation(result: MutationResult, opts: OutputOptions & { show?: boolean; dryRun?: boolean }, out: CliStream): Promise<void> {
    const note = this.keptByEnvNote(result, opts.keepFlowIdsEnv);
    if (note) result.changes.note(note);
    const report = mutationReport(result);
    const shot = opts.render ? await this.renderResult(result.xml, report, opts.render) : undefined;
    const shotText = shot ? `\n${shot.lines.join('\n')}` : '';
    if (opts.summary) {
      const summary = mutationSummary(report);
      if (opts.json) this.cli.printJson({ ...summary, ...(note ? { notes: [note] } : {}), ...(report.view ? { view: report.view } : {}), ...(shot ? { render: shot.json } : {}) }, opts.pretty, out);
      else this.cli.print(this.summaryText(summary, { dryRun: opts.dryRun, advisory: advisoryValidators(report) }, note) + shotText + (report.view ? `\n\n${renderView(report.view)}` : ''), out);
    } else if (opts.json) this.cli.printJson(shot ? { ...report, render: shot.json } : report, opts.pretty, out);
    else this.cli.print(renderMutation(report, { dryRun: opts.dryRun }).replace(/\n$/, '') + shotText, out);
    if (opts.strict && mutationWarnings(result).length) this.cli.exitCode = 5;
  }

  /** `--render <file>` of a mutating command: the result drawn with what the change touched and the problems it added; a render failure is reported, the mutation stands. */
  private async renderResult(xml: string, report: MutationReport, target: string): Promise<{ shot?: Shot; lines: string[]; json: Record<string, unknown> }> {
    const highlight = changeHighlight(report);
    const touched = [...highlight.created, ...highlight.changed, ...highlight.moved];
    const opts: RenderOptions = { maxSize: RENDER_MAX_SIZE, highlight, problems: report.layout.metrics?.added ?? [], ...(touched.length ? { focus: touched } : {}) };
    try {
      const shot = await new ImageWriter(this.cli.io.stdout).write(xml, opts, renderFormat(undefined, target), target, 'result');
      return { shot, lines: new RenderReport(shot).resultLines(highlight), json: { ...shot } };
    } catch (err) {
      if (!isCliError(err)) throw err;
      return { lines: [RenderReport.failureLine(err)], json: { error: err.toJSON() } };
    }
  }

  /**
   * `flow ids kept: BPMN_KEEP_FLOW_IDS=1 (...)` when the variable (`value`), not
   * a flag, kept the flow ids where the default would have given another
   * result: the change named a flow whose kept id no longer names its ends
   * (W_FLOW_ID_STALE), or a move relocated a node (ChangeSet.relocated) and
   * the change lists a sequence flow it did not create as changed (with ids
   * kept a move puts the moved node's old out-flow back, where the default
   * removes it and creates a new one). A move in place relocates nothing: the
   * flow options it puts on the flow into its first node (a name, a
   * condition, a flowId) change that flow the same in both modes.
   * Nowhere else do kept ids change a result (an error they cause:
   * keptIdsHint): a flow whose id does not name its ends (Flow_10,
   * Flow_1q7m2zd) is renamed in neither mode, a flow the change created
   * follows its ends in both, a property change (`set <flow> name=`, `id=`)
   * is the same in both. A move that changed a flow without putting one back
   * gets the note too: the result does not tell the two apart. The variable
   * sits in a shell or an agent's settings, where the agent reading the
   * result does not see it.
   */
  private keptByEnvNote(result: MutationResult, value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const { created, changed, warnings, relocated } = result.changes;
    const putBack = relocated.length > 0 && changed.some((c) => c.kind === 'sequenceFlow' && !created.some((n) => n.id === c.id));
    if (!putBack && !warnings.some((w) => w.code === 'W_FLOW_ID_STALE')) return undefined;
    return `flow ids kept: BPMN_KEEP_FLOW_IDS=${value} (--no-keep-flow-ids renames flows after their new ends for one command)`;
  }

  /**
   * renderSummary, with `note` (keptByEnvNote; the summary prints no notes of
   * its own) after the change lines, where the full result has its notes: the
   * lines below them are what renderSummary prints for no changes, without
   * its `no changes` line.
   */
  private summaryText(summary: MutationSummary, opts: Parameters<typeof renderSummary>[1], note: string | undefined): string {
    const text = renderSummary(summary, opts);
    if (!note) return text;
    const { aliases: _aliases, renamed: _renamed, format: _format, ...rest } = summary;
    const below = renderSummary({ ...rest, created: {}, changed: [], removed: [] }, opts).split('\n').length - 1;
    const lines = text.split('\n');
    lines.splice(lines.length - below, 0, `note: ${note}`);
    return lines.join('\n');
  }

  /**
   * E_NOT_FOUND in a batch whose flow ids BPMN_KEEP_FLOW_IDS (`value`) kept:
   * the missing id may be the one the default gives a flow an earlier op gave
   * other ends, which kept its old id here. The hint says so, because whoever
   * reads the error may not see the variable (keptByEnvNote for a result).
   */
  private keptIdsHint(err: unknown, ops: readonly Op[], value: string | undefined): unknown {
    if (value === undefined || ops.length < 2 || !isCliError(err) || err.code !== 'E_NOT_FOUND') return err;
    const kept = `If it is the id a flow an earlier op gave other ends would be renamed to: flow ids are kept here (BPMN_KEEP_FLOW_IDS=${value}), so that flow kept its old id; use the old id, or --no-keep-flow-ids to rename it after its new ends.`;
    const hint = err.details.hint;
    err.details.hint = typeof hint === 'string' && hint ? `${hint} ${kept}` : kept;
    return err;
  }

  /** A refusal that carries a runnable command (E_NO_ROOM: details.command) names the file in it and in its hint. */
  private withFile(err: unknown, file: string): unknown {
    if (!isCliError(err) || typeof err.details['command'] !== 'string' || file === '-') return err;
    const quoted = /^[\w./@%+=:,-]+$/.test(file) ? file : `'${file.replace(/'/g, `'\\''`)}'`;
    err.details['command'] = String(err.details['command']).replaceAll('<file>', quoted);
    if (typeof err.details.hint === 'string') err.details.hint = err.details.hint.replaceAll('bpmn space <file>', `bpmn space ${quoted}`);
    return err;
  }

  /** --layout <mode> / --relayout / --no-layout -> FileMutationOptions.layout */
  private layoutOption(o: RawOpts): FileMutationOptions['layout'] {
    const layout = o['layout'] as string | false | undefined;
    if (o['relayout']) {
      if (layout === false || (layout !== undefined && layout !== 'full')) {
        throw usageError(`--relayout cannot be combined with ${layout === false ? '--no-layout' : `--layout ${layout}`}`, { hint: '--relayout is --layout full; pass only one of them.' });
      }
      return 'full';
    }
    if (layout === false) return false;
    return (layout as LayoutMode | undefined) ?? 'auto';
  }

  /**
   * --keep-flow-ids / --no-keep-flow-ids, else BPMN_KEEP_FLOW_IDS, else
   * undefined (flows follow their ends); `env`: the variable's value when it
   * kept them (the result says so: keptByEnvNote).
   */
  private keepFlowIdsOption(o: RawOpts): { keep?: boolean; env?: string } {
    const flag = o['keepFlowIds'] as boolean | undefined;
    if (flag !== undefined) return { keep: flag };
    const keep = this.envSwitch('BPMN_KEEP_FLOW_IDS', 'Set BPMN_KEEP_FLOW_IDS=1 (true, yes, on) to keep flow ids, BPMN_KEEP_FLOW_IDS=0 (false, no, off) or unset it to rename them after their new ends; --keep-flow-ids / --no-keep-flow-ids decide for one command.');
    if (keep === undefined) return {};
    return keep ? { keep, env: this.cli.io.env['BPMN_KEEP_FLOW_IDS']!.trim() } : { keep };
  }

  /**
   * A switch from the environment: unset or empty = undefined, 1 / true / yes / on = true, 0 / false / no / off = false
   * (any case). Anything else is E_USAGE: a typo must not silently mean on or off.
   */
  private envSwitch(name: string, hint: string): boolean | undefined {
    const value = this.cli.io.env[name]?.trim();
    if (!value) return undefined;
    if (/^(1|true|yes|on)$/i.test(value)) return true;
    if (/^(0|false|no|off)$/i.test(value)) return false;
    throw usageError(`${name}=${value} is not a switch value`, { hint });
  }
}
