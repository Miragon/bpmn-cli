import type { El } from '../../../domain/document/utils/moddle.js';
import type { LayoutMetrics, LayoutProblem } from '../../../domain/diagram/utils/problems.js';

/** `bpmn metrics`: the layout problems of a drawing, its score and where each problem shows. */
export interface AnalyzeLayoutUseCase {

  /** The layout problems of every diagram; `importWarnings` count as one `failed` problem. */
  measure(command: AnalyzeLayoutUseCase.MeasureCommand): LayoutMetrics;

  /** Parses the XML and measures it (import warnings count as `failed`). */
  measureXml(command: AnalyzeLayoutUseCase.MeasureXmlCommand): Promise<LayoutMetrics>;

  /** The problems with where each shows on its plane. */
  locateProblems(command: AnalyzeLayoutUseCase.LocateCommand): LayoutProblem[];
}

export declare namespace AnalyzeLayoutUseCase {

  /** The parsed definitions whose diagrams are measured. */
  interface MeasureCommand {
    definitions: El;
    /** import warnings of the document, counted as one `failed` problem */
    importWarnings?: number;
  }

  /** The XML text to parse and measure. */
  interface MeasureXmlCommand {
    xml: string;
  }

  /** Problems found earlier, to locate on the planes of the definitions. */
  interface LocateCommand {
    definitions: El;
    problems: readonly LayoutProblem[];
  }
}
