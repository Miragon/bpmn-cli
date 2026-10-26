import type { Doc } from '../../../domain/document/Doc.js';
import type { ConventionsView } from '../../../domain/document/ids/ConventionsTable.js';
import type { FileBpmnlintOptions } from '../out/LoadProjectSettingsPort.js';

/**
 * `bpmn show --conventions`: the id conventions new ids follow in a file,
 * from its .bpmnlintrc and its own style.
 */
export interface ShowConventionsUseCase {

  show(command: ShowConventionsUseCase.Command): Promise<ShowConventionsUseCase.Result>;
}

export declare namespace ShowConventionsUseCase {

  interface Command extends FileBpmnlintOptions {

    file?: string;

    /** undefined for a file that does not exist yet: the conventions a new model there gets */
    doc?: Doc;
  }

  type Result = ConventionsView;
}
