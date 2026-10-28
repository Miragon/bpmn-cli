import { InvalidArgumentError, type Command as CommandType } from 'commander';
import type { Doc } from '../../../domain/document/Doc.js';
import type { Shot } from '../../../application/port/out/WriteImagePort.js';
import type { FileMutationOptions } from '../../../application/port/in/EditDocumentUseCase.js';
import { defaultWithConditionViolation, placementViolation } from '../../../domain/commands/utils/op-rules.js';
import type { EditCommand, TriggerOptions } from '../../../domain/commands/types.js';
import { TRIGGER_FIELDS, TRIGGER_KEYS } from '../../../domain/commands/utils/op-fields.js';
import type { MutationResult } from '../../../domain/batch/types.js';
import { LAYOUT_MODES, type LayoutMode } from '../../../domain/diagram/types.js';
import { RENDER_MAX_SIZE, type RenderOptions } from '../../../application/port/in/RenderSvgUseCase.js';
import { changeHighlight } from '../report/utils/highlight.js';
import { type MutationReport } from '../report/command-report.js';
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
      .option(...commonOption('--strict'));
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
      throw this.withFile(err, file);
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

  /** --strict exits 5 on any warning. */
  private async printMutation(result: MutationResult, opts: OutputOptions & { show?: boolean; dryRun?: boolean }, out: CliStream): Promise<void> {
    const report = new MutationReportBuilder(result).report();
    const shot = opts.render ? await this.renderResult(result.xml, report, opts.render) : undefined;
    const shotText = shot ? `\n${shot.lines.join('\n')}` : '';
    if (opts.summary) {
      const summary = new MutationSummaryBuilder(report).summary();
      if (opts.json) this.cli.printJson({ ...summary, ...(report.view ? { view: report.view } : {}), ...(shot ? { render: shot.json } : {}) }, opts.pretty, out);
      else this.cli.print(new SummaryText(summary, { dryRun: opts.dryRun, advisory: advisoryOf((report).validation.validators) }).text() + shotText + (report.view ? `\n\n${new ModelViewText(report.view).text()}` : ''), out);
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
}
