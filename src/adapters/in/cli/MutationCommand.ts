import { InvalidArgumentError, type Command as CommandType } from 'commander';
import type { Doc } from '../../../domain/document/Doc.js';
import type { Shot } from '../../../application/port/out/WriteImagePort.js';
import type { FileMutationOptions } from '../../../application/port/in/EditDocumentUseCase.js';
import { defaultWithConditionViolation, placementViolation } from '../../../domain/commands/utils/op-rules.js';
import type { EditCommand, TriggerOptions } from '../../../domain/commands/types.js';
import { TRIGGER_FIELDS, TRIGGER_KEYS } from '../../../domain/commands/utils/op-fields.js';
import type { MutationResult } from '../../../domain/batch/types.js';
import { LAYOUT_MODES, type LayoutMode } from '../../../domain/diagram/types.js';
import { RENDER_MAX_SIZE, type RenderOptions } from '../../../domain/views/render/types.js';
import { changeHighlight } from '../report/utils/highlight.js';
import { type MutationReport, type MutationSummary } from '../report/command-report.js';
import { RenderReport } from './RenderReport.js';
import { isBpmnError, usageError } from '../../../domain/document/utils/errors.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import type { CliStream } from './Cli.js';
import { renderFormat, renderTarget } from './utils/flags.js';
import { flag, triggerFlag } from '../report/utils/option-flags.js';
import { commonOption } from '../report/CommandCatalogue.js';
import { ModelViewText } from '../report/ModelViewText.js';
import { MutationReportBuilder } from '../report/MutationReportBuilder.js';
import { MutationSummaryBuilder } from '../report/MutationSummaryBuilder.js';
import { MutationText } from '../report/MutationText.js';
import { SummaryText } from '../report/SummaryText.js';
import { advisoryOf } from '../report/utils/findings.js';

export interface OutputOptions {
  json?: boolean;
  /** with json: indented */
  pretty?: boolean;
  strict?: boolean;
  /** the short result */
  summary?: boolean;
  /** --render <file>: draw the result to this image */
  render?: string;
  /** BPMN_KEEP_FLOW_IDS when it, not a flag, kept the flow ids (the result then says so) */
  keepFlowIdsEnv?: string;
}

export type MutationFlags = FileMutationOptions & OutputOptions;

const FLOW_FLAGS: Record<string, string> = { flowName: '--flow-name', flowId: '--flow-id', condition: '--condition', language: '--language', default: '--default' };

/**
 * Base of every command that changes a model: the shared mutation flags,
 * then load, mutate and write the model and print the result.
 */
export abstract class MutationCommand extends CliCommand {
  protected withMutationOptions(cmd: CommandType, { layoutToggle = true } = {}): CommandType {
    this.withJsonOptions(cmd).option(...commonOption('--summary')).option(...commonOption('--out')).option(...commonOption('--dry-run')).option(...commonOption('--render'), renderTarget);
    if (layoutToggle) {
      cmd
        .option(...commonOption('--layout'), (raw: string) => {
          if (!(LAYOUT_MODES as readonly string[]).includes(raw)) throw new InvalidArgumentError(`expected ${LAYOUT_MODES.join(', ')}`);
          return raw;
        })
        .option(...commonOption('--relayout'))
        .option(...commonOption('--no-layout'));
    }
    return this.withLintOptions(cmd)
      .option(...commonOption('--force'))
      .option(...commonOption('--backup'))
      .option(...commonOption('--show'))
      .option(...commonOption('--strict'))
      .option(...commonOption('--keep-flow-ids'))
      .option(...commonOption('--no-keep-flow-ids'));
  }

  protected withTriggerOptions(cmd: CommandType): CommandType {
    for (const key of TRIGGER_KEYS) cmd.option(...triggerFlag(key));
    return cmd;
  }

  protected triggerOptions(options: RawOpts): TriggerOptions {
    const trigger: Record<string, string | boolean> = {};
    for (const key of TRIGGER_KEYS) {
      if (options[key]) trigger[key] = TRIGGER_FIELDS[key].type === 'boolean' ? true : String(options[key]);
    }
    return trigger as TriggerOptions;
  }

  protected mutationOptions(options: RawOpts): MutationFlags {
    const { keep: keepFlowIds, env: keepFlowIdsEnv } = this.keepFlowIdsOption(options);
    return {
      json: !!options['json'],
      pretty: !!options['pretty'],
      summary: !!options['summary'],
      out: options['out'] as string | undefined,
      dryRun: !!options['dryRun'],
      layout: this.layoutOption(options),
      force: !!options['force'],
      backup: !!options['backup'],
      show: !!options['show'],
      strict: !!options['strict'],
      ...(options['render'] !== undefined ? { render: String(options['render']) } : {}),
      ...(keepFlowIds !== undefined ? { keepFlowIds } : {}),
      ...(keepFlowIdsEnv !== undefined ? { keepFlowIdsEnv } : {}),
      ...this.lintOptions(options),
    };
  }

