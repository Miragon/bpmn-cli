#!/usr/bin/env node
/**
 * `bpmn` command line interface.
 *
 * Every command works on one .bpmn file. Mutating commands run the pipeline
 * (load -> ops -> validate -> layout -> atomic write) and print what changed.
 * The file I/O is src/node/files.ts, everything else the browser-safe core;
 * this module maps flags to its options (BPMN_LAYOUT_DEBUG to setLayoutDebug).
 *
 * `-` as the file reads the model from stdin; a mutating command then writes
 * its result to stdout (unless -o names a file), and `-o -` writes any
 * result to stdout. With the XML on stdout the report goes to stderr.
 * --json prints compact JSON (--pretty indents it).
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Command, CommanderError, type Command as CommandType, InvalidArgumentError, Option } from 'commander';
import { COLOR_VALUES, LABEL_SIDE_VALUES, parseOps, SIDE_VALUES } from './batch.js';
import { setLayoutDebug } from './debug.js';
import { layoutProblems } from './diagram/metrics.js';
import { renderShown, viewDoc, type ViewOptions } from './api.js';
import { assertTarget, Doc } from './document.js';
import { CliError, ioError, isCliError, usageError, type Warning } from './errors.js';
import { renderExtensionList, renderFind, renderMetrics, renderView } from './format.js';
import { guideShort, guideText, guideTopic, KINDS_SECTION_NAMES, kindsJson, kindsSectionJson, kindsSectionText, kindsSections, kindsText } from './guide.js';
import { assertKindToken } from './kinds.js';
import { checkFile, decodeXmlBytes, layoutDocToFile, layoutFile, mutateDocToFile, mutateFile, readDoc, type FileMutationOptions } from './node/files.js';
import { listAllExtensions } from './ops/ext.js';
import type { AddOp, AlignOp, ColorOp, CompactOp, ConnectOp, ExtOp, LabelOp, MoveOp, Op, OrderOp, PlaceOp, RemoveOp, RetypeOp, RouteOp, SetOp, SpaceOp, TidyOp, TriggerOptions } from './ops/types.js';
import { assertLossless, checkDoc, LAYOUT_MODES, type LayoutMode, type MutationResult } from './pipeline.js';
import { PLATFORM_CHOICES, type PlatformChoice } from './platform/profile.js';
import { PROFILE_CHOICES, type ProfileChoice } from './platform/repo.js';
import { mutationReport, mutationSummary, mutationWarnings, renderMutation, renderSummary, renderValidation, validationReport, validatorTag } from './report.js';
import { findElements } from './view.js';

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
}

type Out = NodeJS.WriteStream;

function print(text: string, out: Out = process.stdout): void {
  out.write(text.endsWith('\n') ? text : `${text}\n`);
}

/** JSON on one line (tokens), indented with --pretty. */
function printJson(value: unknown, pretty?: boolean, out: Out = process.stdout): void {
  out.write(`${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`);
}

/** The result of a mutation (src/report.ts: the same for the CLI and the in-memory API); --strict exits 5 on any warning. */
function printMutation(result: MutationResult, opts: OutputOptions & { show?: boolean; dryRun?: boolean }, out: Out = process.stdout): void {
  const report = mutationReport(result);
  if (opts.summary) {
    const summary = mutationSummary(report);
    if (opts.json) printJson(report.view ? { ...summary, view: report.view } : summary, opts.pretty, out);
    else print(renderSummary(summary, { dryRun: opts.dryRun }) + (report.view ? `\n\n${renderView(report.view)}` : ''), out);
  } else if (opts.json) printJson(report, opts.pretty, out);
  else print(renderMutation(report, { dryRun: opts.dryRun }), out);
  if (opts.strict && mutationWarnings(result).length) process.exit(5);
}

/* ------------------------------------------------------------------ */
/* stdin / stdout                                                       */
/* ------------------------------------------------------------------ */

let stdinUsed: string | undefined;

/** The whole of stdin as text (decoded like a file); stdin can feed one input per call. */
function readStdin(what: string): Buffer {
  if (stdinUsed) throw usageError(`stdin already holds ${stdinUsed}; it cannot also hold ${what}`, { hint: 'Read one of them from a file, e.g. `bpmn apply - ops.json < model.bpmn`.' });
  stdinUsed = what;
  try {
    return readFileSync(0);
  } catch (err) {
    throw ioError('E_IO', `Cannot read ${what} from stdin: ${(err as Error).message}`, { hint: 'Pipe the input in, e.g. `cat model.bpmn | bpmn show -`.' });
  }
}

