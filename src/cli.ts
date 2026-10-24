#!/usr/bin/env node
/**
 * `bpmn` command line interface.
 *
 * Every command works on one .bpmn file. Mutating commands run the pipeline
 * (load -> ops -> validate -> layout -> atomic write) and print what changed.
 * The file I/O is src/node/files.ts, everything else the browser-safe core;
 * this module maps flags to its options (BPMN_LAYOUT_DEBUG to setLayoutDebug,
 * BPMN_KEEP_FLOW_IDS to keepFlowIds; a result the variable's kept flow ids
 * changed says so) and is the only one that reads the environment. Mutating
 * commands and `validate` run the project's
 * .bpmnlintrc (nearest above the file written (-o) or checked; a model from
 * stdin without -o: above the working directory; --lint-config,
 * --no-lint-config), project plugins included (lintProjectCode); its
 * element-id-naming gives the id conventions new ids follow (`bpmn show
 * <file> --conventions` shows them).
 *
 * `-` as the file reads the model from stdin; a mutating command then writes
 * its result to stdout (unless -o names a file), and `-o -` writes any
 * result to stdout. With the XML on stdout the report goes to stderr.
 * --json prints compact JSON (--pretty indents it).
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { Command, CommanderError, type Command as CommandType, InvalidArgumentError, Option } from 'commander';
import { BOUNDARY_SIDE_VALUES, COLOR_VALUES, LABEL_SIDE_VALUES, parseOps, SIDE_VALUES } from './ops/batch.js';
import { setLayoutDebug } from './shared/debug.js';
import { layoutProblems } from './diagram/metrics.js';
import { changeHighlight, RENDER_MAX_SIZE, renderSvg, scaleText, type RenderHighlight, type RenderOptions, type RenderProblem } from './render/index.js';
import { renderShown, viewDoc, type ViewOptions } from './api.js';
import { AROUND_DEFAULT_DEPTH } from './query/context.js';
import { conventionsView, renderConventions, type Undeclared } from './ids/conventions.js';
import { assertProcessId, assertTarget, Doc } from './model/document.js';
import { CliError, ioError, isCliError, usageError, type Warning } from './shared/errors.js';
import { renderExtensionList, renderFind, renderMetrics, renderView } from './report/view-text.js';
import { guideShort, guideText, guideTopic, KINDS_SECTION_NAMES, kindsJson, kindsSectionJson, kindsSectionText, kindsSections, kindsText } from './report/guide.js';
import { assertKindToken } from './model/kinds.js';
import { projectIdConventions } from './node/bpmnlint.js';
import { assertNewFile, checkFile, checkLoadedDoc, decodeXmlBytes, layoutDocToFile, layoutFile, mutateDocToFile, mutateFile, readDoc, readXml, type FileMutationOptions } from './node/files.js';
import { renderPng } from './node/render.js';
import { listAllExtensions } from './ops/ext.js';
import { parseSpaceAmount, type AddOp, type AlignOp, type ColorOp, type CompactOp, type ConnectOp, type ExtOp, type LabelOp, type MoveOp, type Op, type OrderOp, type PlaceOp, type RemoveOp, type RetypeOp, type RouteOp, type SetOp, type SpaceOp, type TidyOp, type TriggerOptions } from './ops/types.js';
import { assertLossless, LAYOUT_MODES, type LayoutMode, type MutationResult } from './pipeline/index.js';
import { PLATFORM_CHOICES, type PlatformChoice } from './platform/profiles/profile.js';
import { advisoryValidators, mutationReport, mutationSummary, mutationWarnings, renderMutation, renderSummary, renderValidation, validationReport, validatorTag, type MutationReport, type MutationSummary } from './report/command-report.js';
import { findElements } from './query/model-view.js';

/** The package version (dist/cli.js and src/cli.ts both sit one level below package.json). */
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

// placement candidates, reroute reasons, [strip] / [rows] lines of the layout engines
if (process.env['BPMN_LAYOUT_DEBUG']) setLayoutDebug((line) => process.stderr.write(`${line}\n`));

/* ------------------------------------------------------------------ */
/* output                                                               */
/* ------------------------------------------------------------------ */

