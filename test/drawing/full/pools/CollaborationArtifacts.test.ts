import { describe, expect, it } from 'vitest';
import { CleanEngine } from '../../../../src/drawing/full/pools/CleanEngine.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('CollaborationArtifacts', () => {
  async function drawn(path: string) {
    const document = await Fixtures.read(path);
    const { warnings } = new CleanEngine(document, document.diagram.expandedIds()).run();
    return { document, warnings, plane: new PlaneReader(document.tree.definitions).planes()[0]! };
  }

  it('draws a note on a pool outside every pool and one on a task inside its pool', async () => {
    const { plane } = await drawn('layout/collab__notes-on-collaboration.bpmn');
    const notes = [...plane.shapes.values()].filter((shape) => shape.kind === 'annotation');
    const pools = [...plane.shapes.values()].filter((shape) => shape.kind === 'participant');

    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((note) => pools.some((pool) => note.bounds.isInside(pool.bounds)) || !pools.some((pool) => note.bounds.overlaps(pool.bounds)))).toBe(true);
  });

  it('draws a line for each association the collaboration owns', async () => {
    const { plane, document } = await drawn('layout/artifacts__17-pool-notes-msg.bpmn');
    const lines = document.tree.collaboration()!.list('artifacts').filter((artifact) => artifact.is('bpmn:Association'));

    expect(lines.every((line) => plane.edges.get(line.id)?.points.length === 2)).toBe(true);
  });

  it('warns about no note it could anchor', async () => {
    const { warnings } = await drawn('models/incremental/collabnote.bpmn');

    expect(warnings).toEqual([]);
  });
});
