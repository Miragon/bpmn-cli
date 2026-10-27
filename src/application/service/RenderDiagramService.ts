import type { RenderDiagramUseCase } from '../port/in/RenderDiagramUseCase.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';
import type { WriteImagePort } from '../port/out/WriteImagePort.js';

export class RenderDiagramService implements RenderDiagramUseCase {
  constructor(
    private readonly load: LoadDocumentPort,
    private readonly images: WriteImagePort,
  ) {}

  async render(command: RenderDiagramUseCase.Command): Promise<RenderDiagramUseCase.Result> {
    const { source, ...request } = command;
    const xml = await this.textOf(source);
    return this.images.write({ xml, ...request });
  }

  private async textOf(source: RenderDiagramUseCase.Command['source']): Promise<string> {
    if ('xml' in source) return source.xml;
    return 'file' in source ? this.load.read(source.file) : this.load.decode(source.bytes, source.name);
  }
}
