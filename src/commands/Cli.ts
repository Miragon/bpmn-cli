/**
 * `bpmn` command line interface.
 *
 * Every command works on one .bpmn file. Mutating commands run the pipeline
 * (load -> ops -> validate -> layout -> atomic write) and print what changed.
 * The file I/O is src/node/files.ts, everything else the browser-safe core;
 * the commands (one class each, in this folder) map flags to its options
 * (BPMN_KEEP_FLOW_IDS to keepFlowIds; a result the variable's kept flow ids
 * changed says so) and are the only ones that read the environment. Mutating
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
 *
 * Exit codes go to `exitCode` (src/cli.ts hands it to process.exitCode:
 * process.exit would cut off what a pipe has not taken yet, beyond 64 KB on macOS).
 */
import { Command, CommanderError, type Command as CommandType } from 'commander';
import { Doc } from '../model/Doc.js';
import { type Warning } from '../shared/CliError.js';
import { ioError, isCliError, usageError } from '../shared/utils/errors.js';
import { validatorTag } from '../report/utils/findings.js';
import { decodeXmlBytes } from '../node/utils/files.js';
import { ModelFile } from '../node/ModelFile.js';
import { AddCommand } from './AddCommand.js';
import { AlignCommand } from './AlignCommand.js';
import { ApplyCommand } from './ApplyCommand.js';
import { ColorCommand } from './ColorCommand.js';
import { CompactCommand } from './CompactCommand.js';
import { ConnectCommand } from './ConnectCommand.js';
import { ExtCommand } from './ExtCommand.js';
import { FindCommand } from './FindCommand.js';
import { GuideCommand } from './GuideCommand.js';
import { KindsCommand } from './KindsCommand.js';
import { LabelCommand } from './LabelCommand.js';
import { LayoutCommand } from './LayoutCommand.js';
import { MetricsCommand } from './MetricsCommand.js';
import { MoveCommand } from './MoveCommand.js';
import { NewCommand } from './NewCommand.js';
import { OrderCommand } from './OrderCommand.js';
import { PlaceCommand } from './PlaceCommand.js';
import { PositionalHint } from './PositionalHint.js';
import { RemoveCommand } from './RemoveCommand.js';
import { RenderCommand } from './RenderCommand.js';
import { RetypeCommand } from './RetypeCommand.js';
import { RouteCommand } from './RouteCommand.js';
import { SetCommand } from './SetCommand.js';
import { ShowCommand } from './ShowCommand.js';
import { SpaceCommand } from './SpaceCommand.js';
import { TidyCommand } from './TidyCommand.js';
import { ValidateCommand } from './ValidateCommand.js';

export type CliStream = Pick<NodeJS.WriteStream, 'write'> & { readonly isTTY?: boolean };

export interface CliIo {
  stdout: CliStream;
  stderr: CliStream;
  readonly stdin: AsyncIterable<Buffer | string>;
  env: NodeJS.ProcessEnv;
}

const PROCESS_IO: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
  get stdin() {
    return process.stdin;
  },
  env: process.env,
};

export class Cli {
  readonly program: CommandType;
  exitCode: number | undefined;
  private stdinUsed: string | undefined;

  constructor(
    version: string,
    readonly io: CliIo = PROCESS_IO,
  ) {
    this.program = new Command()
      .name('bpmn')
      .description('Edit BPMN 2.0 models semantically; the diagram is laid out automatically (bpmn.io).')
      .version(version)
      // parser errors (unknown command / option, missing argument) are rendered by printError like every other error
      .exitOverride()
      .configureOutput({ writeOut: (s) => io.stdout.write(s), writeErr: (s) => io.stderr.write(s), outputError: () => undefined });
    const commands = [
      NewCommand,
      ShowCommand,
      FindCommand,
      AddCommand,
      ConnectCommand,
      SetCommand,
      RemoveCommand,
      RetypeCommand,
      MoveCommand,
      OrderCommand,
      ExtCommand,
      PlaceCommand,
      AlignCommand,
      ColorCommand,
      LabelCommand,
      RouteCommand,
      SpaceCommand,
      TidyCommand,
      CompactCommand,
      MetricsCommand,
      RenderCommand,
      ApplyCommand,
      ValidateCommand,
      LayoutCommand,
      KindsCommand,
      GuideCommand,
    ];
    for (const command of commands) new command(this).register(this.program);
  }