interface OutputOptions {
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

type Out = NodeJS.WriteStream;

function print(text: string, out: Out = process.stdout): void {
  out.write(text.endsWith('\n') ? text : `${text}\n`);
}

/** JSON on one line (tokens), indented with --pretty. */
function printJson(value: unknown, pretty?: boolean, out: Out = process.stdout): void {
  out.write(`${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`);
}

/**
 * The result of a mutation (src/report/command-report.ts: the same for the CLI and the
 * in-memory API); --render draws the result (its own block / `render` key);
 * --strict exits 5 on any warning (process.exitCode, like every exit code:
 * process.exit would cut off what a pipe has not taken yet, beyond 64 KB on macOS).
 * Flow ids BPMN_KEEP_FLOW_IDS kept add a note (keptByEnvNote), also to --summary.
 */
async function printMutation(result: MutationResult, opts: OutputOptions & { show?: boolean; dryRun?: boolean }, out: Out = process.stdout): Promise<void> {
  const note = keptByEnvNote(result, opts.keepFlowIdsEnv);
  if (note) result.changes.note(note);
  const report = mutationReport(result);
  const shot = opts.render ? await renderMutationResult(result.xml, report, opts.render) : undefined;
  const shotText = shot ? `\n${shot.lines.join('\n')}` : '';
  if (opts.summary) {
    const summary = mutationSummary(report);
    if (opts.json) printJson({ ...summary, ...(note ? { notes: [note] } : {}), ...(report.view ? { view: report.view } : {}), ...(shot ? { render: shot.json } : {}) }, opts.pretty, out);
    else print(summaryText(summary, { dryRun: opts.dryRun, advisory: advisoryValidators(report) }, note) + shotText + (report.view ? `\n\n${renderView(report.view)}` : ''), out);
  } else if (opts.json) printJson(shot ? { ...report, render: shot.json } : report, opts.pretty, out);
  else print(renderMutation(report, { dryRun: opts.dryRun }).replace(/\n$/, '') + shotText, out);
  if (opts.strict && mutationWarnings(result).length) process.exitCode = 5;
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
function keptByEnvNote(result: MutationResult, value: string | undefined): string | undefined {
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
function summaryText(summary: MutationSummary, opts: Parameters<typeof renderSummary>[1], note: string | undefined): string {
  const text = renderSummary(summary, opts);
  if (!note) return text;
  const { aliases: _aliases, renamed: _renamed, format: _format, ...rest } = summary;
  const below = renderSummary({ ...rest, created: {}, changed: [], removed: [] }, opts).split('\n').length - 1;
  const lines = text.split('\n');
  lines.splice(lines.length - below, 0, `note: ${note}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* stdin / stdout                                                       */
/* ------------------------------------------------------------------ */

let stdinUsed: string | undefined;

/**
 * The whole of stdin (the caller decodes it like a file); stdin can feed one
 * input per call. Read as a stream: once anything touched process.stdin (an
 * import of node:process does), a pipe is non-blocking, and a synchronous
 * read fails with EAGAIN while its writer is slower than bpmn-cli's start
 * (`curl ... | bpmn validate -`).
 */
async function readStdin(what: string): Promise<Buffer> {
  if (stdinUsed) throw usageError(`stdin already holds ${stdinUsed}; it cannot also hold ${what}`, { hint: 'Read one of them from a file, e.g. `bpmn apply - ops.json < model.bpmn`.' });
  stdinUsed = what;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return Buffer.concat(chunks);
  } catch (err) {
    throw ioError('E_IO', `Cannot read ${what} from stdin: ${(err as Error).message}`, { hint: 'Pipe the input in, e.g. `cat model.bpmn | bpmn show -`.' });
  }
}

/** The document of a file argument: `-` reads it from stdin (it then has no file name). */
async function readDocArg(file: string): Promise<Doc> {
  if (file !== '-') return readDoc(file);
  return Doc.fromXml(decodeXmlBytes(await readStdin('the model'), 'stdin'));
}

/**
 * Runs a mutating command. The model comes from `file` (`-`: stdin); the
 * result goes to the file, to `-o <file>`, or to stdout (`-o -`, or a model
 * from stdin without -o; then the report goes to stderr).
 */
async function runMutation(
  file: string,
  opts: FileMutationOptions & OutputOptions,
  fromFile: (o: FileMutationOptions) => Promise<MutationResult>,
  fromDoc: (doc: Doc, o: FileMutationOptions) => Promise<MutationResult>,
): Promise<void> {
  const stdout = opts.out === '-' || (file === '-' && opts.out === undefined);
  const fileOpts: FileMutationOptions = stdout ? { ...opts, out: undefined, dryRun: true, backup: false } : opts;
  const result = file === '-' ? await fromDoc(await readDocArg('-'), fileOpts) : await fromFile(fileOpts);
  const xmlOut = stdout && !opts.dryRun;
  if (xmlOut) {
    process.stdout.write(result.xml.endsWith('\n') ? result.xml : `${result.xml}\n`);
    result.written = true;
    result.file = '-';
  }
  await printMutation(result, opts, xmlOut ? process.stderr : process.stdout);
}

/** A mutation of ops on `file` (`-`: stdin), see runMutation. */
async function mutateArg(file: string, ops: Op[], opts: FileMutationOptions & OutputOptions): Promise<void> {
  try {
    await runMutation(
      file,
      opts,
      (o) => mutateFile(file, ops, o),
      (doc, o) => {
        assertLossless(doc, o);
        return mutateDocToFile(doc, ops, o);
      },
    );
  } catch (err) {
    throw withFile(keptIdsHint(err, ops, opts.keepFlowIdsEnv), file);
  }
}

/**
 * E_NOT_FOUND in a batch whose flow ids BPMN_KEEP_FLOW_IDS (`value`) kept:
 * the missing id may be the one the default gives a flow an earlier op gave
 * other ends, which kept its old id here. The hint says so, because whoever
 * reads the error may not see the variable (keptByEnvNote for a result).
 */
function keptIdsHint(err: unknown, ops: readonly Op[], value: string | undefined): unknown {
  if (value === undefined || ops.length < 2 || !isCliError(err) || err.code !== 'E_NOT_FOUND') return err;
  const kept = `If it is the id a flow an earlier op gave other ends would be renamed to: flow ids are kept here (BPMN_KEEP_FLOW_IDS=${value}), so that flow kept its old id; use the old id, or --no-keep-flow-ids to rename it after its new ends.`;
  const hint = err.details.hint;
  err.details.hint = typeof hint === 'string' && hint ? `${hint} ${kept}` : kept;
  return err;
}

/** A refusal that carries a runnable command (E_NO_ROOM: details.command) names the file in it and in its hint. */
function withFile(err: unknown, file: string): unknown {
  if (!isCliError(err) || typeof err.details['command'] !== 'string' || file === '-') return err;
  const quoted = /^[\w./@%+=:,-]+$/.test(file) ? file : `'${file.replace(/'/g, `'\\''`)}'`;
  err.details['command'] = String(err.details['command']).replaceAll('<file>', quoted);
  if (typeof err.details.hint === 'string') err.details.hint = err.details.hint.replaceAll('bpmn space <file>', `bpmn space ${quoted}`);
  return err;
}

/** The error on stderr; the exit code is set, the command ends (run() is the last step of every action). */
function printError(err: unknown, json: boolean | undefined): void {
  if (isCliError(err)) {
    if (json) {
      process.stderr.write(`${JSON.stringify({ ok: false, error: err.toJSON() })}\n`);
    } else {
      const lines = [`error ${err.code}: ${err.message}`];
      const d = err.details;
      if (d.element) lines.push(`  element: ${String(d.element)}`);
      if (Array.isArray(d.related) && d.related.length) lines.push(`  related: ${d.related.join(', ')}`);
      if (Array.isArray(d.candidates) && d.candidates.length) lines.push(`  candidates: ${d.candidates.join(', ')}`);
      if (Array.isArray(d.errors)) for (const e of d.errors as Warning[]) lines.push(`  ${validatorTag(e)}${e.code}${e.element ? ` ${e.element}` : ''}: ${e.message}${e.hint ? `  (${e.hint})` : ''}`);
      if (Array.isArray(d.warnings)) for (const w of d.warnings as string[]) lines.push(`  ${w}`);
      if (d.op !== undefined) lines.push(`  op: #${String(d.op)}`);
      if (d.hint) lines.push(`  hint: ${String(d.hint)}`);
      process.stderr.write(`${lines.join('\n')}\n`);
    }
    process.exitCode = err.exitCode;
    return;
  }
  const e = err as Error;
  if (json) process.stderr.write(`${JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', message: e.message } })}\n`);
  else process.stderr.write(`error E_INTERNAL: ${e.message}\n${process.env['BPMN_DEBUG'] ? (e.stack ?? '') : ''}\n`);
  process.exitCode = 70;
}

/* ------------------------------------------------------------------ */
/* option helpers                                                       */
/* ------------------------------------------------------------------ */

/** --json, and --pretty to indent it. */
function withJsonOptions(cmd: CommandType): CommandType {
  return cmd.option('--json', 'machine-readable output (compact JSON)').option('--pretty', 'with --json: indented JSON');
}

function withMutationOptions(cmd: CommandType, { layoutToggle = true } = {}): CommandType {
  withJsonOptions(cmd)
    .option('--summary', 'short result: created ids by kind, changed / removed ids, added warnings, one layout line')
    .option('-o, --out <file>', 'write to this file instead of the input file (- = stdout)')
    .option('--dry-run', 'run everything but do not write')
    .option('--render <file>', 'also draw the result to this .png / .svg: created, changed and moved elements with a halo, the layout problems the change added numbered (a large drawing: the region of the change)', renderTarget);
  if (layoutToggle) {
    cmd
      .option('--layout <mode>', 'auto (default): keep a hand-made diagram and place changes locally, redraw an engine-owned one; incremental: always keep; full: always redraw', (v: string) => {
        if (!(LAYOUT_MODES as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${LAYOUT_MODES.join(', ')}`);
        return v;
      })
      .option('--relayout', 'redraw the whole diagram (= --layout full)')
      .option('--no-layout', 'do not update the diagram (new elements get no shape, a flow whose ends changed loses its edge; format operations still apply)');
  }
  return withLintOptions(cmd)
    .option('--force', 'write despite a lossy import, new validation errors or content a retype would delete')
    .option('--backup', 'copy the input file to <file>.bak before writing')
    .option('--show', 'append the full model view to the result')
    .option('--strict', 'exit with code 5 when there are warnings')
    .option('--keep-flow-ids', 'keep the id of every existing sequence flow the change gives other ends, instead of renaming a flow whose id names its old ends after its new ones; W_FLOW_ID_STALE names each flow whose id no longer names its ends. BPMN_KEEP_FLOW_IDS=1 makes keeping the default')
    .option('--no-keep-flow-ids', 'rename such flows after their new ends, also when BPMN_KEEP_FLOW_IDS=1')
    .option('--engine <engine>', 'layout engine: clean (default) or auto (bpmn-auto-layout)', (v: string) => {
      if (v !== 'clean' && v !== 'auto') throw new InvalidArgumentError('expected clean or auto');
      return v;
    });
}

/** --lint-config <path> / --no-lint-config (in this order, so that the default stays undefined, like --layout / --no-layout) */
function withLintOptions(cmd: CommandType): CommandType {
  return cmd
    .option('--lint-config <path>', "the project's bpmnlint configuration (default: the nearest .bpmnlintrc above the file written (-o) or checked, up to the repository root, whoever owns it; outside one only in the file's directory; stdin without -o: from the working directory)")
    .option('--no-lint-config', "do not read the project's bpmnlint configuration (no bpmnlint findings, no id conventions from element-id-naming)");
}

function withTriggerOptions(cmd: CommandType): CommandType {
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

interface RawOpts {
  [key: string]: unknown;
}

/** --layout <mode> / --relayout / --no-layout -> FileMutationOptions.layout */
function layoutOption(o: RawOpts): FileMutationOptions['layout'] {
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
 * A switch from the environment: unset or empty = undefined, 1 / true / yes / on = true, 0 / false / no / off = false
 * (any case). Anything else is E_USAGE: a typo must not silently mean on or off.
 */
function envSwitch(name: string, hint: string): boolean | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw usageError(`${name}=${value} is not a switch value`, { hint });
}

/**
 * --keep-flow-ids / --no-keep-flow-ids, else BPMN_KEEP_FLOW_IDS, else
 * undefined (flows follow their ends); `env`: the variable's value when it
 * kept them (the result says so: keptByEnvNote).
 */
function keepFlowIdsOption(o: RawOpts): { keep?: boolean; env?: string } {
  const flag = o['keepFlowIds'] as boolean | undefined;
  if (flag !== undefined) return { keep: flag };
  const keep = envSwitch('BPMN_KEEP_FLOW_IDS', 'Set BPMN_KEEP_FLOW_IDS=1 (true, yes, on) to keep flow ids, BPMN_KEEP_FLOW_IDS=0 (false, no, off) or unset it to rename them after their new ends; --keep-flow-ids / --no-keep-flow-ids decide for one command.');
  if (keep === undefined) return {};
  return keep ? { keep, env: process.env['BPMN_KEEP_FLOW_IDS']!.trim() } : { keep };
}

/** The working directory, or undefined when it was removed (a command on absolute paths still runs there). */
function workingDir(): string | undefined {
  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

/** --lint-config / --no-lint-config -> FileBpmnlintOptions: paths and stdin from the working directory, project plugins run */
function lintOptions(o: RawOpts): Pick<FileMutationOptions, 'lintConfig' | 'lintFrom' | 'lintProjectCode'> {
  const config = o['lintConfig'] as string | false | undefined;
  const cwd = config === false ? undefined : workingDir();
  return { ...(config !== undefined ? { lintConfig: config } : {}), ...(cwd !== undefined ? { lintFrom: cwd } : {}), lintProjectCode: true };
}

function mutationOptions(o: RawOpts): FileMutationOptions & OutputOptions {
  const { keep: keepFlowIds, env: keepFlowIdsEnv } = keepFlowIdsOption(o);
  return {
    json: !!o['json'],
    pretty: !!o['pretty'],
    summary: !!o['summary'],
    out: o['out'] as string | undefined,
    dryRun: !!o['dryRun'],
    layout: layoutOption(o),
    force: !!o['force'],
    backup: !!o['backup'],
    show: !!o['show'],
    strict: !!o['strict'],
    ...(o['render'] !== undefined ? { render: String(o['render']) } : {}),
    ...(o['engine'] ? { engine: o['engine'] as 'clean' | 'auto' } : {}),
    ...(keepFlowIds !== undefined ? { keepFlowIds } : {}),
    ...(keepFlowIdsEnv !== undefined ? { keepFlowIdsEnv } : {}),
    ...lintOptions(o),
  };
}

function triggerOptions(o: RawOpts): TriggerOptions {
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

function parseKeyValues(items: string[], what = 'property'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const idx = item.indexOf('=');
    if (idx <= 0) throw new CliError('E_USAGE', `Expected ${what} as key=value, got "${item}"`, 'usage');
    out[item.slice(0, idx).trim()] = item.slice(idx + 1);
  }
  return out;
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Option parser for kind tokens: the documented kind codes (usage errors, like `add`) instead of commander's generic text. */
function kindArg(value: string): string {
  assertKindToken(value);
  return value;
}

/* The same rules `apply` enforces on ops JSON (ops/batch.ts), spelled with CLI flags. */

const PLACEMENT_FLAGS = ['after', 'before', 'flow', 'in', 'on'] as const;
const FLOW_FLAGS: Record<string, string> = { flowName: '--flow-name', flowId: '--flow-id', condition: '--condition', language: '--language', default: '--default' };

function flag(key: string): string {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Exactly one placement, or --after together with --before. */
function checkPlacementFlags(o: RawOpts): void {
  const used = PLACEMENT_FLAGS.filter((k) => o[k] !== undefined && o[k] !== '');
  if (used.length <= 1 || (used.length === 2 && used.includes('after') && used.includes('before'))) return;
  throw usageError(`${used.map(flag).join(' and ')} cannot be combined`, {
    hint: 'Use exactly one placement: --after, --before, --after + --before (splice into that flow), --flow, --in, or --on (boundary events).',
  });
}

/** Flow options describe the flow INTO the node; they need a placement that creates one. */
function checkFlowFlags(o: RawOpts, needsPlacement: boolean): void {
  if (o['default'] && o['condition'] !== undefined) {
    throw usageError('--default and --condition are mutually exclusive: a default flow has no condition', {
      hint: 'Keep the condition on the other branches and mark this one as default.',
    });
  }
  if (!needsPlacement) return;
  const used = Object.keys(FLOW_FLAGS).filter((k) => o[k] !== undefined && o[k] !== false);
  const createsFlow = !!o['after'] || !!o['before'] || !!o['flow'];
  if (used.length && !createsFlow) {
    throw usageError(`${used.map((k) => FLOW_FLAGS[k]).join(', ')} describe the flow into the node and need --after, --before or --flow`, {
      hint: 'With --in or --on no sequence flow is created; connect the node afterwards with `bpmn connect`.',
    });
  }
}

async function run(fn: () => Promise<void>, json?: boolean): Promise<void> {
  try {
    await fn();
  } catch (err) {
    printError(err, json);
  }
}

/* ------------------------------------------------------------------ */
/* program                                                              */
/* ------------------------------------------------------------------ */

const program = new Command();
program
  .name('bpmn')
  .description('Edit BPMN 2.0 models semantically; the diagram is laid out automatically (bpmn.io).')
  .version(VERSION)
  // parser errors (unknown command / option, missing argument) are rendered by printError like every other error
  .exitOverride()
  .configureOutput({ writeErr: (s) => process.stderr.write(s), outputError: () => undefined });

/* new ---------------------------------------------------------------- */
withMutationOptions(
  program
    .command('new <file>')
    .description('create a new .bpmn file with one empty process')
    .option('--name <text>', 'process name')
    .option('--id <processId>', "process id (default: Process_<Name> or Process_1; a bpmn:Process prefix the .bpmnlintrc's element-id-naming names: that prefix and the name, process_main without one)")
    .option('--no-executable', 'isExecutable=false')
    .option('--target <platform>', 'camunda8 | camunda7: declare vendor namespaces (camunda7: also historyTimeToLive=180 and the platform version, like Camunda Modeler; for CIB seven and Operaton too)', (v: string) => {
      try {
        assertTarget(v);
      } catch {
        throw new InvalidArgumentError('expected camunda8 or camunda7 (camunda7 also covers CIB seven and Operaton)');
      }
      return v;
    }),
).action(async (file: string, o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    // `new -` (or -o -) writes the new model to stdout
    const stdout = file === '-' || opts.out === '-';
    // what fails without a .bpmnlintrc fails first, as before one was read: an invalid --id, a file that exists
    const processId = o['id'] as string | undefined;
    if (processId !== undefined) assertProcessId(processId);
    if (!stdout) await assertNewFile(opts.out ?? file, opts);
    // the id conventions of the .bpmnlintrc that applies to the file written (the process id only where they name bpmn:Process)
    const target = opts.out && opts.out !== '-' ? opts.out : file === '-' ? undefined : file;
    const conventions = (await projectIdConventions(target, opts))?.conventions;
    const doc = Doc.create(
      {
        processName: o['name'] as string | undefined,
        processId,
        executable: o['executable'] !== false,
        target: o['target'] as 'camunda8' | 'camunda7' | undefined,
        ...(conventions ? { conventions } : {}),
      },
      file === '-' ? undefined : file,
    );
    const result = await mutateDocToFile(doc, [], { ...opts, mustNotExist: true, ...(stdout ? { out: undefined, dryRun: true } : {}) });
    result.changes.create({ id: doc.processes()[0]!.get<string>('id'), kind: 'process', name: o['name'] as string | undefined });
    const xmlOut = stdout && !opts.dryRun;
    if (xmlOut) {
      process.stdout.write(result.xml.endsWith('\n') ? result.xml : `${result.xml}\n`);
      result.written = true;
      result.file = '-';
    }
    await printMutation(result, opts, xmlOut ? process.stderr : process.stdout);
  }, opts.json);
});

/* show --------------------------------------------------------------- */
function depthArg(v: string): number {
  if (!/^\d+$/.test(v)) throw new InvalidArgumentError('expected a whole number >= 0');
  return Number(v);
}

withJsonOptions(
  program
    .command('show <file> [id]')
    .description('print the model (or one element) as the AI sees it: no coordinates (file - = stdin)')
    .option('--scope <id>', 'only this process / sub-process / participant')
    .option('--around <id>', 'only the neighbourhood of this element: --depth flow steps along sequence flows, both ways')
    .option('--depth <n>', 'with --around: flow steps (default 2)', depthArg)
    .option('--inner', 'with --around: also enter sub-processes from outside')
    .option('--context', 'with an id: the element in its context (where, lane, before / after, what catches it, message flows)')
    .option('--layout', 'the drawing instead of the model: rows of node ids per pool / lane with their columns (c0..cN), wide gaps, colours, label sides, layout problems')
    .option('--conventions', "the id conventions new ids follow here: element-id-naming of the .bpmnlintrc (prefixes, case, qualifier) and the file's own style; a file that does not exist yet: those of a new model there")
    // --lint-config before --no-lint-config: neither given leaves lintConfig undefined
    .option('--lint-config <path>', "with --conventions: the project's bpmnlint configuration (default: the nearest .bpmnlintrc above the file, up to the repository root, whoever owns it; outside one only in the file's directory; stdin: from the working directory)")
    .option('--no-lint-config', 'with --conventions: do not read the .bpmnlintrc (no id conventions from element-id-naming)'),
).action(async (file: string, id: string | undefined, o: RawOpts) => {
  await run(async () => {
    if (o['conventions']) {
      const extra = [...(id !== undefined ? ['the element id'] : []), ...['scope', 'around', 'depth', 'inner', 'context', 'layout'].filter((k) => o[k] !== undefined && o[k] !== false).map((k) => `--${k}`)];
      if (extra.length) throw usageError(`--conventions shows the id conventions of the whole file; drop ${extra.join(' and ')}`, { hint: 'Use `bpmn show <file> --conventions`.' });
      // a file that does not exist yet: the conventions a new model there gets (before `bpmn new`)
      const doc = file === '-' || existsSync(file) ? await readDocArg(file) : undefined;
      const found = await projectIdConventions(file === '-' ? undefined : file, lintOptions(o));
      // why none are declared, where none are
      const undeclared: Undeclared = o['lintConfig'] === false ? 'skipped' : !found ? 'no config' : found.unavailable ? 'not loaded' : !found.setting || found.setting.severity === 'off' ? 'off' : 'no prefixes';
      const view = conventionsView(doc, found?.conventions, {
        ...(file !== '-' ? { file } : {}),
        ...(found?.setting ? { severity: found.setting.severity } : {}),
        notes: found?.notes ?? [],
        ...(found ? { where: found.where } : {}),
        undeclared,
      });
      if (o['json']) printJson(view, !!o['pretty']);
      else print(renderConventions(view));
      return;
    }
    // the .bpmnlintrc only decides the id conventions here
    if (o['lintConfig'] !== undefined) {
      throw usageError(`${o['lintConfig'] === false ? '--no-lint-config' : '--lint-config'} goes only with --conventions`, { hint: 'Use `bpmn show <file> --conventions --lint-config <path>` (or --no-lint-config).' });
    }
    const opts: ViewOptions = {
      ...(id !== undefined ? { id } : {}),
      ...(o['context'] ? { context: true } : {}),
      ...(o['around'] !== undefined ? { around: String(o['around']) } : {}),
      ...(o['depth'] !== undefined ? { depth: o['depth'] as number } : {}),
      ...(o['inner'] ? { inner: true } : {}),
      ...(o['scope'] !== undefined ? { scope: String(o['scope']) } : {}),
      ...(o['layout'] ? { layout: true } : {}),
    };
    const shown = viewDoc(await readDocArg(file), opts);
    if (o['json']) printJson(shown.kind === 'layout' ? { file, ...shown.view } : shown.view, !!o['pretty']);
    else print(renderShown(shown));
  }, !!o['json']);
});

/* find --------------------------------------------------------------- */
withJsonOptions(
  program
    .command('find <file> <text>')
    .description('find elements by id, name or vendor attribute value (case-insensitive substring; file - = stdin)')
    .option('--kind <kind>', 'restrict to a kind', kindArg),
).action(async (file: string, text: string, o: RawOpts) => {
  await run(async () => {
    const doc = await readDocArg(file);
    const hits = findElements(doc, text, o['kind'] as string | undefined);
    if (o['json']) printJson(hits, !!o['pretty']);
    else print(renderFind(hits));
  }, !!o['json']);
});

/* add ---------------------------------------------------------------- */
withTriggerOptions(
  withMutationOptions(
    program
      .command('add <file> <kind> [name] [keyValues...]')
      .description('create an element and wire it in (kind[:trigger], e.g. userTask, startEvent:message, boundaryEvent:timer)')
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
).action(async (file: string, kind: string, name: string | undefined, keyValues: string[], o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    const kv = [...keyValues];
    if (name && /^[A-Za-z_][\w:.-]*=/.test(name)) {
      kv.unshift(name);
      name = undefined;
    }
    checkPlacementFlags(o);
    checkFlowFlags(o, true);
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
      ...triggerOptions(o),
    };
    await mutateArg(file, [op], opts);
  }, opts.json);
});

/* connect ------------------------------------------------------------ */
withMutationOptions(
  program
    .command('connect <file> <sourceId> <targetId>')
    .description('connect two elements (sequence flow, message flow, association or data association is inferred)')
    .option('--name <text>', 'flow name')
    .option('--id <id>', 'flow id')
    .option('--condition <expr>', 'condition expression (sequence flows)')
    .option('--language <lang>', 'expression language')
    .option('--default', 'default flow of the source gateway / activity')
    .option('--message <name>', 'message flows: message name')
    .option('--if-absent', 'succeed silently when the connection exists'),
).action(async (file: string, source: string, target: string, o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    checkFlowFlags(o, false);
    const op: ConnectOp = {
      op: 'connect',
      source,
      target,
      ...(o['name'] ? { name: String(o['name']) } : {}),
      ...(o['id'] ? { id: String(o['id']) } : {}),
      ...(o['condition'] !== undefined ? { condition: String(o['condition']) } : {}),
      ...(o['language'] ? { language: String(o['language']) } : {}),
      ...(o['default'] ? { default: true } : {}),
      ...(o['message'] ? { message: String(o['message']) } : {}),
      ...(o['ifAbsent'] ? { ifAbsent: true } : {}),
    };
    await mutateArg(file, [op], opts);
  }, opts.json);
});

/* set ---------------------------------------------------------------- */
withMutationOptions(
  program
    .command('set <file> <id> [keyValues...]')
    .description('set properties: key=value ... (see `bpmn kinds` for keys; key= unsets)')
    .option('--unset <key>', 'remove a property (repeatable)', (v: string, prev: string[]) => [...prev, v], [] as string[]),
).action(async (file: string, id: string, keyValues: string[], o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    const unset = (o['unset'] as string[]) ?? [];
    if (!keyValues.length && !unset.length) throw new CliError('E_USAGE', 'Nothing to set: pass key=value pairs or --unset <key>', 'usage');
    const op: SetOp = { op: 'set', id, values: parseKeyValues(keyValues), ...(unset.length ? { unset } : {}) };
    await mutateArg(file, [op], opts);
  }, opts.json);
});

/* remove ------------------------------------------------------------- */
withMutationOptions(
  program
    .command('remove <file> <ids...>')
    .alias('rm')
    .description('remove elements (connected flows, boundary events, associations follow; a node with one in/out flow is bridged, a merge from every predecessor; a parallel / inclusive join needs --bridge-all or --no-bridge)')
    .option('--no-bridge', 'do not reconnect predecessor and successor')
    .option('--bridge-all', 'a join (several incoming flows, one outgoing): connect every predecessor to the successor')
    .option('--with-branch', 'also remove the exclusive downstream path (every node only this one leads to, up to the next merge or the ends)')
    .option('--if-exists', 'ignore unknown ids'),
).action(async (file: string, ids: string[], o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    const op: RemoveOp = {
      op: 'remove',
      ids,
      bridge: o['bridge'] !== false,
      ...(o['bridgeAll'] ? { bridgeAll: true } : {}),
      ...(o['withBranch'] ? { withBranch: true } : {}),
      ...(o['ifExists'] ? { ifExists: true } : {}),
    };
    await mutateArg(file, [op], opts);
  }, opts.json);
});

/* retype ------------------------------------------------------------- */
withTriggerOptions(
  withMutationOptions(
    program
      .command('retype <file> <id> <kind>')
      .alias('replace')
      .description('change the kind of an element (task -> userTask, endEvent -> endEvent:error ...) keeping id and connections'),
  ),
).action(async (file: string, id: string, kind: string, o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    const op: RetypeOp = { op: 'retype', id, kind, ...triggerOptions(o) };
    await mutateArg(file, [op], opts);
  }, opts.json);
});

/* move --------------------------------------------------------------- */
withMutationOptions(
  program
    .command('move <file> <ids...>')
    .description('relocate nodes: --after/--before/--flow (re-insert), --in (another scope), --on (boundary events), --lane')
    .option('--after <id>', 'insert after this node')
    .option('--before <id>', 'insert before this node')
    .option('--flow <flowId>', 'insert into this flow')
    .option('--in <scopeId>', 'move into this process / sub-process')
    .option('--on <activityId>', 'boundary events: re-attach to this activity')
    .option('--lane <laneId>', 'assign to this lane (empty string removes)'),
).action(async (file: string, ids: string[], o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    checkPlacementFlags(o);
    const op: MoveOp = {
      op: 'move',
      ids,
      ...(o['after'] ? { after: String(o['after']) } : {}),
      ...(o['before'] ? { before: String(o['before']) } : {}),
      ...(o['flow'] ? { flow: String(o['flow']) } : {}),
      ...(o['in'] ? { in: String(o['in']) } : {}),
      ...(o['on'] ? { on: String(o['on']) } : {}),
      ...(o['lane'] !== undefined ? { lane: String(o['lane']) } : {}),
    };
    if (!op.after && !op.before && !op.flow && !op.in && !op.on && op.lane === undefined) {
      throw usageError('move needs one of --after, --before, --flow, --in, --on or --lane');
    }
    await mutateArg(file, [op], opts);
  }, opts.json);
});

/* order -------------------------------------------------------------- */
withMutationOptions(
  program
    .command('order <file> <id> <ids...>')
    .description('order the outgoing flows of a node (top-to-bottom branch order), the lanes of a pool / process / parent lane, or the pools of a collaboration (top to bottom)'),
).action(async (file: string, nodeId: string, flowIds: string[], o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    const op: OrderOp = { op: 'order', id: nodeId, flows: flowIds };
    await mutateArg(file, [op], opts);
  }, opts.json);
});

/* ext ---------------------------------------------------------------- */
const ext = program.command('ext').description('vendor extension elements (<bpmn:extensionElements>)');
withMutationOptions(
  ext
    .command('add <file> <id> <type> [attrs...]')
    .description('add an extension element, e.g. zeebe:taskDefinition type=send-email retries=3; child types go into their container (camunda:inputParameter -> camunda:inputOutput), single-instance containers are merged; <type> may be a path (camunda:connector/camunda:inputParameter) and take a definition. / loop. / condition. prefix for a nested element')
    .option('--body <text>', 'text content')
    .option('--xml <snippet>', 'raw XML snippet (may contain nested elements); its roots must be of <type>')
    .option('--replace', 'replace existing elements of the same type (and key) instead of merging'),
).action(async (file: string, id: string, type: string, attrs: string[], o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    const op: ExtOp = {
      op: 'ext',
      id,
      action: 'add',
      type,
      ...(attrs.length ? { attrs: parseKeyValues(attrs, 'attribute') } : {}),
      ...(o['body'] ? { body: String(o['body']) } : {}),
      ...(o['xml'] ? { xml: String(o['xml']) } : {}),
      ...(o['replace'] ? { replace: true } : {}),
    };
    await mutateArg(file, [op], opts);
  }, opts.json);
});
withMutationOptions(
  ext
    .command('remove <file> <id> <selector>')
    .description("remove extension elements: a type, one item ('camunda:inputParameter[name=x]', 'camunda:formField[1]'), a path, or an index from `ext list` (loop.0 for a nested element's)"),
).action(
  async (file: string, id: string, typeOrIndex: string, o: RawOpts) => {
    const opts = mutationOptions(o);
    await run(async () => {
      // `2` or `loop.2`: an index (of the element's own / of a nested element's extension elements); anything else a selector
      const indexed = /^(?:(definition|loop|condition)\.)?(\d+)$/.exec(typeOrIndex.trim());
      const op: ExtOp = indexed
        ? { op: 'ext', id, action: 'remove', index: Number(indexed[2]), ...(indexed[1] ? { slot: indexed[1] as ExtOp['slot'] } : {}) }
        : { op: 'ext', id, action: 'remove', type: typeOrIndex };
      await mutateArg(file, [op], opts);
    }, opts.json);
  },
);
withJsonOptions(ext.command('list <file> <id>').description('list extension elements of an element (and of its event definition / loop / condition) as an indented tree')).action(
  async (file: string, id: string, o: RawOpts) => {
    await run(async () => {
      const doc = await readDocArg(file);
      const el = doc.require(id);
      const items = listAllExtensions(el);
      if (o['json']) printJson(items, !!o['pretty']);
      else print(renderExtensionList(items));
    }, !!o['json']);
  },
);

/* format operations (diagram only) ----------------------------------- */

/** At most one flag per group, and (with `need`) at least one of all. */
function checkFlagGroups(o: RawOpts, groups: string[][], need?: string): void {
  for (const g of groups) {
    const used = g.filter((k) => o[k] !== undefined);
    if (used.length > 1) throw usageError(`${used.map(flag).join(' and ')} cannot be combined`, { hint: `Give at most one of ${g.map(flag).join(', ')}.` });
  }
  if (need && !groups.flat().some((k) => o[k] !== undefined)) throw usageError(need);
}

function pick<K extends string>(o: RawOpts, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = String(o[k]);
  return out;
}

async function runFormat(file: string, op: Op, o: RawOpts): Promise<void> {
  const opts = mutationOptions(o);
  await run(async () => {
    await mutateArg(file, [op], opts);
  }, opts.json);
}

/** --path <fromId> <toId> [--via <flowId...>], --kind <kind>, --branch <flowId> (src/query/select.ts). */
function withSelectors(cmd: CommandType, what: string): CommandType {
  return cmd
    .option('--path <ids...>', `${what} every node${what === 'colour' ? ' and flow' : ''} on the shortest sequence-flow path <fromId> <toId>`)
    .option('--via <flowIds...>', 'with --path: flows the path must pass, in order')
    .option('--kind <kind>', `${what} every element of this kind (find --kind grammar: endEvent, userTask, ...)`)
    .option('--branch <flowId>', `${what} the branch this sequence flow starts, up to the join`);
}

/** The ids and selectors of a format command; `need`: ids or a selector are required. */
function selectorsOf(ids: string[], o: RawOpts, need: boolean): Pick<PlaceOp, 'ids' | 'path' | 'via' | 'kind' | 'branch'> {
  const path = o['path'] as string[] | undefined;
  if (path && path.length !== 2) throw usageError(`--path takes exactly two ids (from and to), got ${path.length}`, { hint: 'Put the other ids before --path, or end the list with --: `bpmn color f.bpmn --path Event_Start Event_Done --color green`.' });
  if (o['via'] && !path) throw usageError('--via needs --path');
  const out = { ...(ids.length ? { ids } : {}), ...(path ? { path } : {}), ...(o['via'] ? { via: o['via'] as string[] } : {}), ...pick(o, ['kind', 'branch'] as const) };
  if (need && !ids.length && !path && !out.kind && !out.branch) throw usageError('name the elements: ids and / or --path <fromId> <toId>, --kind <kind>, --branch <flowId>');
  return out;
}

withMutationOptions(
  withSelectors(
    program
      .command('place <file> [ids...]')
      .description('diagram only: move shapes (one rigid group, the first id is the reference) to the row and/or column of another element')
      .option('--row-of <id>', 'row: centre on the row of this element')
      .option('--below <id>', 'row: the row below this element')
      .option('--above <id>', 'row: the row above this element')
      .option('--column-of <id>', 'column: centre on the column of this element')
      .option('--after <id>', 'column: right of this element')
      .option('--before <id>', 'column: left of this element')
      .addOption(new Option('--side <side>', 'a boundary event (the only id): move it to this border of its host; its outgoing flow is routed again and its exception path follows').choices([...BOUNDARY_SIDE_VALUES])),
    'move',
  ),
).action(async (file: string, ids: string[], o: RawOpts) => {
  await run(async () => {
    if (o['side'] !== undefined) {
      const given = ['rowOf', 'below', 'above', 'columnOf', 'after', 'before', 'path', 'kind', 'branch'].filter((k) => o[k] !== undefined);
      if (given.length) throw usageError(`--side cannot be combined with ${given.map(flag).join(', ')}`, { hint: '`bpmn place <file> <boundaryEventId> --side top` moves a boundary event to the top border of its host; place the host to move both.' });
      if (ids.length !== 1) throw usageError('--side takes exactly one id: the boundary event', { hint: 'Example: `bpmn place order.bpmn Event_PaymentOverdue --side top`.' });
      await runFormat(file, { op: 'place', ids, side: o['side'] as PlaceOp['side'] }, o);
      return;
    }
    checkFlagGroups(o, [['rowOf', 'below', 'above'], ['columnOf', 'after', 'before']], 'place needs a row (--row-of, --below, --above) and/or a column (--column-of, --after, --before), or --side for a boundary event');
    const op: PlaceOp = { op: 'place', ...selectorsOf(ids, o, true), ...pick(o, ['rowOf', 'below', 'above', 'columnOf', 'after', 'before'] as const) };
    await runFormat(file, op, o);
  }, !!o['json']);
});

withMutationOptions(
  withSelectors(
    program
      .command('align <file> [ids...]')
      .description('diagram only: put shapes on one row (same vertical centre) or one column (same horizontal centre)')
      .addOption(new Option('--axis <axis>', 'row or column').choices(['row', 'column']).makeOptionMandatory())
      .option('--to <id>', 'reference element that stays (default: the first id; with only --kind and --axis column: the rightmost one)'),
    'align',
  ),
).action(async (file: string, ids: string[], o: RawOpts) => {
  await run(async () => {
    const sel = selectorsOf(ids, o, true);
    if (!sel.path && !sel.kind && !sel.branch && ids.length < 2 && !o['to']) throw usageError('align needs two ids, or one id and --to <id>');
    const op: AlignOp = { op: 'align', ...sel, axis: o['axis'] as AlignOp['axis'], ...pick(o, ['to'] as const) };
    await runFormat(file, op, o);
  }, !!o['json']);
});

withMutationOptions(
  withSelectors(
    program
      .command('color <file> [ids...]')
      .alias('colour')
      .description('diagram only: colour shapes and connections (bpmn-js colour picker colours; default removes the colour)')
      .addOption(new Option('--color <color>', COLOR_VALUES.join(' | ')).choices([...COLOR_VALUES]).makeOptionMandatory()),
    'colour',
  ),
).action(async (file: string, ids: string[], o: RawOpts) => {
  await run(async () => {
    const op: ColorOp = { op: 'color', ...selectorsOf(ids, o, true), color: o['color'] as ColorOp['color'] };
    await runFormat(file, op, o);
  }, !!o['json']);
});

withMutationOptions(
  program
    .command('label <file> <id>')
    .description('diagram only: put the external label of an event, gateway, data element or flow on one side')
    .addOption(new Option('--side <side>', LABEL_SIDE_VALUES.join(' | ')).choices([...LABEL_SIDE_VALUES]).makeOptionMandatory()),
).action(async (file: string, id: string, o: RawOpts) => {
  const op: LabelOp = { op: 'label', id, side: o['side'] as LabelOp['side'] };
  await runFormat(file, op, o);
});

withMutationOptions(
  program
    .command('route <file> <flowId>')
    .description('diagram only: route a sequence / message flow again, optionally forcing the side it leaves and enters by (a flow without a line whose ends are drawn gets one)')
    .addOption(new Option('--exit <side>', `side it leaves its source by: ${SIDE_VALUES.join(' | ')}`).choices([...SIDE_VALUES]))
    .addOption(new Option('--entry <side>', `side it enters its target by: ${SIDE_VALUES.join(' | ')}`).choices([...SIDE_VALUES])),
).action(async (file: string, flowId: string, o: RawOpts) => {
  const op: RouteOp = { op: 'route', id: flowId, ...(pick(o, ['exit', 'entry'] as const) as Pick<RouteOp, 'exit' | 'entry'>) };
  await runFormat(file, op, o);
});

withMutationOptions(
  program
    .command('space <file>')
    .description('diagram only: insert space right of / below an element (the modeler\'s space tool)')
    .option('--after <id>', 'horizontal space right of this element')
    .option('--below <id>', 'vertical space below this element')
    .option('--by <amount>', 'column (default for --after), row (default for --below), <n>col / <n>row (n of them) or pixels (<n>, <n>px); -column, -<n>col, -row or -<px> closes that much empty space instead', (v: string) => {
      if (!parseSpaceAmount(v)) throw new InvalidArgumentError('expected column, row, <n>col, <n>row (2col: two columns) or pixels (80, 80px); negative (-column, -2col, -80) to close space');
      return /^\s*-?\d+\s*$/.test(v) ? Number(v) : v;
    }),
).action(async (file: string, o: RawOpts) => {
  await run(async () => {
    checkFlagGroups(o, [['after', 'below']], 'space needs --after <id> (horizontal space) or --below <id> (vertical space)');
    const op: SpaceOp = { op: 'space', ...pick(o, ['after', 'below'] as const), ...(o['by'] !== undefined ? { by: o['by'] as SpaceOp['by'] } : {}) };
    await runFormat(file, op, o);
  }, !!o['json']);
});

withMutationOptions(
  withSelectors(program.command('tidy <file> [ids...]').description('diagram only: remove overlaps and gaps < 20 px with minimal moves, keeping the order (default: every shape)'), 'tidy'),
).action(async (file: string, ids: string[], o: RawOpts) => {
  await run(async () => {
    const op: TidyOp = { op: 'tidy', ...selectorsOf(ids, o, false) };
    await runFormat(file, op, o);
  }, !!o['json']);
});

withMutationOptions(
  program
    .command('compact <file> [ids...]')
    .description('diagram only: close empty rows and columns and shrink pools, lanes and expanded sub-processes to their content (default: the whole drawing), keeping the order; never adds a layout problem'),
).action(async (file: string, ids: string[], o: RawOpts) => {
  const op: CompactOp = { op: 'compact', ...(ids.length ? { ids } : {}) };
  await runFormat(file, op, o);
});

/* metrics ------------------------------------------------------------ */
withJsonOptions(program.command('metrics <file>').description('layout quality of the drawing: score, counts and every problem with the element ids (file - = stdin)')).action(
  async (file: string, o: RawOpts) => {
    await run(async () => {
      const doc = await readDocArg(file);
      const m = layoutProblems(doc.definitions);
      if (o['json']) printJson({ file, score: m.score, counts: m.counts, problems: m.problems }, !!o['pretty']);
      else print(renderMetrics(m));
    }, !!o['json']);
  },
);

/* render ------------------------------------------------------------- */
const RENDER_FORMATS = ['png', 'svg'] as const;
type RenderFormat = (typeof RENDER_FORMATS)[number];

function boundedNumber(what: string, min: number, max: number, integer: boolean) {
  return (v: string): number => {
    const x = Number(v);
    if (!/^\d+(\.\d+)?$/.test(v.trim()) || !Number.isFinite(x) || x < min || x > max || (integer && !Number.isInteger(x))) {
      throw new InvalidArgumentError(`expected ${integer ? 'a whole number' : 'a number'} from ${min} to ${max} (${what})`);
    }
    return x;
  };
}

/** --format, else the -o extension (.png / .svg), else png; a --format the extension contradicts is E_USAGE, and so is an -o name without .png / .svg unless --format says what to write. */
function renderFormat(format: string | undefined, out: string | undefined): RenderFormat {
  const ext = out && out !== '-' ? extname(out).slice(1).toLowerCase() : '';
  const fromExt = (RENDER_FORMATS as readonly string[]).includes(ext) ? (ext as RenderFormat) : undefined;
  if (format !== undefined && fromExt && format !== fromExt) {
    throw usageError(`--format ${format} does not match the file name ${out}`, { hint: `Drop --format (the extension decides) or name the file .${format}.` });
  }
  if (format === undefined && out && out !== '-' && !fromExt) {
    throw usageError(`-o ${out}: expected a file name ending in .png or .svg (the image formats render writes)`, { hint: `Name the file .png or .svg, or pass --format png|svg to write that format under this name.` });
  }
  return (format as RenderFormat | undefined) ?? fromExt ?? 'png';
}

/** --render <file> of a mutating command: a .png or .svg file (the format comes from the extension). */
function renderTarget(v: string): string {
  if (v === '-' || !/\.(png|svg)$/i.test(v)) throw new InvalidArgumentError('expected a file name ending in .png or .svg (the image of the result; the XML or the report owns stdout)');
  return v;
}

/** Thousands with commas (1,856). */
const thousands = (v: number): string => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Comma-separated ids; the option may repeat (--highlight A,B --highlight C). */
function collectIds(v: string, prev: string[] | undefined): string[] {
  return [...(prev ?? []), ...(splitList(v) ?? [])];
}

/** One written image of a render (a tile: its columns / band). */
interface ShotImage {
  out: string;
  width: number;
  height: number;
  tokens: number;
  columns?: [number, number];
  band?: number;
}

/** What `render` (and `--render` of a mutating command) wrote and found. */
interface Shot {
  out: string;
  format: RenderFormat;
  width: number;
  height: number;
  tokens: number;
  scale: number;
  plane: string;
  planes: string[];
  notes: string[];
  problems: RenderProblem[];
  nodes?: string[];
  /** with tiles: every image written */
  images?: ShotImage[];
}

/**
 * Renders `xml` and writes the image: to `out`, to stdout (`-`), else to
 * bpmn-cli/<stem>.<format> in the temp directory; tiles get -1, -2, ...
 * before the extension.
 */
async function writeRender(xml: string, opts: RenderOptions, format: RenderFormat, out: string | undefined, stem: string): Promise<Shot> {
  let parts: Array<{ bytes: string | Uint8Array; width: number; height: number; tokens: number; columns?: [number, number]; band?: number }>;
  let r: { scale: number; plane: string; planes: string[]; notes: string[]; problems: RenderProblem[]; nodes?: string[] };
  if (format === 'svg') {
    const svg = await renderSvg(xml, opts);
    parts = (svg.tiles ?? [svg]).map((t) => ({ bytes: t.svg, width: t.width, height: t.height, tokens: t.tokens, ...('columns' in t && t.columns ? { columns: t.columns } : {}), ...('band' in t && t.band ? { band: t.band } : {}) }));
    r = svg;
  } else {
    const png = await renderPng(xml, opts);
    parts = png.images.map((i) => ({ bytes: i.png, width: i.width, height: i.height, tokens: i.tokens, ...(i.columns ? { columns: i.columns } : {}), ...(i.band ? { band: i.band } : {}) }));
    r = png;
  }
  const images: ShotImage[] = [];
  if (out === '-') {
    process.stdout.write(parts[0]!.bytes);
    images.push({ out: '-', width: parts[0]!.width, height: parts[0]!.height, tokens: parts[0]!.tokens });
  } else {
    const target = out ?? join(tmpdir(), 'bpmn-cli', `${stem}.${format}`);
    const ext = extname(target);
    for (const [i, p] of parts.entries()) {
      const file = parts.length > 1 ? `${target.slice(0, target.length - ext.length)}-${i + 1}${ext}` : target;
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, p.bytes);
      } catch (err) {
        throw ioError('E_IO', `Cannot write ${file}: ${(err as Error).message}`, { file, hint: 'Pass -o <file> in a writable directory.' });
      }
      images.push({ out: file, width: p.width, height: p.height, tokens: p.tokens, ...(p.columns ? { columns: p.columns } : {}), ...(p.band ? { band: p.band } : {}) });
    }
  }
  const first = images[0]!;
  return {
    out: first.out,
    format,
    width: first.width,
    height: first.height,
    tokens: first.tokens,
    scale: r.scale,
    plane: r.plane,
    planes: r.planes,
    notes: r.notes,
    problems: r.problems,
    ...(r.nodes ? { nodes: r.nodes } : {}),
    ...(images.length > 1 ? { images } : {}),
  };
}

/** The text of a render: one `wrote` line per image, then the crop, the halos, the numbered problems, the planes and the notes. */
function renderShotLines(shot: Shot, extra: { crop?: string; halos?: string; problems?: string } = {}): string[] {
  const images = shot.images ?? [{ out: shot.out, width: shot.width, height: shot.height, tokens: shot.tokens }];
  const lines = images.map((im, i) => {
    const tile = images.length > 1 ? `  tile ${i + 1}/${images.length}${im.columns ? ` c${im.columns[0]}-c${im.columns[1]}` : ''}${im.band ? ` band ${im.band}` : ''}` : '';
    return `wrote ${im.out === '-' ? '<stdout>' : im.out}  ${im.width}x${im.height} px  ~${thousands(im.tokens)} image tokens  scale ${scaleText(shot.scale)}  plane ${shot.plane}${tile}`;
  });
  if (images.length > 1) lines.push(`${images.length} tiles, ~${thousands(images.reduce((s, im) => s + im.tokens, 0))} image tokens in all`);
  if (extra.crop) lines.push(`crop: ${extra.crop}: ${shot.nodes?.length ?? 0} node${shot.nodes?.length === 1 ? '' : 's'}`);
  if (extra.halos) lines.push(`halos: ${extra.halos}`);
  if (extra.problems !== undefined) {
    if (!shot.problems.length) lines.push(`${extra.problems}: none`);
    else {
      lines.push(`${extra.problems} (numbered in the image):`);
      for (const p of shot.problems) {
        const where = !p.drawn ? '  (not in the image)' : p.tile ? `  (tile ${p.tile})` : '';
        lines.push(`  ${p.n} ${p.kind} [${p.ids.join(', ')}]${p.detail ? ` ${p.detail}` : ''}${where}`);
      }
    }
  }
  if (shot.planes.length) lines.push(`other planes (--plane <id>): ${shot.planes.join(', ')}`);
  for (const note of shot.notes) lines.push(`note: ${note}`);
  return lines;
}

/** The halo legend of a highlight: the colour names of HALO_COLORS. */
function haloLegend(h: RenderHighlight): string | undefined {
  const names: Record<keyof RenderHighlight, string> = { created: 'green', changed: 'orange', moved: 'blue' };
  const parts = (['created', 'changed', 'moved'] as const).filter((k) => h[k]?.length).map((k) => `${names[k]} ${k}`);
  return parts.length ? parts.join(', ') : undefined;
}

/** `--render <file>` of a mutating command: the result drawn with what the change touched and the problems it added; a render failure is reported, the mutation stands. */
async function renderMutationResult(xml: string, report: MutationReport, target: string): Promise<{ shot?: Shot; lines: string[]; json: Record<string, unknown> }> {
  const highlight = changeHighlight(report);
  const touched = [...highlight.created, ...highlight.changed, ...highlight.moved];
  const opts: RenderOptions = { maxSize: RENDER_MAX_SIZE, highlight, problems: report.layout.metrics?.added ?? [], ...(touched.length ? { focus: touched } : {}) };
  try {
    const shot = await writeRender(xml, opts, renderFormat(undefined, target), target, 'result');
    const halos = haloLegend(highlight);
    const lines = renderShotLines(shot, { ...(halos ? { halos } : {}), problems: 'layout problems the change added' });
    return { shot, lines: [`render: ${lines[0]!}`, ...lines.slice(1).map((l) => `  ${l}`)], json: { ...shot } };
  } catch (err) {
    if (!isCliError(err)) throw err;
    return { lines: [`render: failed ${err.code}: ${err.message}${err.details.hint ? `  (${String(err.details.hint)})` : ''}`], json: { error: err.toJSON() } };
  }
}

withJsonOptions(
  program
    .command('render <file> [ids...]')
    .description('draw the diagram as an image to look at (PNG, or SVG; no browser): the whole plane or a crop (ids, --around, --path, --scope), with halos and numbered layout problems; prints the size, the image tokens and the other planes (file - = stdin)')
    .option('-o, --out <file>', 'the image file, .png or .svg (another name needs --format; - = stdout); default: bpmn-cli/<name>.png in the temp directory; tiles: <name>-1.png, <name>-2.png, ...')
    .option('--format <format>', 'png (default) or svg; default: the -o extension', (v: string) => {
      if (!(RENDER_FORMATS as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${RENDER_FORMATS.join(' or ')}`);
      return v;
    })
    .option('--plane <id>', 'draw the plane of this collapsed sub-process (or process / collaboration); default: the first diagram, or the crop\'s')
    .option('--around <id>', 'crop: exactly the nodes of `show --around <id>` (--depth flow steps both ways) with their flows, data and annotations')
    .option('--depth <n>', 'with --around: flow steps (default 2)', depthArg)
    .option('--inner', 'with --around: also enter sub-processes from outside')
    .option('--path <ids...>', 'crop: the nodes and flows of the shortest sequence-flow path <fromId> <toId>')
    .option('--via <flowIds...>', 'with --path: flows the path must pass, in order')
    .option('--scope <id>', 'crop: a pool, lane or sub-process and what is drawn inside it')
    .option('--highlight <ids>', 'a halo around these elements (comma-separated; repeatable)', collectIds)
    .option('--problems', 'number the layout problems (`bpmn metrics`; with a crop: those of its elements) in the image and list them')
    .option('--tiles', 'when the image would be unreadable (labels below 0.75): split it at the diagram columns into readable tiles')
    .option('--max-size <px>', `the longest edge in px (default ${RENDER_MAX_SIZE}); a larger drawing is scaled down`, boundedNumber('px', 50, 20000, true))
    .option('--scale <n>', 'zoom factor (default 1); the image still stays within --max-size', boundedNumber('zoom', 0.05, 10, false)),
).action(async (file: string, ids: string[], o: RawOpts) => {
  const json = !!o['json'];
  await run(async () => {
    const out = o['out'] as string | undefined;
    const format = renderFormat(o['format'] as string | undefined, out);
    if (out === '-' && format === 'png' && process.stdout.isTTY) {
      throw usageError('a PNG is binary and does not go to a terminal', { hint: 'Redirect it (`bpmn render <file> -o - > out.png`), pass -o <file>, or use --format svg.' });
    }
    if (out === '-' && o['tiles']) throw usageError('--tiles writes several images; they do not go to stdout', { hint: 'Pass -o <file.png> (the tiles become <file>-1.png, <file>-2.png, ...).' });
    const around = o['around'] as string | undefined;
    if (around === undefined && (o['depth'] !== undefined || o['inner'])) throw usageError(`${o['depth'] !== undefined ? '--depth' : '--inner'} goes only with --around <id>`, { hint: 'Use `bpmn render <file> --around <id> --depth <n>`.' });
    const path = o['path'] as string[] | undefined;
    if (path && path.length !== 2) throw usageError(`--path takes exactly two ids (from and to), got ${path.length}`, { hint: 'Put element ids before --path, or end the list with --: `bpmn render f.bpmn --path Event_Start Event_Done -o path.png`.' });
    const via = o['via'] as string[] | undefined;
    if (via && !path) throw usageError('--via needs --path', { hint: 'Example: --path Event_Start Event_Done --via Flow_Yes.' });
    const highlight = o['highlight'] as string[] | undefined;
    const opts: RenderOptions = {
      maxSize: (o['maxSize'] as number | undefined) ?? RENDER_MAX_SIZE,
      ...(o['scale'] !== undefined ? { scale: o['scale'] as number } : {}),
      ...(o['plane'] !== undefined ? { plane: String(o['plane']) } : {}),
      ...(around !== undefined ? { around: { id: around, ...(o['depth'] !== undefined ? { depth: o['depth'] as number } : {}), ...(o['inner'] ? { inner: true } : {}) } } : {}),
      ...(path ? { path: { from: path[0]!, to: path[1]!, ...(via ? { via } : {}) } } : {}),
      ...(o['scope'] !== undefined ? { scope: String(o['scope']) } : {}),
      ...(ids.length ? { ids } : {}),
      ...(highlight?.length ? { highlight } : {}),
      ...(o['problems'] ? { problems: true } : {}),
      ...(o['tiles'] ? { tiles: true } : {}),
    };
    const crop =
      around !== undefined
        ? `around ${around} (depth ${(o['depth'] as number | undefined) ?? AROUND_DEFAULT_DEPTH}${o['inner'] ? ', inner' : ''})`
        : path
          ? `path ${path[0]} -> ${path[1]}${via ? ` via ${via.join(', ')}` : ''}`
          : o['scope'] !== undefined
            ? `scope ${String(o['scope'])}`
            : ids.length
              ? `${ids.length} id${ids.length > 1 ? 's' : ''}`
              : undefined;
    const xml = file === '-' ? decodeXmlBytes(await readStdin('the model'), 'stdin') : await readXml(file);
    const stem = file === '-' ? 'stdin' : basename(file).replace(/\.(bpmn|xml)$/i, '');
    const shot = await writeRender(xml, opts, format, out, stem);
    const report = out === '-' ? process.stderr : process.stdout;
    if (json) {
      printJson({ file, ...shot }, !!o['pretty'], report);
      return;
    }
    const halos = highlight?.length ? 'orange --highlight' : undefined;
    print(renderShotLines(shot, { ...(crop ? { crop } : {}), ...(halos ? { halos } : {}), ...(o['problems'] ? { problems: 'problems' } : {}) }).join('\n'), report);
  }, json);
});

/* apply -------------------------------------------------------------- */
withMutationOptions(
  program.command('apply <file> [ops]').description('apply a JSON list of operations in one transaction (ops file or - for stdin; file - = the model from stdin, the result to stdout)'),
).action(async (file: string, opsFile: string | undefined, o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    let text: string;
    if (!opsFile || opsFile === '-') {
      if (file === '-') throw usageError('the model and the ops cannot both come from stdin', { hint: 'Pass the ops as a file: `bpmn apply - ops.json < model.bpmn` (or the model as a file: `bpmn apply model.bpmn - < ops.json`).' });
      text = (await readStdin('the ops')).toString('utf8');
    } else {
      try {
        text = await readFile(opsFile, 'utf8');
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        throw ioError(e.code === 'ENOENT' ? 'E_FILE_NOT_FOUND' : 'E_IO', `Cannot read ops file ${opsFile}: ${e.message}`, {
          file: opsFile,
          hint: 'Pass the path of a JSON ops file, or `-` to read the ops from stdin.',
        });
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new CliError('E_USAGE', `Ops are not valid JSON: ${(err as Error).message}`, 'usage');
    }
    const ops: Op[] = parseOps(parsed);
    await mutateArg(file, ops, opts);
  }, opts.json);
});

/* validate ----------------------------------------------------------- */
withLintOptions(
  withJsonOptions(
    program
      .command('validate <file>')
      .description("structural validation, lint, the engine profile (Camunda 7 / 8), the project's .bpmnlintrc and a layout dry run (nothing is written; file - = stdin)"),
  )
    .option('--strict', 'exit with code 5 when there are warnings')
    .option('--platform <platform>', 'engine profile: auto (default: detected from modeler:executionPlatform / the vendor namespace), c7, c8 or none', (v: string) => {
      if (!(PLATFORM_CHOICES as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${PLATFORM_CHOICES.join(', ')}`);
      return v;
    }),
)
  .action(async (file: string, o: RawOpts) => {
    await run(async () => {
      const checkOpts = { platform: (o['platform'] as PlatformChoice | undefined) ?? 'auto', ...lintOptions(o) };
      const report = validationReport(file === '-' ? await checkLoadedDoc(await readDocArg(file), checkOpts) : await checkFile(file, checkOpts));
      if (o['json']) {
        const { ok, ...rest } = report;
        printJson({ ok, file, ...rest }, !!o['pretty']);
      } else {
        print(renderValidation(report));
      }
      // exit codes through process.exitCode: process.exit would cut off a large report in a pipe
      if (report.errors.length) process.exitCode = 2;
      // content the reader could not keep (duplicate elements, unknown elements, ...) fails --strict like a warning
      else if (o['strict'] && (report.warnings.length || report.importWarnings.length)) process.exitCode = 5;
    }, !!o['json']);
  });

/* layout ------------------------------------------------------------- */
withMutationOptions(
  program
    .command('layout <file>')
    .description('redraw the diagram (DI) from the semantic model; --tidy keeps the drawing and only removes overlaps')
    .option('--expand <ids>', 'comma-separated sub-process ids to expand')
    .option('--collapse <ids>', 'comma-separated sub-process ids to collapse')
    .option('--tidy', 'keep the drawing: remove overlaps and gaps < 20 px with minimal moves (= bpmn tidy)'),
  { layoutToggle: false },
).action(async (file: string, o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    // the ids are validated like `set <id> expanded=`: unknown ids and non-sub-processes are errors, not silent no-ops
    const expand = splitList(o['expand'] as string | undefined);
    const collapse = splitList(o['collapse'] as string | undefined);
    const layoutOpts = { tidy: !!o['tidy'], ...(expand ? { expand } : {}), ...(collapse ? { collapse } : {}) };
    await runMutation(
      file,
      opts,
      (fo) => layoutFile(file, { ...fo, ...layoutOpts }),
      (doc, fo) => layoutDocToFile(doc, { ...fo, ...layoutOpts }),
    );
  }, opts.json);
});

/* kinds / guide ------------------------------------------------------ */
withJsonOptions(
  program
    .command('kinds')
    .description('element kinds, triggers, settable keys, ops schema and error codes')
    .option('--section <names>', `only these parts (comma-separated): ${KINDS_SECTION_NAMES}`),
).action(async (o: RawOpts) => {
  await run(async () => {
    const sections = o['section'] !== undefined ? kindsSections(String(o['section'])) : undefined;
    if (o['json']) printJson(sections ? kindsSectionJson(sections) : kindsJson(), !!o['pretty']);
    else print(sections ? kindsSectionText(sections) : kindsText());
  }, !!o['json']);
});

program
  .command('guide [topic]')
  .description('cheat sheet for AI agents (--short: the core in 5 KB; a topic: one section)')
  .option('--short', 'the core: contract, reading, ops keys, placement, top errors (at most 5 KB)')
  .action(async (topic: string | undefined, o: RawOpts) => {
    await run(async () => {
      if (topic !== undefined && o['short']) throw usageError('--short and a topic cannot be combined', { hint: 'Use `bpmn guide --short` or `bpmn guide <topic>`.' });
      print(o['short'] ? guideShort() : topic !== undefined ? guideTopic(topic) : guideText());
    });
  });

/** A word for the shell: as it is, or in double quotes. */
const shellWord = (s: string): string => (/^[A-Za-z0-9_.:\/=@$-]+$/.test(s) ? s : JSON.stringify(s));

/**
 * The command rewritten when an unknown option is one of its positional
 * arguments (`add --kind userTask --name X`: `add <file> userTask X`) or,
 * for a command that takes key=value pairs, a key (`set <id> --name X`:
 * `set <file> <id> name=X`); undefined for any other unknown option.
 */
export function positionalHint(root: CommandType, args: string[]): string | undefined {
  let cmd: CommandType | undefined = root;
  const path: string[] = [];
  let i = 0;
  // the (sub)command: ext add, ...
  while (i < args.length && !args[i]!.startsWith('-')) {
    const sub: CommandType | undefined = cmd.commands.find((c) => c.name() === args[i] || c.aliases().includes(args[i]!));
    if (!sub) break;
    cmd = sub;
    path.push(args[i]!);
    i++;
  }
  if (cmd === root || !cmd.registeredArguments.length) return undefined;
  const positional: string[] = [];
  const known: string[] = [];
  const unknown = new Map<string, string | undefined>();
  for (; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('-') || a === '-') {
      positional.push(a);
      continue;
    }
    const [flag, inline] = a.split(/=(.*)/s, 2) as [string, string | undefined];
    const opt = cmd.options.find((o) => o.long === flag || o.short === flag);
    if (opt) {
      known.push(a);
      if (inline === undefined && (opt.required || opt.optional) && args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) known.push(args[++i]!);
      continue;
    }
    const value = inline ?? (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-') ? args[++i] : undefined);
    unknown.set(flag.replace(/^-+/, ''), value);
  }
  // shell words of the rewritten command
  const out: string[] = [];
  const used: string[] = [];
  let pairs = 0;
  for (const arg of cmd.registeredArguments) {
    const name = arg.name();
    if (arg.variadic) {
      out.push(...positional.splice(0).map(shellWord));
      // key=value pairs (set, add): an unknown option with a value is a key
      for (const [k, v] of unknown) {
        if (used.includes(k) || v === undefined || !/keyValues/i.test(name)) continue;
        out.push(`${k}=${shellWord(v)}`);
        used.push(k);
        pairs++;
      }
      continue;
    }
    if (positional.length) out.push(shellWord(positional.shift()!));
    else if (unknown.has(name)) {
      out.push(shellWord(unknown.get(name) ?? `<${name}>`));
      used.push(name);
    } else if (arg.required) out.push(`<${name}>`);
  }
  if (!used.length) return undefined;
  const usage = cmd.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}${a.variadic ? '...' : ''}]`)).join(' ');
  const flags = used.map((u) => `--${u}`);
  const listed = flags.length > 1 ? `${flags.slice(0, -1).join(', ')} and ${flags[flags.length - 1]}` : flags[0]!;
  return `${listed} ${flags.length > 1 ? 'are not options' : 'is not an option'} of \`bpmn ${path.join(' ')}\` (${usage}): write ${flags.length > 1 ? 'them' : 'it'} as ${!pairs ? (flags.length > 1 ? 'arguments' : 'an argument') : pairs === flags.length ? (flags.length > 1 ? 'key=value pairs' : 'a key=value pair') : 'arguments and key=value pairs'}: \`bpmn ${[...path.map(shellWord), ...out, ...known.map(shellWord)].join(' ')}\`.`;
}

// a reader that closes early (`bpmn validate x.bpmn | head`) ends the output, not the command: no EPIPE trace, the exit code stays
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err;
  });
}

/**
 * The end of every command: exit with the code it set (process.exitCode)
 * once stdout and stderr took what was written. Not right away (that cut
 * off a pipe beyond 64 KB on macOS), and not when the event loop runs dry
 * (a timer a project plugin left would keep the process alive).
 */
function exitWhenWritten(): void {
  process.stdout.write('', () => process.stderr.write('', () => process.exit()));
}

program
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    const json = process.argv.includes('--json');
    if (err instanceof CommanderError) {
      // --help / --version / bare `bpmn`: commander printed what it wanted to
      if (['commander.helpDisplayed', 'commander.help', 'commander.version'].includes(err.code)) process.exit(err.exitCode);
      const message = err.message.replace(/^error:\s*/, '').replace(/\s*\n\s*/g, ' ').trim();
      const positional = err.code === 'commander.unknownOption' ? positionalHint(program, process.argv.slice(2)) : undefined;
      return printError(usageError(message, { hint: positional ?? 'Run `bpmn <command> --help` for the options, or `bpmn guide` for the agent cheat sheet.' }), json);
    }
    printError(err, json);
  })
  .then(exitWhenWritten);
