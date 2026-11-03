import { DrawnPlane, ElementHomes } from '../support/ModelValues.js';
import { describe, expect, it } from 'vitest';
import { Scorer } from '../../src/scoring/Scorer.js';
import { Fixtures } from '../support/Fixtures.js';

interface RecordedScore {
  score: number;
  counts: Record<string, number>;
}

const recorded: { files: Record<string, RecordedScore> } = JSON.parse(Fixtures.text('layout/scores.json'));

describe('Scorer', () => {
  it.each(Object.entries(recorded.files))('gives main\'s counts per kind on %s', async (path, { counts, score }) => {
    const result = new Scorer().score(await Fixtures.read(path));

    expect(result.counts).toEqual(counts);
    expect(result.score).toBe(score);
  });

  it('reports the import warnings of a file as one failed problem', async () => {
    const { problems, score } = new Scorer().score(await Fixtures.read('scoring/import-warning.bpmn'));

    expect(problems).toEqual([{ kind: 'failed', ids: [], detail: 'import warnings: 1' }]);
    expect(score).toBe(50);
  });

  it('judges a plane in memory like the file it was read from, import warnings aside', async () => {
    const document = await Fixtures.read('layout/agent__large.bpmn');
    const scorer = new Scorer();

    const inMemory = scorer.scoreDrawing(DrawnPlane.read(document), new ElementHomes(document));

    expect(inMemory.problems).toEqual(scorer.score(document).problems);
  });

  it('sees a shape moved in memory without a write to the DI', async () => {
    const document = await Fixtures.read('scoring/overlap.bpmn');
    const scorer = new Scorer();
    const [drawing] = DrawnPlane.read(document);
    const shapes = [...drawing!.shapes].map((shape) => ({ ...shape, bounds: shape.bounds.copy() }));
    shapes.find(({ id }) => id === 'task_upper')!.bounds.translate(0, 500);

    const moved = scorer.scoreDrawing([{ ...drawing!, shapes }], new ElementHomes(document));

    expect(moved.counts.overlaps).toBe(0);
    expect(scorer.score(document).counts.overlaps).toBe(1);
  });

  it('finds the elements of a file without a diagram all missing', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');

    expect(new Scorer().score(document).counts.missing).toBe(document.tree.processes()[0]!.list('flowElements').length);
  });
});
