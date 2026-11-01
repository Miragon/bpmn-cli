import { BpmnError } from '../errors/BpmnError.js';
import { ModelError } from '../errors/ModelError.js';
import { IdRegistry } from '../ids/IdRegistry.js';
import { ModdleParser, type ParsedModel } from '../xml/ModdleParser.js';
import { BpmnDocument } from './BpmnDocument.js';
import { BpmnElement } from './BpmnElement.js';
import { BpmnTree } from './BpmnTree.js';
import { DocumentWriter } from './DocumentWriter.js';
import { ElementWalk } from './ElementWalk.js';
import { MirrorLists } from './MirrorLists.js';

export class DocumentReader {
  private static async parsed(xml: string, file: string | undefined): Promise<ParsedModel> {
    try {
      return await new ModdleParser().parse(xml);
    } catch (error) {
      if (error instanceof ModelError) {
        throw BpmnError.io('E_PARSE', error.message, { ...error.details, file });
      }
      throw error;
    }
  }

  private static idsOf(definitions: BpmnElement): string[] {
    return [...new ElementWalk(definitions).depthFirst({ bpmnOnly: true })].flatMap((element) => element.get<string | undefined>('id') || []);
  }

  async read(xml: string, file?: string): Promise<BpmnDocument> {
    const { moddle, definitions: rawDefinitions, importWarnings } = await DocumentReader.parsed(xml, file);
    const definitions = BpmnElement.of(rawDefinitions);
    const registry = new IdRegistry(DocumentReader.idsOf(definitions));
    const mirror = new MirrorLists(definitions);
    const snapshot = mirror.snapshot();
    mirror.complete();
    return new BpmnDocument({ tree: new BpmnTree(moddle, definitions, registry), registry, importWarnings, file, source: { text: xml, mirror: snapshot } });
  }

  async readForWrite(xml: string, file?: string): Promise<BpmnDocument> {
    const document = await this.read(xml, file);
    document.source!.asRead = await new DocumentWriter().asRead(document);
    return document;
  }
}