  async run(argv: string[]): Promise<void> {
    try {
      await this.program.parseAsync(argv);
    } catch (err: unknown) {
      const json = argv.includes('--json');
      if (err instanceof CommanderError) {
        // --help / --version / bare `bpmn`: commander printed what it wanted to
        if (['commander.helpDisplayed', 'commander.help', 'commander.version'].includes(err.code)) {
          this.exitCode = err.exitCode;
          return;
        }
        const message = err.message.replace(/^error:\s*/, '').replace(/\s*\n\s*/g, ' ').trim();
        const positional = err.code === 'commander.unknownOption' ? new PositionalHint(this.program).of(argv.slice(2)) : undefined;
        this.printError(usageError(message, { hint: positional ?? 'Run `bpmn <command> --help` for the options, or `bpmn guide` for the agent cheat sheet.' }), json);
        return;
      }
      this.printError(err, json);
    }
  }

  async guarded(fn: () => Promise<void>, json?: boolean): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.printError(err, json);
    }
  }

  print(text: string, out: CliStream = this.io.stdout): void {
    out.write(text.endsWith('\n') ? text : `${text}\n`);
  }

  /** JSON on one line (tokens), indented with --pretty. */
  printJson(value: unknown, pretty?: boolean, out: CliStream = this.io.stdout): void {
    out.write(`${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`);
  }

  /**
   * The whole of stdin (the caller decodes it like a file); stdin can feed one
   * input per call. Read as a stream: once anything touched process.stdin (an
   * import of node:process does), a pipe is non-blocking, and a synchronous
   * read fails with EAGAIN while its writer is slower than bpmn-cli's start
   * (`curl ... | bpmn validate -`).
   */
  async readStdin(what: string): Promise<Buffer> {
    if (this.stdinUsed) throw usageError(`stdin already holds ${this.stdinUsed}; it cannot also hold ${what}`, { hint: 'Read one of them from a file, e.g. `bpmn apply - ops.json < model.bpmn`.' });
    this.stdinUsed = what;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of this.io.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return Buffer.concat(chunks);
    } catch (err) {
      throw ioError('E_IO', `Cannot read ${what} from stdin: ${(err as Error).message}`, { hint: 'Pipe the input in, e.g. `cat model.bpmn | bpmn show -`.' });
    }
  }

  /** The document of a file argument: `-` reads it from stdin (it then has no file name). */
  async readDocArg(file: string): Promise<Doc> {
    if (file !== '-') return new ModelFile(file).read();
    return Doc.fromXml(decodeXmlBytes(await this.readStdin('the model'), 'stdin'));
  }

  /** The error on stderr; the exit code is set, the command ends (guarded() is the last step of every action). */
  printError(err: unknown, json: boolean | undefined): void {
    const stderr = this.io.stderr;
    if (isCliError(err)) {
      if (json) {
        stderr.write(`${JSON.stringify({ ok: false, error: err.toJSON() })}\n`);
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
        stderr.write(`${lines.join('\n')}\n`);
      }
      this.exitCode = err.exitCode;
      return;
    }
    const e = err as Error;
    if (json) stderr.write(`${JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', message: e.message } })}\n`);
    else stderr.write(`error E_INTERNAL: ${e.message}\n${this.io.env['BPMN_DEBUG'] ? (e.stack ?? '') : ''}\n`);
    this.exitCode = 70;
  }
}
