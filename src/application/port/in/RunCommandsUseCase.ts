import type { Doc } from '../../../domain/document/Doc.js';
import type { ChangeSet } from '../../../domain/document/ChangeSet.js';
import type { EditCommand } from '../../../domain/commands/types.js';

/**
 * The commands of a batch run on a document in memory on their own:
 * no lossy-import guard, no validation, no layout, nothing written.
 */
export interface RunCommandsUseCase {

  /** Runs one model command on its own. */
  runModelCommand(command: RunCommandsUseCase.ModelCommand): ChangeSet;

  /** Runs model commands as one batch and returns what changed. */
  runModelCommands(command: RunCommandsUseCase.ModelCommands): ChangeSet;

  /** Validates the ops (an array or `{ ops }`); a usage error names the op index. */
  parseCommands(command: RunCommandsUseCase.ParseCommand): EditCommand[];

  /** The ops of a JSON text, validated like parseCommands. */
  parseCommandsJson(command: RunCommandsUseCase.ParseJsonCommand): EditCommand[];
}

export declare namespace RunCommandsUseCase {

  /** One model command and the document it runs on. */
  interface ModelCommand {
    doc: Doc;
    command: EditCommand;
  }

  /** Model commands run as one batch on a document. */
  interface ModelCommands {
    doc: Doc;
    commands: EditCommand[];
  }

  /** Ops as parsed JSON: an array or `{ ops }`. */
  interface ParseCommand {
    input: unknown;
  }

  /** Ops as JSON text. */
  interface ParseJsonCommand {
    json: string;
  }
}
