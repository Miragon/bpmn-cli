import type { AnalyzeLayoutUseCase } from '../port/in/AnalyzeLayoutUseCase.js';
import type { LayoutMetrics, LayoutProblem } from '../../domain/diagram/utils/problems.js';
import { LayoutAnalysis } from '../../domain/diagram/di/LayoutAnalysis.js';
import { ProblemLocator } from '../../domain/diagram/di/ProblemLocator.js';

export class AnalyzeLayoutService implements AnalyzeLayoutUseCase {
  measure(command: AnalyzeLayoutUseCase.MeasureCommand): LayoutMetrics {
    const { definitions, ...opts } = command;
    return LayoutAnalysis.of(definitions, opts);
  }

  measureXml(command: AnalyzeLayoutUseCase.MeasureXmlCommand): Promise<LayoutMetrics> {
    return LayoutAnalysis.ofXml(command.xml);
  }

  locateProblems(command: AnalyzeLayoutUseCase.LocateCommand): LayoutProblem[] {
    return new ProblemLocator(command.definitions).locate(command.problems);
  }
}
