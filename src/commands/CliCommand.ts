import type { Command as CommandType } from 'commander';
import type { FileMutationOptions } from '../node/files.js';
import { CommandCatalogue, type CommandSignature } from '../report/CommandCatalogue.js';
import type { Cli } from './Cli.js';

export interface RawOpts {
  [key: string]: unknown;
}

export abstract class CliCommand {
  protected static readonly catalogue = new CommandCatalogue();

  constructor(protected readonly cli: Cli) {}

  abstract register(program: CommandType): void;

  protected define(parent: CommandType, name: string): CommandType {
    return this.defineSignature(parent, CliCommand.catalogue.command(name));
  }

  protected defineSignature(parent: CommandType, doc: CommandSignature): CommandType {
    const cmd = parent.command(doc.arguments ? `${doc.name} ${doc.arguments}` : doc.name);
    for (const alias of doc.aliases ?? []) cmd.alias(alias);
    return cmd.description(doc.help);
  }

  /** --json, and --pretty to indent it. */
  protected withJsonOptions(cmd: CommandType): CommandType {
    return cmd.option(...CliCommand.catalogue.commonOption('--json')).option(...CliCommand.catalogue.commonOption('--pretty'));
  }

  /** --lint-config <path> / --no-lint-config (in this order, so that the default stays undefined, like --layout / --no-layout) */
  protected withLintOptions(cmd: CommandType): CommandType {
    return cmd.option(...CliCommand.catalogue.commonOption('--lint-config')).option(...CliCommand.catalogue.commonOption('--no-lint-config'));
  }

  /** --lint-config / --no-lint-config -> FileBpmnlintOptions: paths and stdin from the working directory, project plugins run */
  protected lintOptions(o: RawOpts): Pick<FileMutationOptions, 'lintConfig' | 'lintFrom' | 'lintProjectCode'> {
    const config = o['lintConfig'] as string | false | undefined;
    const cwd = config === false ? undefined : this.workingDir();
    return { ...(config !== undefined ? { lintConfig: config } : {}), ...(cwd !== undefined ? { lintFrom: cwd } : {}), lintProjectCode: true };
  }

  /** The working directory, or undefined when it was removed (a command on absolute paths still runs there). */
  private workingDir(): string | undefined {
    try {
      return process.cwd();
    } catch {
      return undefined;
    }
  }
}
