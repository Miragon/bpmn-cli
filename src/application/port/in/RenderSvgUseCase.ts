import type { Doc } from '../../../domain/document/Doc.js';
import type { RenderOptions, RenderResult } from '../../../domain/views/render/types.js';

/** `bpmn render --format svg` in memory: one plane of a document as SVG, nothing written. */
export interface RenderSvgUseCase {

  renderXml(command: RenderSvgUseCase.XmlCommand): Promise<RenderResult>;

  /** One plane of a parsed document (no layout). */
  renderDoc(command: RenderSvgUseCase.DocCommand): RenderResult;
}

export declare namespace RenderSvgUseCase {

  /** The XML text to draw as SVG. */
  interface XmlCommand extends RenderOptions {
    xml: string;
  }

  /** A parsed document to draw as SVG. */
  interface DocCommand extends RenderOptions {
    doc: Doc;
  }
}
