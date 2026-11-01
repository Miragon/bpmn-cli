import { describe, expect, it } from 'vitest';
import { Plane } from '../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { Scorer, ElementHomes } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('Plane', () => {
  async function planeOf(path: string): Promise<Plane> {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  it('lists its leaves and measures them', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');

    expect(plane.leaves().some((shape) => shape.kind === 'lane')).toBe(false);
    expect(plane.contentBox()).toBeDefined();
    expect(plane.contentBox((shape) => shape.id === 'T1')?.width).toBe(plane.shapes.get('T1')!.bounds.width);
  });

  it('holds the content of an expanded sub-process, all depths', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');

    const { shapes, edges } = plane.contentOf('SP');

    expect(shapes.map(({ id }) => id).sort()).toEqual(['SE', 'SS', 'X', 'Y']);
    expect(edges.map(({ id }) => id).sort()).toEqual(['G1', 'G2', 'G3']);
  });

  it('lists the boundary events of a host', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');

    expect(plane.boundariesOf('A').map(({ id }) => id)).toEqual(['B']);
  });

  it('drops shapes that move with another listed shape', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const shapes = ['SP', 'X', 'T1'].map((id) => plane.shapes.get(id)!);

    expect(plane.outermost(shapes).map(({ id }) => id)).toEqual(['SP', 'T1']);
  });

  it('measures the gap and row spacing it is drawn with', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');

    const spacing = plane.spacing();

    expect(spacing.gap).toBeGreaterThanOrEqual(40);
    expect(spacing.gap).toBeLessThanOrEqual(100);
    expect(spacing.rowTol).toBe(Math.max(5, spacing.row / 4));
    expect(plane.spacing(() => undefined)).toEqual({ gap: 60, row: 140, rowTol: 35 });
  });

  it('finds a vertical pool or lane', async () => {
    expect((await planeOf('models/incremental/vertical.bpmn')).verticalBand()?.id).toBeDefined();
    expect((await planeOf('models/incremental/lanesub.bpmn')).verticalBand()).toBeUndefined();
  });

  it('finds the plane an id is drawn on', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');

    expect(Plane.with([plane], 'F5')).toBe(plane);
    expect(Plane.with([plane], 'A')).toBe(plane);
    expect(Plane.with([plane], 'missing')).toBeUndefined();
  });

  it('gives the scorer an unmoved shape as read and a moved one rounded', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    plane.shapes.get('C')!.bounds.translate(10.4, 0);
    const read = plane.shapes.get('A')!.bounds.x;

    const drawing = [...plane.drawing().shapes];

    expect(drawing.find(({ id }) => id === 'A')!.bounds.x).toBe(read);
    expect(Number.isInteger(drawing.find(({ id }) => id === 'C')!.bounds.x)).toBe(true);
  });

  it('scores like the file it was read from', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const planes = new PlaneReader(document.tree.definitions).planes();

    expect(new Scorer().scoreDrawing(Plane.drawingsOf(planes), new ElementHomes(document)).score).toBe(new Scorer().score(document).score);
  });

  it('leaves a deleted plane out of the drawing', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    plane.deleted = true;

    expect(Plane.drawingsOf([plane])).toEqual([]);
  });
});
