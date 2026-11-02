import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type BpmnDocument, type BpmnElement, DocumentReader, DocumentWriter } from '../../src/model/index.js';
import { Fixtures } from '../support/Fixtures.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

function bpmnFilesBelow(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      return bpmnFilesBelow(path);
    }
    return name.endsWith('.bpmn') ? [path] : [];
  });
}

const allModels = ['models', 'layout', 'model'].flatMap((folder) => bpmnFilesBelow(join(CORPUS, folder))).map((path) => relative(CORPUS, path));

async function readable(path: string): Promise<BpmnDocument | undefined> {
  const document = await Fixtures.readForWrite(path);
  return document.lossyImportWarnings.length ? undefined : document;
}

function drawnElementIds(document: BpmnDocument): string[] {
  const planeElements = document.diagram.planes().flatMap((plane) => plane.list('planeElement'));
  return planeElements.map((element) => `${element.type} ${element.peek('id')} ${element.peek<BpmnElement>('bpmnElement')?.peek('id')}`);
}

function renameFirstNamed(document: BpmnDocument): void {
  const named = [...document.tree.all().values()].find((element) => element.is('bpmn:FlowNode') && element.name);
  named?.set('name', `${named.name} X`);
}

describe('the model over the corpus', () => {
  it('holds a corpus of real size', () => {
    expect(allModels.length).toBeGreaterThan(170);
  });

  it.each(allModels)('%s: a no-op changes no bytes', async (path) => {
    const document = await readable(path);
    if (document) {
      expect(await new DocumentWriter().write(document)).toBe(Fixtures.text(path));
    }
  });

  it.each(allModels)('%s: a rename keeps every shape and edge of its DI', async (path) => {
    const document = await readable(path);
    if (document) {
      const drawnBefore = drawnElementIds(document);
      renameFirstNamed(document);

      const written = await new DocumentReader().read(await new DocumentWriter().write(document));

      expect(drawnElementIds(written)).toEqual(drawnBefore);
    }
  });

  it.each(allModels)('%s: two runs give the same bytes', async (path) => {
    const [first, second] = [await readable(path), await readable(path)];
    if (first && second) {
      renameFirstNamed(first);
      renameFirstNamed(second);

      expect(await new DocumentWriter().write(first)).toBe(await new DocumentWriter().write(second));
    }
  });
});
