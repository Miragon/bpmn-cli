import { describe, expect, it } from 'vitest';
import { EdgeObstacles } from '../../../../src/drawing/incremental/routing/EdgeObstacles.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('EdgeObstacles', () => {
  async function planeOf(path: string, index = 0) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[index]!;
  }

  it('names the sub-process, lane and pool around a nested shape', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');

    expect([...new EdgeObstacles(plane).ancestors(plane.shapes.get('X')!)].sort()).toEqual(['L2', 'Pool', 'SP']);
  });

  it('counts other shapes as obstacles but not the ends and their frames', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const edge = plane.edges.get('G2')!;
    const boxes = new EdgeObstacles(plane).around(edge, plane.shapes.get('X')!, plane.shapes.get('Y')!);

    expect(boxes).toContain(plane.shapes.get('T1')!.bounds);
    expect(boxes).not.toContain(plane.shapes.get('X')!.bounds);
    expect(boxes).not.toContain(plane.shapes.get('SP')!.bounds);
  });

  it('counts a collapsed frame of the other side as solid for a message flow only', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const edge = plane.edges.get('M1')!;
    const pool = plane.shapes.get('Cust')!;

    expect(EdgeObstacles.solidFor(pool, edge)).toBe(true);
    expect(EdgeObstacles.solidFor(pool, plane.edges.get('F1')!)).toBe(false);
    expect(EdgeObstacles.solidFor(plane.shapes.get('ESP')!, plane.edges.get('F1')!)).toBe(true);
  });

  it('frees only the lines of annotations', async () => {
    const plane = await planeOf('models/incremental/collabnote.bpmn');

    expect([...new EdgeObstacles(plane).freeLines()]).toEqual([plane.edges.get('As')!.points]);
  });
});