  /** Exactly one placement, or --after together with --before. */
  protected checkPlacementFlags(options: RawOpts): void {
    const violation = placementViolation(Object.keys(options).filter((key) => options[key] !== undefined && options[key] !== ''), flag);
    if (violation) throw usageError(violation.message, { hint: violation.hint });
  }

  /** Flow options describe the flow INTO the node; they need a placement that creates one. */
  protected checkFlowFlags(options: RawOpts, needsPlacement: boolean): void {
    const conditionedDefault = defaultWithConditionViolation(!!options['default'], options['condition'] !== undefined, flag);
    if (conditionedDefault) throw usageError(conditionedDefault.message, { hint: conditionedDefault.hint });
    if (!needsPlacement) return;
    const used = Object.keys(FLOW_FLAGS).filter((key) => options[key] !== undefined && options[key] !== false);
    const createsFlow = !!options['after'] || !!options['before'] || !!options['flow'];
    if (used.length && !createsFlow) {
      throw usageError(`${used.map((key) => FLOW_FLAGS[key]).join(', ')} describe the flow into the node and need --after, --before or --flow`, {
        hint: 'With --in or --on no sequence flow is created; connect the node afterwards with `bpmn connect`.',
      });
    }
  }

  /** Applies `ops` to `file` (`-`: stdin). */
  protected async mutate(file: string, commands: EditCommand[], opts: MutationFlags): Promise<void> {
    try {
      await this.runMutation(
        file,
        opts,
        (fileOptions) => this.cli.useCases.editDocument.edit({ ...fileOptions, source: { file }, commands }),
        (doc, fileOptions) => {
          return this.cli.useCases.editDocument.edit({ ...fileOptions, source: { doc }, commands });
        },
      );
    } catch (err) {
      throw this.withFile(this.keptIdsHint(err, commands, opts.keepFlowIdsEnv), file);
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
    fromFile: (fileOptions: FileMutationOptions) => Promise<MutationResult>,
    fromDoc: (doc: Doc, fileOptions: FileMutationOptions) => Promise<MutationResult>,
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
   * --strict exits 5 on any warning; flow ids BPMN_KEEP_FLOW_IDS kept add a note,
   * also to --summary.
   */
  private async printMutation(result: MutationResult, opts: OutputOptions & { show?: boolean; dryRun?: boolean }, out: CliStream): Promise<void> {
    const note = this.keptByEnvNote(result, opts.keepFlowIdsEnv);
    if (note) result.changes.note(note);
    const report = new MutationReportBuilder(result).report();
    const shot = opts.render ? await this.renderResult(result.xml, report, opts.render) : undefined;
    const shotText = shot ? `\n${shot.lines.join('\n')}` : '';
    if (opts.summary) {
      const summary = new MutationSummaryBuilder(report).summary();
      if (opts.json) this.cli.printJson({ ...summary, ...(note ? { notes: [note] } : {}), ...(report.view ? { view: report.view } : {}), ...(shot ? { render: shot.json } : {}) }, opts.pretty, out);
      else this.cli.print(this.summaryText(summary, { dryRun: opts.dryRun, advisory: advisoryOf((report).validation.validators) }, note) + shotText + (report.view ? `\n\n${new ModelViewText(report.view).text()}` : ''), out);
    } else if (opts.json) this.cli.printJson(shot ? { ...report, render: shot.json } : report, opts.pretty, out);
    else this.cli.print(new MutationText(report, { dryRun: opts.dryRun }).text().replace(/\n$/, '') + shotText, out);
    if (opts.strict && new MutationReportBuilder(result).warnings().length) this.cli.exitCode = 5;
  }

  /**
   * --render: the result drawn with what the change touched and the problems it added;
   * a render failure is reported, the mutation stands.
   */
  private async renderResult(xml: string, report: MutationReport, target: string): Promise<{ shot?: Shot; lines: string[]; json: Record<string, unknown> }> {
    const highlight = changeHighlight(report);
    const touched = [...highlight.created, ...highlight.changed, ...highlight.moved];
    const opts: RenderOptions = { maxSize: RENDER_MAX_SIZE, highlight, problems: report.layout.metrics?.added ?? [], ...(touched.length ? { focus: touched } : {}) };
    try {
      const shot = await this.cli.useCases.renderDiagram.render({ source: { xml }, opts, format: renderFormat(undefined, target), out: target, stem: 'result', stdout: this.cli.io.stdout });
      return { shot, lines: new RenderReport(shot).resultLines(highlight), json: { ...shot } };
    } catch (err) {
      if (!isBpmnError(err)) throw err;
      return { lines: [RenderReport.failureLine(err)], json: { error: err.toJSON() } };
    }
  }

  /**
   * A note when BPMN_KEEP_FLOW_IDS, not a flag, kept flow ids where the default differs:
   * a stale flow id, or a move that put the moved node's old out-flow back. The variable
   * sits in a shell or an agent's settings, where whoever reads the result does not see it.
   */
  private keptByEnvNote(result: MutationResult, value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const { created, changed, warnings, relocated } = result.changes;
    const putBack = relocated.length > 0 && changed.some((change) => change.kind === 'sequenceFlow' && !created.some((creation) => creation.id === change.id));
    if (!putBack && !warnings.some((warning) => warning.code === 'W_FLOW_ID_STALE')) return undefined;
    return `flow ids kept: BPMN_KEEP_FLOW_IDS=${value} (--no-keep-flow-ids renames flows after their new ends for one command)`;
  }

  /**
   * renderSummary with `note` after the change lines, where the full result has its notes
   * (the summary prints no notes of its own).
   */
  private summaryText(summary: MutationSummary, opts: ConstructorParameters<typeof SummaryText>[1], note: string | undefined): string {
    const text = new SummaryText(summary, opts).text();
    if (!note) return text;
    const { aliases: _aliases, renamed: _renamed, format: _format, ...rest } = summary;
    const below = new SummaryText({ ...rest, created: {}, changed: [], removed: [] }, opts).text().split('\n').length - 1;
    const lines = text.split('\n');
    lines.splice(lines.length - below, 0, `note: ${note}`);
    return lines.join('\n');
  }

  /**
   * With kept flow ids, a missing id may be the one the default gives a flow an earlier op
   * rewired; the hint says so, as whoever reads the error may not see the variable.
   */
  private keptIdsHint(err: unknown, commands: readonly EditCommand[], value: string | undefined): unknown {
    if (value === undefined || commands.length < 2 || !isBpmnError(err) || err.code !== 'E_NOT_FOUND') return err;
    const kept = `If it is the id a flow an earlier op gave other ends would be renamed to: flow ids are kept here (BPMN_KEEP_FLOW_IDS=${value}), so that flow kept its old id; use the old id, or --no-keep-flow-ids to rename it after its new ends.`;
    const hint = err.details.hint;
    err.details.hint = typeof hint === 'string' && hint ? `${hint} ${kept}` : kept;
    return err;
  }

  /** Puts the file name into a refusal's runnable command (E_NO_ROOM) and its hint. */
  private withFile(err: unknown, file: string): unknown {
    if (!isBpmnError(err) || typeof err.details['command'] !== 'string' || file === '-') return err;
    const quoted = /^[\w./@%+=:,-]+$/.test(file) ? file : `'${file.replace(/'/g, `'\\''`)}'`;
    err.details['command'] = String(err.details['command']).replaceAll('<file>', quoted);
    if (typeof err.details.hint === 'string') err.details.hint = err.details.hint.replaceAll('bpmn space <file>', `bpmn space ${quoted}`);
    return err;
  }

  /** --layout <mode> / --relayout / --no-layout -> FileMutationOptions.layout */
  private layoutOption(options: RawOpts): FileMutationOptions['layout'] {
    const layout = options['layout'] as string | false | undefined;
    if (options['relayout']) {
      if (layout === false || (layout !== undefined && layout !== 'full')) {
        throw usageError(`--relayout cannot be combined with ${layout === false ? '--no-layout' : `--layout ${layout}`}`, { hint: '--relayout is --layout full; pass only one of them.' });
      }
      return 'full';
    }
    if (layout === false) return false;
    return (layout as LayoutMode | undefined) ?? 'auto';
  }

  /**
   * --keep-flow-ids / --no-keep-flow-ids, else BPMN_KEEP_FLOW_IDS; `env`: the variable's
   * value when it kept the ids.
   */
  private keepFlowIdsOption(options: RawOpts): { keep?: boolean; env?: string } {
    const flag = options['keepFlowIds'] as boolean | undefined;
    if (flag !== undefined) return { keep: flag };
    const keep = this.envSwitch('BPMN_KEEP_FLOW_IDS', 'Set BPMN_KEEP_FLOW_IDS=1 (true, yes, on) to keep flow ids, BPMN_KEEP_FLOW_IDS=0 (false, no, off) or unset it to rename them after their new ends; --keep-flow-ids / --no-keep-flow-ids decide for one command.');
    if (keep === undefined) return {};
    return keep ? { keep, env: this.cli.io.env['BPMN_KEEP_FLOW_IDS']!.trim() } : { keep };
  }

  /**
   * Unset or empty: undefined; 1 / true / yes / on: true; 0 / false / no / off: false.
   * Anything else is E_USAGE: a typo must not silently mean on or off.
   */
  private envSwitch(name: string, hint: string): boolean | undefined {
    const value = this.cli.io.env[name]?.trim();
    if (!value) return undefined;
    if (/^(1|true|yes|on)$/i.test(value)) return true;
    if (/^(0|false|no|off)$/i.test(value)) return false;
    throw usageError(`${name}=${value} is not a switch value`, { hint });
  }
}
