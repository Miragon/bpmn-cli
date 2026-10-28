import type { ImageRequest, Shot } from '../out/WriteImagePort.js';
import type { RenderOptions } from './RenderSvgUseCase.js';

/**
 * `bpmn render` and `--render`:
 * a document drawn as PNG or SVG and written where the command says.
 */
export interface RenderDiagramUseCase {

  render(command: RenderDiagramUseCase.Command): Promise<RenderDiagramUseCase.Result>;
}

export declare namespace RenderDiagramUseCase {

  /** The document to draw and the image request for it. */
  interface Command extends Omit<ImageRequest, 'drawn'> {
    opts: RenderOptions;
    source: { file: string } | { bytes: Uint8Array; name: string } | { xml: string };
  }

  /** The image that was drawn and where it went. */
  type Result = Shot;
}