/** The document of a file argument: `-` reads it from stdin (it then has no file name). */
async function readDocArg(file: string): Promise<Doc> {
  if (file !== '-') return readDoc(file);
  return Doc.fromXml(decodeXmlBytes(readStdin('the model'), 'stdin'));
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
  printMutation(result, opts, xmlOut ? process.stderr : process.stdout);
}

/** A mutation of ops on `file` (`-`: stdin), see runMutation. */
async function mutateArg(file: string, ops: Op[], opts: FileMutationOptions & OutputOptions): Promise<void> {
  await runMutation(
    file,
    opts,
    (o) => mutateFile(file, ops, o),
    (doc, o) => {
      assertLossless(doc, o);
      return mutateDocToFile(doc, ops, o);
    },
  );
}

function printError(err: unknown, json: boolean | undefined): never {
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
    process.exit(err.exitCode);
  }
  const e = err as Error;
  if (json) process.stderr.write(`${JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', message: e.message } })}\n`);
  else process.stderr.write(`error E_INTERNAL: ${e.message}\n${process.env['BPMN_DEBUG'] ? (e.stack ?? '') : ''}\n`);
  process.exit(70);
}

/* ------------------------------------------------------------------ */
/* option helpers                                                       */
/* ------------------------------------------------------------------ */

function profileArg(v: string): string {
  if (!(PROFILE_CHOICES as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${PROFILE_CHOICES.join(', ')}`);
  return v;
}

/** --json, and --pretty to indent it. */
function withJsonOptions(cmd: CommandType): CommandType {
  return cmd.option('--json', 'machine-readable output (compact JSON)').option('--pretty', 'with --json: indented JSON');
}

function withMutationOptions(cmd: CommandType, { layoutToggle = true } = {}): CommandType {
  withJsonOptions(cmd)
    .option('--summary', 'short result: created ids by kind, changed / removed ids, added warnings, one layout line')
    .option('-o, --out <file>', 'write to this file instead of the input file (- = stdout)')
    .option('--dry-run', 'run everything but do not write');
  if (layoutToggle) {
    cmd
      .option('--layout <mode>', 'auto (default): keep a hand-made diagram and place changes locally, redraw an engine-owned one; incremental: always keep; full: always redraw', (v: string) => {
        if (!(LAYOUT_MODES as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${LAYOUT_MODES.join(', ')}`);
        return v;
      })
      .option('--relayout', 'redraw the whole diagram (= --layout full)')
      .option('--no-layout', 'do not update the diagram (new elements get no shape; format operations still apply)');
  }
  return cmd
    .option('--profile <profile>', 'validation profile: auto (default: design for the models of a design-iq content repository, i.e. below a bpmiq.yml), design (the design-iq save gate: one start event, every node connected and in a lane, complete diagram) or none', profileArg)
    .option('--force', 'write despite a lossy import, new validation errors or content a retype would delete')
    .option('--backup', 'copy the input file to <file>.bak before writing')
    .option('--show', 'append the full model view to the result')
    .option('--strict', 'exit with code 5 when there are warnings')
    .option('--engine <engine>', 'layout engine: clean (default) or auto (bpmn-auto-layout)', (v: string) => {
      if (v !== 'clean' && v !== 'auto') throw new InvalidArgumentError('expected clean or auto');
      return v;
    });
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

