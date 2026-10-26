import type { RunCommandsUseCase } from '../port/in/RunCommandsUseCase.js';
import type { ChangeSet } from '../../domain/document/ChangeSet.js';
import type { EditCommand } from '../../domain/commands/types.js';
import { CommandParser } from '../../domain/commands/CommandParser.js';
import { parseOpsJson } from '../../domain/commands/utils/ops-json.js';
import { ModelCommandService } from '../../domain/batch/ModelCommandService.js';
import { DiagramCommandService, type FormatResult } from '../../domain/diagram/DiagramCommandService.js';

export class RunCommandsService implements RunCommandsUseCase {
  runModelCommand(command: RunCommandsUseCase.ModelCommand): ChangeSet {
    return new ModelCommandService(command.doc).runOp(command.command);
  }

  runModelCommands(command: RunCommandsUseCase.ModelCommands): ChangeSet {
    return new ModelCommandService(command.doc).runBatch(command.commands).changes;
  }

  runDiagramCommands(command: RunCommandsUseCase.DiagramCommands): FormatResult[] {
    return new DiagramCommandService(command.doc).run(command.entries, command.asFile ?? false);
  }

  parseCommands(command: RunCommandsUseCase.ParseCommand): EditCommand[] {
    return new CommandParser().parse(command.input);
  }

  parseCommandsJson(command: RunCommandsUseCase.ParseJsonCommand): EditCommand[] {
    return new CommandParser().parse(parseOpsJson(command.json));
  }
}
