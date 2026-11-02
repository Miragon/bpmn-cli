import { describe, expect, it } from 'vitest';
import { EdgeRouter } from '../../../../src/drawing/incremental/routing/EdgeRouter.js';
import { PlaneEdge } from '../../../../src/drawing/plane/PlaneEdge.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Point, Polyline } from '../../../support/ModelValues.js';

describe('EdgeRouter', () => {
  async function planeOf(path: string, index = 0) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[index]!;
  }

  it('routes sequence flows before message flows before lines on a flow', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const router = new EdgeRouter(plane);
    const onFlow = new PlaneEdge('onFlow', plane.edges.get('F1')!.el, 'association');
    onFlow.targetId = 'F1';
    plane.edges.set('onFlow', onFlow);
    const fromFlow = new PlaneEdge('fromFlow', plane.edges.get('F1')!.el, 'association');
    fromFlow.sourceId = 'F1';
    plane.edges.set('fromFlow', fromFlow);

    expect(router.routeRank(plane.edges.get('F1')!)).toBe(0);
    expect(router.routeRank(plane.edges.get('M1')!)).toBe(1);
    expect(router.routeRank(onFlow)).toBe(2);
    expect(router.routeRank(fromFlow)).toBe(2);
  });

  it('lists every line but the one being routed, and the labels as diagonals', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const lines = new EdgeRouter(plane).routingLines('f1');

    expect(lines).not.toContain(plane.edges.get('f1')!.points);
    expect(lines).toContain(plane.edges.get('f2')!.points);
    expect(lines.length).toBeGreaterThan(plane.edges.size - 1);
  });

  it('skips a line without points', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    plane.edges.get('F1')!.points = [];

    expect(new EdgeRouter(plane).routingLines()).toHaveLength(2);
  });

  it('adds the labels of shapes to the lines', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');

    expect(new EdgeRouter(plane).routingLines().length).toBeGreaterThan(plane.edges.size);
  });

  it('routes a flow on its row around nothing', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const router = new EdgeRouter(plane);
    const edge = plane.edges.get('F2')!;

    expect(router.routeEdge(edge, { lines: router.routingLines(edge.id) })).toEqual([new Point(340, 120), new Point(400, 120)]);
  });

  it('routes a flow around a shape between its ends', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const router = new EdgeRouter(plane);
    const edge = plane.edges.get('F2')!;
    plane.shapes.get('C')!.bounds.x = 700;
    plane.shapes.get('D')!.bounds.x = 400;
    const points = router.routeEdge(edge, { lines: [] })!;

    expect(new Polyline(points).hits(plane.shapes.get('D')!.bounds)).toBe(false);
    expect(new Polyline(points).isOrthogonal()).toBe(true);
  });

  it('keeps a flow of one lane inside that lane', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const router = new EdgeRouter(plane);
    const lane = plane.shapes.get('L1')!;
    plane.shapes.get('T2')!.bounds.x = 300;
    const points = router.routeEdge(plane.edges.get('F4')!, { lines: [] })!;

    expect(points.every((point) => lane.bounds.contains(point))).toBe(true);
  });

  it('keeps a flow of one sub-process or one pool inside that frame', async () => {
    const lanes = await planeOf('models/incremental/lanesub.bpmn');
    const inSub = new EdgeRouter(lanes).routeEdge(lanes.edges.get('G2')!, { lines: [] })!;
    const pool = await planeOf('models/incremental/pool.bpmn');
    const inPool = new EdgeRouter(pool).routeEdge(pool.edges.get('F2')!, { lines: [] })!;

    expect(inSub.every((point) => lanes.shapes.get('SP')!.bounds.contains(point))).toBe(true);
    expect(inPool.every((point) => pool.shapes.get('Pool')!.bounds.contains(point))).toBe(true);
  });

  it('routes a message flow out of the top or bottom towards the other pool', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const edge = plane.edges.get('M1')!;
    const points = new EdgeRouter(plane).routeEdge(edge, { lines: [] })!;

    expect(points[0]!.y).toBe(plane.shapes.get('R')!.bounds.y);
    expect(points.at(-1)!.y).toBe(plane.shapes.get('Cust')!.bounds.bottom);
  });

  it('routes a message flow downwards the same way', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const points = new EdgeRouter(plane).routeEdge(plane.edges.get('Msg_1')!, { lines: [] })!;

    expect(points[0]!.y).toBe(plane.shapes.get('Task_Notify')!.bounds.bottom);
    expect(points.at(-1)!.y).toBe(plane.shapes.get('Task_Recv')!.bounds.y);
  });

  it('leaves a boundary event on the side of its host it sits on', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const points = new EdgeRouter(plane).routeEdge(plane.edges.get('F5')!, { lines: [] })!;

    expect(points[0]!.y).toBe(plane.shapes.get('B')!.bounds.bottom);
  });

  it('takes the sides it is given', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const points = new EdgeRouter(plane).routeEdge(plane.edges.get('F2')!, { lines: [], sourceSides: ['top'], targetSides: ['top'] })!;

    expect(points[0]!.y).toBe(80);
    expect(points.at(-1)!.y).toBe(80);
  });

  it('leaves a gateway on a side no other flow took', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const router = new EdgeRouter(plane);
    const edge = plane.edges.get('f3')!;
    const points = router.routeEdge(edge, { lines: router.routingLines(edge.id) })!;

    expect(points[0]).toEqual(new Point(275, 190));
  });

  it('shares the entry of a join from above when that costs no crossing', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const router = new EdgeRouter(plane);
    const edge = plane.edges.get('f4')!;
    plane.edges.get('f5')!.points = [new Point(460, 335), new Point(545, 335), new Point(545, 190)];
    edge.points = [];
    const points = router.routeEdge(edge, { lines: router.routingLines(edge.id) })!;

    expect(points.at(-1)).toEqual(new Point(520, 165));
    expect(new Polyline(points).isOrthogonal()).toBe(true);
  });

  it('routes an association through its own rules', async () => {
    const plane = await planeOf('models/incremental/collabnote.bpmn');

    expect(new EdgeRouter(plane).routeEdge(plane.edges.get('As')!, { lines: [] })).toHaveLength(2);
  });

  it('has no route for a flow with a missing end', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const edge = plane.edges.get('F2')!;
    edge.targetId = undefined;
    const twin = plane.edges.get('F3')!;
    twin.sourceId = undefined;

    expect(new EdgeRouter(plane).routeEdge(edge, { lines: [] })).toBeUndefined();
    expect(new EdgeRouter(plane).routeEdge(twin, { lines: [] })).toBeUndefined();
  });

  it('answers for its damage checks', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const router = new EdgeRouter(plane, new Set(['C']));
    const edge = plane.edges.get('F2')!;

    expect(router.brokenEdge(edge, router.edgeBefore(edge))).toBe(false);
    expect(router.detachedEnds(edge)).toEqual([]);
    expect(router.grazes(edge, ['D'])).toBe(false);
    expect(router.touchesFresh(edge)).toBe(false);
  });
});
