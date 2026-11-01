import { describe, expect, it } from 'vitest';
import { LabelPlacer } from '../../../../src/drawing/incremental/labels/LabelPlacer.js';
import { Frames } from '../../../../src/drawing/plane/Frames.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box } from '../../../support/ModelValues.js';

describe('LabelPlacer', () => {
  async function planeOf(path: string) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  it('places the label of an event on its first free side', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const shape = plane.shapes.get('End_1')!;
    const label = new LabelPlacer(plane).placeShapeLabel(shape)!;

    expect(label.y).toBeGreaterThanOrEqual(shape.bounds.bottom);
  });

  it('prefers the side it is told and takes it even when all spots collide', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const shape = plane.shapes.get('End_1')!;

    expect(new LabelPlacer(plane).placeShapeLabel(shape, 'above')!.bottom).toBeLessThanOrEqual(shape.bounds.y);
  });

  it('places nothing for a shape without a name or an inner label', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const placer = new LabelPlacer(plane);

    expect(placer.placeShapeLabel(plane.shapes.get('Gw_Join')!)).toBeUndefined();
    expect(placer.placeShapeLabel(plane.shapes.get('Task_A')!)).toBeUndefined();
  });

  it('keeps the label of a boundary event outside its host', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const shape = plane.shapes.get('Timer_1')!;
    const host = plane.shapes.get('Task_A')!;

    expect(new LabelPlacer(plane).placeShapeLabel(shape)!.overlaps(host.bounds)).toBe(false);
  });

  it('keeps a label inside the sub-process of its shape', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const shape = plane.shapes.get('ES')!;
    const label = new LabelPlacer(plane).placeShapeLabel(shape)!;

    expect(label.isInside(plane.shapes.get('ESP')!.bounds)).toBe(true);
  });

  it('falls back on a spot outside the frame rather than on clutter', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const shape = plane.shapes.get('S')!;
    const pool = plane.shapes.get('Org')!;
    pool.bounds = new Box(170, 220, 40, 40);

    expect(new LabelPlacer(plane).placeShapeLabel(shape)!.overlaps(shape.bounds)).toBe(false);
  });

  it('sets a label beside a shape on the side it is asked for', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const shape = plane.shapes.get('Timer_1')!;
    const label = new LabelPlacer(plane).labelOnSide(shape, 'left', { width: 40, height: 14 });

    expect(label.right).toBeLessThanOrEqual(shape.bounds.center.x);
  });

  it('labels a flow on a run it fits on', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const edge = plane.edges.get('f3')!;
    const label = new LabelPlacer(plane).placeEdgeLabel(edge)!;

    expect(label).toBe(edge.label);
    expect(label.width).toBeGreaterThan(0);
  });

  it('labels only named flows with a line', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const placer = new LabelPlacer(plane);
    const named = plane.edges.get('f3')!;
    const anonymous = plane.edges.get('f1')!;
    named.points = [];

    expect(placer.placeEdgeLabel(named)).toBeUndefined();
    expect(placer.placeEdgeLabel(anonymous)).toBeUndefined();
  });

  it('labels no association', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');

    expect(new LabelPlacer(plane).placeEdgeLabel(plane.edges.get('Assoc_1')!)).toBeUndefined();
  });

  it('moves a label off a title it was clear of before', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const shape = plane.shapes.get('ES')!;
    const sub = plane.shapes.get('ESP')!;
    shape.label = Frames.title(sub)!.copy();
    const cleared = new LabelPlacer(plane).clearTitles(() => true);

    expect(cleared).toEqual([['ES', 'ESP']]);
    expect(shape.label.overlaps(Frames.title(sub)!)).toBe(false);
  });

  it('leaves a label that sat on the title before', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const shape = plane.shapes.get('ES')!;
    const sub = plane.shapes.get('ESP')!;
    const label = Frames.title(sub)!.copy();
    shape.label = label;

    expect(new LabelPlacer(plane).clearTitles(() => false)).toEqual([]);
    expect(shape.label).toBe(label);
  });

  it('moves the label of a flow off a title too', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const sub = plane.shapes.get('J')!;
    sub.kind = 'subProcess';
    sub.container = true;
    const edge = plane.edges.get('f3')!;
    edge.label = Frames.title(sub)?.copy();

    expect(new LabelPlacer(plane).clearTitles(() => true).length).toBe(edge.label && sub.el.name ? 1 : 0);
  });

  it('has nothing to clear on a plane without titles', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');

    expect(new LabelPlacer(plane).clearTitles(() => true)).toEqual([]);
  });

  it('keeps the old label when the new spot would still leave the frame', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const shape = plane.shapes.get('ES')!;
    const sub = plane.shapes.get('ESP')!;
    const label = Frames.title(sub)!.copy();
    shape.label = label;
    shape.parentId = 'ESP2';

    expect(new LabelPlacer(plane).clearTitles(() => true)).toEqual([]);
    expect(shape.label).toBe(label);
  });

  it('refits a renamed label on the side it sits, grown from its middle', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const shape = plane.shapes.get('E2')!;
    const before = shape.label!.copy();
    const label = new LabelPlacer(plane).refitLabel(shape)!;

    expect(label.y).toBe(before.y);
    expect(label.center.x).toBeCloseTo(before.center.x, -1);
  });

  it('refits a label above, right and left of its shape', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const placer = new LabelPlacer(plane);
    const end = plane.shapes.get('End_2')!;

    end.label = new Box(end.bounds.x, end.bounds.y - 20, 30, 14);
    expect(placer.refitLabel(end)!.bottom).toBe(end.bounds.y - 6);
    end.label = new Box(end.bounds.right + 5, end.bounds.y, 30, 14);
    expect(placer.refitLabel(end)!.x).toBe(end.bounds.right + 5);
    plane.edges.delete('F10');
    plane.shapes.get('Task_Esc')!.bounds.x = 200;
    end.label = new Box(end.bounds.x - 40, end.bounds.y, 30, 14);
    expect(placer.refitLabel(end)!.right).toBe(end.bounds.x - 10);
  });

  it('places a label anew when the refit would collide', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const shape = plane.shapes.get('E2')!;
    shape.label = new Box(shape.bounds.x, 150, 30, 14);
    const task = plane.shapes.get('C')!;
    task.bounds = new Box(shape.bounds.x, shape.bounds.bottom + 2, 100, 80);

    expect(new LabelPlacer(plane).refitLabel(shape)).toBe(shape.label);
  });

  it('refits by placing when a shape has no label yet, and leaves the rest', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const placer = new LabelPlacer(plane);
    const task = plane.shapes.get('T1')!;
    const gateway = plane.shapes.get('G1')!;
    gateway.label = undefined;

    expect(placer.refitLabel(task)).toBeUndefined();
    expect(placer.refitLabel(gateway)).toBe(gateway.el.name ? gateway.label : undefined);
    expect(placer.refitLabel(plane.edges.get('f3')!)).toBeDefined();
    expect(placer.refitLabel(plane.edges.get('f1')!)).toBeUndefined();
  });
});
