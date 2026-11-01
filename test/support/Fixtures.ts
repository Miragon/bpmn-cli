import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BpmnDocument, type BpmnElement, DocumentReader } from '../../src/model/index.js';
import { OperationParser, type ParsedOperations } from '../../src/operations/index.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus');

export class Fixtures {
  static text(path: string): string {
    return readFileSync(join(CORPUS, path), 'utf8');
  }

  static read(path: string): Promise<BpmnDocument> {
    return new DocumentReader().read(Fixtures.text(path));
  }

  static readForWrite(path: string): Promise<BpmnDocument> {
    return new DocumentReader().readForWrite(Fixtures.text(path));
  }

  static operations(operations: unknown[]): ParsedOperations {
    return new OperationParser().parse(operations);
  }

  static element(document: BpmnDocument, id: string): BpmnElement {
    return document.tree.require(id);
  }
}
