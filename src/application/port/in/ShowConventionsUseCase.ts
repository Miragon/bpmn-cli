import type { Doc } from '../../../domain/document/Doc.js';
import type { ConventionsView, ConventionsXmlOptions } from '../../../domain/document/ids/ConventionsTable.js';
import type { FileBpmnlintOptions } from '../out/LoadProjectSettingsPort.js';

/**
 * `bpmn show --conventions`: the id conventions new ids follow in a file,
 * from its .bpmnlintrc and its own style.
 */
export interface ShowConventionsUseCase {

  show(command: ShowConventionsUseCase.Command): Promise<ShowConventionsUseCase.Result>;

  /** The conventions a caller already holds, one row per pattern (no doc: a new file). */
  view(command: ShowConventionsUseCase.ViewCommand): ShowConventionsUseCase.Result;
}

export declare namespace ShowConventionsUseCase {

  /** The file whose id conventions are shown, and its bpmnlint options. */
  interface Command extends FileBpmnlintOptions {

    file?: string;

    /** undefined for a file that does not exist yet: the conventions a new model there gets */
    doc?: Doc;
  }

  /** The id conventions, one row per pattern. */
  type Result = ConventionsView;

  /** Conventions a caller already holds and the document they apply to. */
  interface ViewCommand extends ConventionsXmlOptions {
    doc?: Doc;
  }
}
