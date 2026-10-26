import type { ImageRequest, Shot } from '../out/WriteImagePort.js';

/**
 * `bpmn render` and `--render`:
 * a document drawn as PNG or SVG and written where the command says.
 */
export interface RenderDiagramUseCase {

  render(command: RenderDiagramUseCase.Command): Promise<RenderDiagramUseCase.Result>;
}

export declare namespace RenderDiagramUseCase {

  interface Command extends Omit<ImageRequest, 'xml'> {
    source: { file: string } | { bytes: Uint8Array; name: string } | { xml: string };
  }

  type Result = Shot;
}
