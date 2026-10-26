import { Command, CommanderError, type Command as CommandType } from 'commander';
import { Doc } from '../../../domain/document/Doc.js';
import { type Warning } from '../../../domain/document/CliError.js';
import { ioError, isCliError, usageError } from '../../../domain/document/utils/errors.js';
import { validatorTag } from '../report/utils/findings.js';
import type { EditDocumentUseCase } from '../../../application/port/in/EditDocumentUseCase.js';
import type { CreateDocumentUseCase } from '../../../application/port/in/CreateDocumentUseCase.js';
import type { RelayoutDiagramUseCase } from '../../../application/port/in/RelayoutDiagramUseCase.js';
import type { ValidateDocumentUseCase } from '../../../application/port/in/ValidateDocumentUseCase.js';
import type { ReadDocumentUseCase } from '../../../application/port/in/ReadDocumentUseCase.js';
import type { ShowModelUseCase } from '../../../application/port/in/ShowModelUseCase.js';
import type { ShowConventionsUseCase } from '../../../application/port/in/ShowConventionsUseCase.js';
import type { FindElementsUseCase } from '../../../application/port/in/FindElementsUseCase.js';
import type { RenderDiagramUseCase } from '../../../application/port/in/RenderDiagramUseCase.js';
import { AddElementCommand } from './AddElementCommand.js';
import { AlignCommand } from './AlignCommand.js';
import { ApplyOpsCommand } from './ApplyOpsCommand.js';
import { ColorCommand } from './ColorCommand.js';
import { CompactCommand } from './CompactCommand.js';
import { ConnectCommand } from './ConnectCommand.js';
import { ExtensionElementsCommand } from './ExtensionElementsCommand.js';
import { FindCommand } from './FindCommand.js';
import { GuideCommand } from './GuideCommand.js';
import { InsertSpaceCommand } from './InsertSpaceCommand.js';
import { KindsReferenceCommand } from './KindsReferenceCommand.js';
import { LabelSideCommand } from './LabelSideCommand.js';
import { LayoutCommand } from './LayoutCommand.js';
import { LayoutMetricsCommand } from './LayoutMetricsCommand.js';
import { MoveCommand } from './MoveCommand.js';
import { NewFileCommand } from './NewFileCommand.js';
import { PlaceCommand } from './PlaceCommand.js';
import { PositionalHint } from './PositionalHint.js';
import { RemoveElementsCommand } from './RemoveElementsCommand.js';
import { RenderCommand } from './RenderCommand.js';
import { ReorderCommand } from './ReorderCommand.js';
import { RetypeCommand } from './RetypeCommand.js';
import { RouteCommand } from './RouteCommand.js';
import { SetPropertiesCommand } from './SetPropertiesCommand.js';
import { ShowCommand } from './ShowCommand.js';
import { TidyCommand } from './TidyCommand.js';
import { ValidateCommand } from './ValidateCommand.js';

export type CliStream = Pick<NodeJS.WriteStream, 'write'> & { readonly isTTY?: boolean };

export interface CliIo {
  stdout: CliStream;
  stderr: CliStream;
  readonly stdin: AsyncIterable<Buffer | string>;
  env: NodeJS.ProcessEnv;
}

/** The use cases the commands run; cli.ts wires them to the file system. */
export interface CliUseCases {
  edit: EditDocumentUseCase;
  create: CreateDocumentUseCase;
  relayout: RelayoutDiagramUseCase;
  validate: ValidateDocumentUseCase;
  read: ReadDocumentUseCase;
  showModel: ShowModelUseCase;
  showConventions: ShowConventionsUseCase;
  findElements: FindElementsUseCase;
  render: RenderDiagramUseCase;
}

const PROCESS_IO: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
  get stdin() {
    return process.stdin;
  },
  env: process.env,
};

/**
 * The `bpmn` command line interface: 
 * registers every command and owns the streams,
 * stdin, error output and the exit code.
 */
export class Cli {
  readonly program: CommandType;
  /**
   * Handed to process.exitCode: process.exit would cut off what a pipe
   * has not taken yet (beyond 64 KB on macOS).
   */
  exitCode: number | undefined;
  private stdinUsed: string | undefined;

  constructor(
    version: string,
    readonly useCases: CliUseCases,
    readonly io: CliIo = PROCESS_IO,
  ) {
    this.program = new Command()
      .name('bpmn')
      .description('Edit BPMN 2.0 models semantically; the diagram is laid out automatically (bpmn.io).')
      .version(version)
      // parser errors (unknown command / option, missing argument) go through printError too
      .exitOverride()
      .configureOutput({ writeOut: (text) => io.stdout.write(text), writeErr: (text) => io.stderr.write(text), outputError: () => undefined });
    const commands = [
      NewFileCommand,
      ShowCommand,
      FindCommand,
      AddElementCommand,
      ConnectCommand,
      SetPropertiesCommand,
      RemoveElementsCommand,
      RetypeCommand,
      MoveCommand,
      ReorderCommand,
      ExtensionElementsCommand,
      PlaceCommand,
      AlignCommand,
      ColorCommand,
      LabelSideCommand,
      RouteCommand,
      InsertSpaceCommand,
      TidyCommand,
      CompactCommand,
      LayoutMetricsCommand,
      RenderCommand,
      ApplyOpsCommand,
      ValidateCommand,
      LayoutCommand,
      KindsReferenceCommand,
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
   * Read as a stream: once anything touched process.stdin, a pipe is non-blocking
   * and a synchronous read fails with EAGAIN while its writer is slower than our start.
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

  /** `-` reads the model from stdin (it then has no file name). */
  async readDocArg(file: string): Promise<Doc> {
    const source = file === '-' ? { bytes: await this.readStdin('the model'), name: 'stdin' } : { file };
    return this.useCases.read.read({ source });
  }

  /** Writes the error to stderr and sets the exit code. */
  printError(err: unknown, json: boolean | undefined): void {
    const stderr = this.io.stderr;
    if (isCliError(err)) {
      if (json) {
        stderr.write(`${JSON.stringify({ ok: false, error: err.toJSON() })}\n`);
      } else {
        const lines = [`error ${err.code}: ${err.message}`];
        const details = err.details;
        if (details.element) lines.push(`  element: ${String(details.element)}`);
        if (Array.isArray(details.related) && details.related.length) lines.push(`  related: ${details.related.join(', ')}`);
        if (Array.isArray(details.candidates) && details.candidates.length) lines.push(`  candidates: ${details.candidates.join(', ')}`);
        if (Array.isArray(details.errors)) for (const issue of details.errors as Warning[]) lines.push(`  ${validatorTag(issue)}${issue.code}${issue.element ? ` ${issue.element}` : ''}: ${issue.message}${issue.hint ? `  (${issue.hint})` : ''}`);
        if (Array.isArray(details.warnings)) for (const warning of details.warnings as string[]) lines.push(`  ${warning}`);
        if (details.op !== undefined) lines.push(`  op: #${String(details.op)}`);
        if (details.hint) lines.push(`  hint: ${String(details.hint)}`);
        stderr.write(`${lines.join('\n')}\n`);
      }
      this.exitCode = err.exitCode;
      return;
    }
    const error = err as Error;
    if (json) stderr.write(`${JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', message: error.message } })}\n`);
    else stderr.write(`error E_INTERNAL: ${error.message}\n${this.io.env['BPMN_DEBUG'] ? (error.stack ?? '') : ''}\n`);
    this.exitCode = 70;
  }
}
