import type { RenderDiagramUseCase } from '../port/in/RenderDiagramUseCase.js';
import type { DocumentPort } from '../port/out/DocumentPort.js';
import type { WriteImagePort } from '../port/out/WriteImagePort.js';

export class RenderDiagramService implements RenderDiagramUseCase {
  constructor(
    private readonly documents: DocumentPort,
    private readonly images: WriteImagePort,
  ) {}

  async render(command: RenderDiagramUseCase.Command): Promise<RenderDiagramUseCase.Result> {
    const { source, ...request } = command;
    const xml = await this.documents.text(source);
    return this.images.write({ xml, ...request });
  }
}
