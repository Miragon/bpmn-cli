import type { RenderResult, RenderSvgUseCase } from '../port/in/RenderSvgUseCase.js';
import type { RenderDiagramPort } from '../port/out/RenderDiagramPort.js';
import { DrawableDoc } from '../../domain/views/DrawableDoc.js';

export class RenderSvgService implements RenderSvgUseCase {
  constructor(private readonly renderer: RenderDiagramPort) {}

  async renderXml(command: RenderSvgUseCase.XmlCommand): Promise<RenderResult> {
    const { xml, ...opts } = command;
    const drawable = await DrawableDoc.fromXml(xml, !!opts.problems);
    const result = this.renderer.render(drawable.doc, opts, drawable.fileProblems);
    return { ...result, notes: [...drawable.notes, ...result.notes] };
  }

  renderDoc(command: RenderSvgUseCase.DocCommand): RenderResult {
    const { doc, ...opts } = command;
    return this.renderer.render(doc, opts);
  }
}