function mutationOptions(o: RawOpts): FileMutationOptions & OutputOptions {
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
    ...(o['engine'] ? { engine: o['engine'] as 'clean' | 'auto' } : {}),
    ...(o['profile'] ? { profile: o['profile'] as ProfileChoice } : {}),
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

/* The same rules `apply` enforces on ops JSON (batch.ts), spelled with CLI flags. */

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
    .option('--id <processId>', 'process id (default: Process_<Name> or Process_1)')
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
    const doc = Doc.create(
      {
        processName: o['name'] as string | undefined,
        processId: o['id'] as string | undefined,
        executable: o['executable'] !== false,
        target: o['target'] as 'camunda8' | 'camunda7' | undefined,
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
    printMutation(result, opts, xmlOut ? process.stderr : process.stdout);
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
    .option('--layout', 'the drawing instead of the model: rows of node ids per pool / lane with their columns (c0..cN), wide gaps, colours, label sides, layout problems'),
).action(async (file: string, id: string | undefined, o: RawOpts) => {
  await run(async () => {
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
      .option('--members <ids>', 'lanes: comma-separated member node ids'),
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

/** --path <fromId> <toId> [--via <flowId...>], --kind <kind>, --branch <flowId> (src/diagram/select.ts). */
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
      .option('--before <id>', 'column: left of this element'),
    'move',
  ),
).action(async (file: string, ids: string[], o: RawOpts) => {
  await run(async () => {
    checkFlagGroups(o, [['rowOf', 'below', 'above'], ['columnOf', 'after', 'before']], 'place needs a row (--row-of, --below, --above) and/or a column (--column-of, --after, --before)');
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
    .description('diagram only: route a sequence / message flow again, optionally forcing the side it leaves and enters by')
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
    .option('--by <amount>', 'column (default for --after), row (default for --below) or pixels; -column, -row or -<px> closes that much empty space instead', (v: string) => {
      if (v === 'column' || v === 'row' || v === '-column' || v === '-row') return v;
      if (/^-?\d+$/.test(v) && Number(v) !== 0) return Number(v);
      throw new InvalidArgumentError('expected column, row or a number of pixels (negative: -column, -row, -<px> to close space)');
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

/* apply -------------------------------------------------------------- */
withMutationOptions(
  program.command('apply <file> [ops]').description('apply a JSON list of operations in one transaction (ops file or - for stdin; file - = the model from stdin, the result to stdout)'),
).action(async (file: string, opsFile: string | undefined, o: RawOpts) => {
  const opts = mutationOptions(o);
  await run(async () => {
    let text: string;
    if (!opsFile || opsFile === '-') {
      if (file === '-') throw usageError('the model and the ops cannot both come from stdin', { hint: 'Pass the ops as a file: `bpmn apply - ops.json < model.bpmn` (or the model as a file: `bpmn apply model.bpmn - < ops.json`).' });
      text = readStdin('the ops').toString('utf8');
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
withJsonOptions(
  program
    .command('validate <file>')
    .description('structural validation, lint, the engine profile (Camunda 7) and a layout dry run (nothing is written; file - = stdin)'),
)
  .option('--strict', 'exit with code 5 when there are warnings')
  .option('--platform <platform>', 'engine profile: auto (default: detected from modeler:executionPlatform / the vendor namespace), c7, c8 or none', (v: string) => {
    if (!(PLATFORM_CHOICES as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${PLATFORM_CHOICES.join(', ')}`);
    return v;
  })
  .option('--profile <profile>', 'validation profile: auto (default: design for the models of a design-iq content repository, i.e. below a bpmiq.yml), design (the design-iq save gate) or none', profileArg)
  .action(async (file: string, o: RawOpts) => {
    await run(async () => {
      const checkOpts = { platform: (o['platform'] as PlatformChoice | undefined) ?? 'auto', profile: (o['profile'] as ProfileChoice | undefined) ?? 'auto' };
      const report = validationReport(file === '-' ? await checkDoc(await readDocArg(file), checkOpts) : await checkFile(file, checkOpts));
      if (o['json']) {
        const { ok, ...rest } = report;
        printJson({ ok, file, ...rest }, !!o['pretty']);
      } else {
        print(renderValidation(report));
      }
      if (report.errors.length) process.exit(2);
      // content the reader could not keep (duplicate elements, unknown elements, ...) fails --strict like a warning
      if (o['strict'] && (report.warnings.length || report.importWarnings.length)) process.exit(5);
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

program.parseAsync(process.argv).catch((err: unknown) => {
  const json = process.argv.includes('--json');
  if (err instanceof CommanderError) {
    // --help / --version / bare `bpmn`: commander printed what it wanted to
    if (['commander.helpDisplayed', 'commander.help', 'commander.version'].includes(err.code)) process.exit(err.exitCode);
    const message = err.message.replace(/^error:\s*/, '').replace(/\s*\n\s*/g, ' ').trim();
    printError(usageError(message, { hint: 'Run `bpmn <command> --help` for the options, or `bpmn guide` for the agent cheat sheet.' }), json);
  }
  printError(err, json);
});
