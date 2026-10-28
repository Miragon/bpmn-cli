import type { RenderDiagramUseCase } from '../port/in/RenderDiagramUseCase.js';
import type { DocumentPort } from '../port/out/DocumentPort.js';
import type { RenderDiagramPort } from '../port/out/RenderDiagramPort.js';
import type { WriteImagePort } from '../port/out/WriteImagePort.js';
import { DrawableDoc } from '../../domain/views/DrawableDoc.js';

export class RenderDiagramService implements RenderDiagramUseCase {
  constructor(
    private readonly documents: DocumentPort,
    private readonly renderer: RenderDiagramPort,
    private readonly images: WriteImagePort,
  ) {}

  async render(command: RenderDiagramUseCase.Command): Promise<RenderDiagramUseCase.Result> {
    const { source, opts, ...request } = command;
    const xml = await this.documents.text(source);
    const drawable = await DrawableDoc.fromXml(xml, !!opts.problems);
    const result = this.renderer.render(drawable.doc, opts, drawable.fileProblems);
    const drawn = { ...result, notes: [...drawable.notes, ...result.notes] };
    return this.images.write({ drawn, ...request });
  }
}
