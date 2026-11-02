import { describe, expect, it } from 'vitest';
import { Drawing } from '../../../src/drawing/incremental/Drawing.js';
import { OperationBefore } from '../../../src/drawing/incremental/OperationBefore.js';
import type { Plane } from '../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { Semantics } from '../../../src/drawing/plane/Semantics.js';
import { TrialGuard } from '../../../src/drawing/plane/TrialGuard.js';
import { Fixtures } from '../../support/Fixtures.js';
import { Box, ElementHomes, Point, Polyline } from '../../support/ModelValues.js';

describe('Drawing', () => {
  async function drawingOf(path = 'models/incremental/boundary.bpmn') {
    const document = await Fixtures.read(path);
    const plane = new PlaneReader(document.tree.definitions).planes()[0]!;
    return { document, plane, drawing: new Drawing(plane) };
  }

  it('undoes a change through a checkpoint', async () => {
    const { plane, drawing } = await drawingOf();
    const checkpoint = drawing.checkpoint();
    plane.shapes.get('C')!.bounds.x += 100;
    checkpoint.restore();

    expect(plane.shapes.get('C')!.bounds.x).toBe(400);
  });

  it('orders lines by their rank', async () => {
    const { plane, drawing } = await drawingOf('models/incremental/polish-collab.bpmn');

    expect(drawing.routeOrder([plane.edges.get('M1')!, plane.edges.get('F1')!]).map(({ id }) => id)).toEqual(['F1', 'M1']);
  });

  it('reroutes a line onto its shapes', async () => {
    const { plane, drawing } = await drawingOf();
    const edge = plane.edges.get('F2')!;
    plane.shapes.get('C')!.bounds.y += 60;

    expect(drawing.reroute(edge)).toBe(true);
    expect(plane.shapes.get('C')!.bounds.contains(edge.points.at(-1)!, 1)).toBe(true);
  });

  it('reroutes on the lines and sides it is given', async () => {
    const { plane, drawing } = await drawingOf();
    const edge = plane.edges.get('F2')!;

    expect(drawing.reroute(edge, { lines: [], sourceSides: ['top'], targetSides: ['top'] })).toBe(true);
    expect(edge.points[0]!.y).toBe(80);
  });

  it('reports a line it cannot route', async () => {
    const { plane, drawing } = await drawingOf();
    const edge = plane.edges.get('F2')!;
    edge.targetId = undefined;

    expect(drawing.reroute(edge)).toBe(false);
  });

  it('moves the label of a named line with its new route', async () => {
    const { plane, drawing } = await drawingOf('models/incremental/polish-lanes.bpmn');
    const edge = plane.edges.get('f2')!;
    const old = edge.label!.copy();
    drawing.adoptRoute(edge, [new Point(300, 100), new Point(360, 100)]);

    expect(edge.label).not.toEqual(old);
    expect(edge.points).toHaveLength(2);
  });

  it('leaves an unlabelled line without label', async () => {
    const { plane, drawing } = await drawingOf('models/incremental/polish-lanes.bpmn');
    const edge = plane.edges.get('f1')!;
    drawing.adoptRoute(edge, [new Point(208, 165), new Point(250, 165)]);

    expect(edge.label).toBeUndefined();
  });

  it('moves a label a fresh line runs through to the same side', async () => {
    const { plane, drawing } = await drawingOf();
    const shape = plane.shapes.get('E2')!;
    const label = shape.label!;
    const edge = plane.edges.get('F1')!;
    edge.points = [new Point(label.center.x, label.y - 5), new Point(label.center.x, label.bottom + 5)];
    drawing.clearLabels([edge]);

    expect(new Polyline(edge.points).hits(shape.label!, 1)).toBe(false);
  });

  it('asks for any free side when the label sits inside its shape', async () => {
    const { plane, drawing } = await drawingOf();
    const shape = plane.shapes.get('E2')!;
    const inside = new Box(shape.bounds.x + 2, shape.bounds.y + 2, 20, 20);
    shape.label = inside;
    const edge = plane.edges.get('F1')!;
    edge.points = [new Point(inside.center.x, inside.y - 5), new Point(inside.center.x, inside.bottom + 5)];
    drawing.clearLabels([edge]);

    expect(shape.label).not.toBe(inside);
  });

  it('leaves labels no fresh line touches, and those of shapes with inner labels', async () => {
    const { plane, drawing } = await drawingOf();
    const label = plane.shapes.get('E2')!.label;
    const task = plane.shapes.get('C')!;
    task.label = new Box(450, 100, 10, 10);
    drawing.clearLabels([plane.edges.get('F2')!]);

    expect(plane.shapes.get('E2')!.label).toBe(label);
    expect(task.label.x).toBe(450);
  });

  it('settles: translates a line whose ends moved alike', async () => {
    const { plane, drawing } = await drawingOf();
    const before = new OperationBefore([drawing]);
    plane.shapes.get('C')!.bounds.translate(0, 60);
    plane.shapes.get('D')!.bounds.translate(0, 60);
    const rerouted = drawing.settle(before);

    expect(plane.edges.get('F3')!.points.map(({ y }) => y)).toEqual([180, 180]);
    expect(rerouted).toEqual(['F2', 'F4']);
  });

  it('settles the lines of a drawing whose shapes moved after the operation', async () => {
    const { drawing: before } = await drawingOf();
    const { plane, drawing: after } = await drawingOf('drawing/incremental/shapes-moved.bpmn');
    const rerouted = after.settle(new OperationBefore([before]));

    expect(rerouted).toEqual(['F2', 'F4']);
    expect(plane.edges.get('F3')!.points.map(({ y }) => y)).toEqual([180, 180]);
    expect(after.routes.detachedEnds(plane.edges.get('F2')!)).toEqual([]);
  });

  it('settles: keeps a line that a resized shape still reaches', async () => {
    const { plane, drawing } = await drawingOf();
    const before = new OperationBefore([drawing]);
    plane.shapes.get('C')!.bounds.width += 1;

    expect(drawing.settle(before)).toEqual([]);
  });

  it('settles: moves a label off a title it now lies on', async () => {
    const { plane, drawing } = await drawingOf('models/incremental/polish-collab.bpmn');
    const before = new OperationBefore([drawing]);
    const sub = plane.shapes.get('ESP')!;
    sub.bounds.translate(0, 40);
    sub.bounds.height -= 40;
    drawing.settle(before);

    expect(plane.shapes.get('ES')!.label).toBeDefined();
  });

  function guardOver(plane: Plane, document: Awaited<ReturnType<typeof drawingOf>>['document']): TrialGuard {
    return new TrialGuard([plane], new ElementHomes(document));
  }

  it('keeps an attempt that makes the drawing no worse and reroutes what it broke', async () => {
    const { plane, drawing, document } = await drawingOf();
    const guard = guardOver(plane, document);
    const kept = drawing.attempt(guard, () => drawing.space.makeSpace({ axis: 'x', line: 390, delta: 40 }));

    expect(kept).toBe(true);
    expect(plane.shapes.get('C')!.bounds.x).toBe(440);
  });

  it('undoes an attempt that changes nothing or gives up', async () => {
    const { plane, drawing, document } = await drawingOf();
    const guard = guardOver(plane, document);

    expect(drawing.attempt(guard, () => undefined)).toBe(false);
    expect(drawing.attempt(guard, () => ({ moved: new Set(), resized: new Set() }))).toBe(false);
    expect(plane.shapes.get('C')!.bounds.x).toBe(400);
  });

  it('undoes an attempt that makes the drawing worse', async () => {
    const { plane, drawing, document } = await drawingOf();
    const guard = guardOver(plane, document);
    const task = plane.shapes.get('C')!;
    const kept = drawing.attempt(guard, () => {
      task.bounds.x = plane.shapes.get('A')!.bounds.x;
      return { moved: new Set(['C']), resized: new Set() };
    });

    expect(kept).toBe(false);
    expect(task.bounds.x).toBe(400);
  });

  it('forces the lines it is told to reroute', async () => {
    const { plane, drawing, document } = await drawingOf();
    const guard = guardOver(plane, document);
    const edge = plane.edges.get('F3')!;
    edge.points = [new Point(500, 120), new Point(530, 120), new Point(560, 120)];
    drawing.attempt(guard, () => ({ moved: new Set(['F3']), resized: new Set() }), ['F3']);

    expect(edge.points).toHaveLength(2);
  });

  it('builds its parts on the fresh and touched sets it is given', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const semantics = Semantics.of(document.tree.definitions);
    const plane = new PlaneReader(document.tree.definitions, semantics).planes()[0]!;
    const touched = new Set<string>();
    const drawing = new Drawing(plane, touched, new Set(['C']));
    const host = plane.shapes.get('A')!;
    const old = host.bounds.copy();
    host.bounds = new Box(old.x, old.y, 200, old.height);
    drawing.frames.reseatBoundaries(host, old);

    expect(touched.has('B')).toBe(true);
  });
});
