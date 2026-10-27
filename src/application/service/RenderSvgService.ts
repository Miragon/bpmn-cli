import type { RenderSvgUseCase } from '../port/in/RenderSvgUseCase.js';
import type { RenderResult } from '../../domain/views/render/types.js';
import { DocRenderer } from '../../domain/views/render/DocRenderer.js';

export class RenderSvgService implements RenderSvgUseCase {
  renderXml(command: RenderSvgUseCase.XmlCommand): Promise<RenderResult> {
    const { xml, ...opts } = command;
    return DocRenderer.renderXml(xml, opts);
  }

  renderDoc(command: RenderSvgUseCase.DocCommand): RenderResult {
    const { doc, ...opts } = command;
    return new DocRenderer(doc, opts).render();
  }
}
