import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DiagramDrawing, DrawingSnapshot } from '../../src/drawing/index.js';
import { ChangeSet, DocumentWriter } from '../../src/model/index.js';
import { DrawingPair } from '../support/DrawingPair.js';
import { Fixtures } from '../support/Fixtures.js';
import { StandardSize } from '../support/StandardSize.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus');

function bpmnFilesBelow(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      return bpmnFilesBelow(path);
    }
    return name.endsWith('.bpmn') ? [path] : [];
  });
}

const redrawnModels = ['layout', 'models'].flatMap((folder) => bpmnFilesBelow(join(CORPUS, folder))).map((path) => relative(CORPUS, path));
const walkSteps = readdirSync(join(CORPUS, 'walks')).flatMap((walk) => DrawingPair.walkSteps(walk).map((step, index) => ({ row: `${walk}#${index}`, step })));

describe("drawing under bpmnlint's standard-size", () => {
  it('holds a corpus of real size', () => {
    expect(redrawnModels.length).toBeGreaterThanOrEqual(167);
    expect(walkSteps.length).toBeGreaterThan(100);
  });

  it.each(redrawnModels)('redraws %s at the sizes of the table', async (path) => {
    const document = await Fixtures.read(path);

    await new DiagramDrawing(document).update(DrawingSnapshot.of(document), new ChangeSet(), [{ op: 'layout' }]);

    expect(await StandardSize.reportsOn(await new DocumentWriter().plain(document))).toEqual([]);
  });

  it.each(walkSteps)('places walk step $row without a shape off the table that was not drawn so before', async ({ step }) => {
    const { document, before, changes } = await DrawingPair.of(step.before, step.noLayout.file, step.noLayout);
    const drawnBefore = new Set((await StandardSize.reportsOn(step.before)).map(({ id }) => id));

    await new DiagramDrawing(document).update(before, changes, []);

    const reports = await StandardSize.reportsOn(await new DocumentWriter().plain(document));
    expect(reports.filter(({ id }) => !drawnBefore.has(id))).toEqual([]);
  });
});
