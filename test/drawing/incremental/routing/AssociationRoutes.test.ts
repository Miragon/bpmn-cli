import { describe, expect, it } from 'vitest';
import { AssociationRoutes } from '../../../../src/drawing/incremental/routing/AssociationRoutes.js';
import { EdgeDamage } from '../../../../src/drawing/incremental/routing/EdgeDamage.js';
import { DEdge } from '../../../../src/drawing/plane/DEdge.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Polyline } from '../../../support/ModelValues.js';

describe('AssociationRoutes', () => {
  async function planeOf(path = 'models/incremental/collabnote.bpmn') {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function routesOf(plane: Awaited<ReturnType<typeof planeOf>>, fresh: Iterable<string> = []): AssociationRoutes {
    return new AssociationRoutes(plane, new EdgeDamage(plane, new Set(fresh)));
  }

  it('draws a free association straight between its shapes', async () => {
    const plane = await planeOf();
    const edge = plane.edges.get('As')!;
    const points = routesOf(plane).route(edge, [])!;

    expect(points).toHaveLength(2);
    expect(plane.shapes.get('Q')!.bounds.contains(points[0]!, 1)).toBe(true);
    expect(plane.shapes.get('Note')!.bounds.contains(points[1]!, 1)).toBe(true);
  });

  it('routes around a shape on the straight line', async () => {
    const plane = await planeOf();
    const edge = plane.edges.get('As')!;
    const way = plane.shapes.get('A')!;
    plane.shapes.get('Note')!.bounds.translate(-290, -300);
    plane.shapes.get('Q')!.bounds.translate(-400, 0);
    way.bounds.translate(0, 100);
    const points = routesOf(plane).route(edge, [])!;

    expect(new Polyline(points).hits(way.bounds)).toBe(false);
  });

  it('routes around a shape placed in this run even when it only grazes the line', async () => {
    const plane = await planeOf();
    const edge = plane.edges.get('As')!;
    plane.shapes.get('E3')!.bounds.translate(-140, -30);

    expect(routesOf(plane, ['E3']).route(edge, [])!.length).toBeGreaterThanOrEqual(2);
  });

  it('has no route without both anchors', async () => {
    const plane = await planeOf();
    const edge = plane.edges.get('As')!;
    edge.targetId = 'gone';

    expect(routesOf(plane).route(edge, [])).toBeUndefined();
  });

  function associationOnFlow(plane: Awaited<ReturnType<typeof planeOf>>, ends: [string, string]): DEdge {
    const edge = new DEdge('onFlow', plane.edges.get('As')!.el, 'association');
    [edge.sourceId, edge.targetId] = ends;
    plane.edges.set(edge.id, edge);
    return edge;
  }

  it('docks a shape on the nearest spot of a flow', async () => {
    const plane = await planeOf();
    const points = routesOf(plane).route(associationOnFlow(plane, ['Note', 'H2']), [])!;

    expect(points.at(-1)?.y).toBe(460);
    expect(points).toHaveLength(2);
  });

  it('runs the same dock backwards when the shape is the target', async () => {
    const plane = await planeOf();
    const points = routesOf(plane).route(associationOnFlow(plane, ['H2', 'Note']), [])!;

    expect(points[0]?.y).toBe(460);
  });

  it('routes to the flow when every straight way is blocked', async () => {
    const plane = await planeOf();
    const wall = plane.shapes.get('Z')!;
    wall.bounds.x = 720;
    wall.bounds.y = 412;
    wall.bounds.width = 220;
    wall.bounds.height = 20;
    const points = routesOf(plane).route(associationOnFlow(plane, ['Note', 'H2']), [])!;

    expect(new Polyline(points).hits(wall.bounds)).toBe(false);
    expect(points.length).toBeGreaterThan(2);
  });

  it('skips a very short run of the flow and reverses a routed dock for a target shape', async () => {
    const plane = await planeOf();
    const flow = plane.edges.get('H2')!;
    const { x, y } = flow.points[0]!;
    flow.points.splice(1, 0, flow.points[0]!.copy(), flow.points[0]!.copy());
    flow.points[1]!.translate(5, 0);
    flow.points[2]!.translate(5, 0);
    const wall = plane.shapes.get('Z')!;
    wall.bounds.x = 720;
    wall.bounds.y = 412;
    wall.bounds.width = 220;
    wall.bounds.height = 20;
    const points = routesOf(plane).route(associationOnFlow(plane, ['H2', 'Note']), [])!;

    expect(points[0]!.y).toBe(y);
    expect(points[0]!.x).toBeGreaterThan(x + 5);
  });

  it('anchors a straight line on the longest run of a flow without a shape end', async () => {
    const plane = await planeOf();
    const edge = associationOnFlow(plane, ['H1', 'H2']);

    expect(routesOf(plane).route(edge, [])).toHaveLength(2);
  });

  it('has no dock on a flow without a line', async () => {
    const plane = await planeOf();
    plane.edges.get('H2')!.points = [];

    expect(routesOf(plane).route(associationOnFlow(plane, ['Note', 'H2']), [])).toBeUndefined();
  });
});
