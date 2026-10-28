import type { LayoutProblem } from '../../../domain/diagram/utils/problems.js';
import type { Doc } from '../../../domain/document/Doc.js';
import type { RenderOptions, RenderResult } from '../in/RenderSvgUseCase.js';

/** Draws one plane of a document as SVG; `fileProblems` are listed instead of the drawing's. */
export interface RenderDiagramPort {

  render(doc: Doc, opts: RenderOptions, fileProblems?: LayoutProblem[]): RenderResult;
}
