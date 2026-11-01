import { describe, expect, it } from 'vitest';
import { OperationBefore } from '../../../src/drawing/incremental/OperationBefore.js';
import { EdgeRouter } from '../../../src/drawing/incremental/routing/EdgeRouter.js';
import { Frames } from '../../../src/drawing/plane/Frames.js';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../support/Fixtures.js';
import { Point } from '../../support/ModelValues.js';

describe('OperationBefore', () => {
  async function beforeOf(path = 'models/incremental/boundary.bpmn') {
    const document = await Fixtures.read(path);
    const plane = new PlaneReader(document.tree.definitions).planes()[0]!;
    return { plane, before: new OperationBefore([{ plane, routes: new EdgeRouter(plane) }]) };
  }

  it('remembers boxes, points and labels as copies', async () => {
    const { plane, before } = await beforeOf();
    const shape = plane.shapes.get('E2')!;
    shape.bounds.x += 50;
    shape.label!.x += 50;

    expect(before.bounds.get('E2')!.x).toBe(292);
    expect(before.labels.get('E2')!.x).toBe(shape.label!.x - 50);
    expect(before.edges.has(plane.edges.get('F1')!)).toBe(true);
  });

  it('knows a line is unchanged until a point moves, and nothing of a new one', async () => {
    const { plane, before } = await beforeOf();
    const edge = plane.edges.get('F2')!;

    expect(before.unchanged(edge)).toBe(true);
    edge.points[1] = new Point(450, 120);
    expect(before.unchanged(edge)).toBe(false);
    before.points.delete('F2');
    expect(before.unchanged(edge)).toBe(false);
  });

  it('lists the shapes and lines that changed', async () => {
    const { plane, before } = await beforeOf();
    plane.shapes.get('C')!.bounds.x += 10;
    plane.edges.get('F2')!.points[1]!.x += 10;

    expect(before.changedShapes()).toEqual(['C']);
    expect(before.changedEdges()).toEqual(['F2']);
  });

  it('skips what it never saw', async () => {
    const { plane, before } = await beforeOf();
    plane.shapes.get('C')!.bounds.x += 10;
    plane.edges.get('F2')!.points[1]!.x += 10;
    before.bounds.delete('C');
    before.points.delete('F2');

    expect(before.changedShapes()).toEqual([]);
    expect(before.changedEdges()).toEqual([]);
  });

  it('calls a label clear of a title it did not overlap before', async () => {
    const { plane, before } = await beforeOf('models/incremental/polish-collab.bpmn');
    const sub = plane.shapes.get('ESP')!;
    const owner = plane.shapes.get('ES')!;

    expect(before.clearOfTitle(owner, sub)).toBe(true);
    before.labels.set('ES', Frames.title(sub)!.copy());
    expect(before.clearOfTitle(owner, sub)).toBe(false);
    before.bounds.delete('ESP');
    expect(before.clearOfTitle(owner, sub)).toBe(true);
    before.labels.delete('ES');
    expect(before.clearOfTitle(owner, sub)).toBe(true);
  });
});
