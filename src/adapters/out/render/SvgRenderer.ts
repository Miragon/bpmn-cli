import type { LayoutProblem } from '../../../domain/diagram/utils/problems.js';
import type { Doc } from '../../../domain/document/Doc.js';
import type { RenderOptions, RenderResult } from '../../../application/port/in/RenderSvgUseCase.js';
import type { RenderDiagramPort } from '../../../application/port/out/RenderDiagramPort.js';
import { DocRenderer } from './DocRenderer.js';

/**
 * Our own SVG renderer instead of bpmn-js: bpmn-js needs a browser DOM to measure text and place
 * labels, so in Node it would take a headless Chromium (over 100 MB, seconds per image, output that
 * varies with fonts and versions) and would not run in the browser bundle without a DOM either.
 * This one needs no browser, gives the same bytes on every machine and draws what an agent needs and
 * bpmn-js has no notion of: crops (around, path, scope), halos for created, changed and moved
 * elements, numbered layout problems, tiles and notes on broken DI.
 */
export class SvgRenderer implements RenderDiagramPort {
  render(doc: Doc, opts: RenderOptions = {}, fileProblems?: LayoutProblem[]): RenderResult {
    return new DocRenderer(doc, opts).render(fileProblems);
  }
}
