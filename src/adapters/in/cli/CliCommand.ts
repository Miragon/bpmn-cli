import type { Command as CommandType } from 'commander';
import type { FileMutationOptions } from '../../../application/port/in/EditDocumentUseCase.js';
import { CommandCatalogue, type CommandSignature } from '../report/CommandCatalogue.js';
import type { Cli } from './Cli.js';

export interface RawOpts {
  [key: string]: unknown;
}

/**
 * Base of every `bpmn` command: defines it from its CommandCatalogue entry
 * and maps the flags all commands share.
 */
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

  protected withJsonOptions(cmd: CommandType): CommandType {
    return cmd.option(...CliCommand.catalogue.commonOption('--json')).option(...CliCommand.catalogue.commonOption('--pretty'));
  }

  /** In this order, so that the default stays undefined (like --layout / --no-layout). */
  protected withLintOptions(cmd: CommandType): CommandType {
    return cmd.option(...CliCommand.catalogue.commonOption('--lint-config')).option(...CliCommand.catalogue.commonOption('--no-lint-config'));
  }

  /** Paths and stdin resolve from the working directory; project plugins run. */
  protected lintOptions(options: RawOpts): Pick<FileMutationOptions, 'lintConfig' | 'lintFrom' | 'lintProjectCode'> {
    const config = options['lintConfig'] as string | false | undefined;
    const cwd = config === false ? undefined : this.workingDir();
    return { ...(config !== undefined ? { lintConfig: config } : {}), ...(cwd !== undefined ? { lintFrom: cwd } : {}), lintProjectCode: true };
  }

  /** Undefined when the working directory was removed: a command on absolute paths still runs. */
  private workingDir(): string | undefined {
    try {
      return process.cwd();
    } catch {
      return undefined;
    }
  }
}
