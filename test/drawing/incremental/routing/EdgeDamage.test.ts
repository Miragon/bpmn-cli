import { describe, expect, it } from 'vitest';
import { EdgeDamage } from '../../../../src/drawing/incremental/routing/EdgeDamage.js';
import { PlaneEdge } from '../../../../src/drawing/plane/PlaneEdge.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('EdgeDamage', () => {
  async function planeOf(path = 'models/incremental/boundary.bpmn') {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  it('finds the point of a line closest to a spot', () => {
    const nearest = EdgeDamage.nearestOn([new Point(0, 0), new Point(100, 0), new Point(100, 100)], new Point(130, 40));

    expect(nearest).toEqual(new Point(100, 40));
    expect(EdgeDamage.nearestOn([new Point(5, 5), new Point(5, 5)], new Point(0, 0))).toEqual(new Point(5, 5));
  });

  it('calls a line whole while its ends stay on their shapes', async () => {
    const plane = await planeOf();
    const damage = new EdgeDamage(plane, new Set());
    const edge = plane.edges.get('F2')!;

    expect(damage.broken(edge, damage.edgeBefore(edge), true)).toBe(false);
  });

  it('calls a line broken when an end moved away from its shape', async () => {
    const plane = await planeOf();
    const damage = new EdgeDamage(plane, new Set());
    const edge = plane.edges.get('F2')!;
    const before = damage.edgeBefore(edge);
    plane.shapes.get('C')!.bounds.y += 200;

    expect(damage.detachedEnds(edge)).toEqual(['C']);
    expect(damage.broken(edge, before, true)).toBe(true);
    expect(damage.broken(edge, before, false)).toBe(true);
  });

  it('calls a line broken when a shape moved onto it, and not when it already cut that shape', async () => {
    const plane = await planeOf();
    const damage = new EdgeDamage(plane, new Set());
    const edge = plane.edges.get('F3')!;
    plane.shapes.get('E2')!.bounds.translate(238, -130);

    expect(damage.broken(edge, damage.edgeBefore(plane.edges.get('F1')!), true)).toBe(true);
    expect(damage.edgeBefore(edge).cut).toEqual(new Set(['E2']));
    expect(damage.broken(edge, damage.edgeBefore(edge), true)).toBe(false);
  });

  it('calls a flow broken when it loses its right angles', async () => {
    const plane = await planeOf();
    const damage = new EdgeDamage(plane, new Set());
    const edge = plane.edges.get('F3')!;
    const before = damage.edgeBefore(edge);
    edge.points = [new Point(500, 120), new Point(530, 100), new Point(560, 120)];

    expect(damage.broken(edge, before, true)).toBe(true);
    expect(damage.broken(edge, damage.edgeBefore(edge), true)).toBe(false);
  });

  it('calls a line of one spot broken', async () => {
    const plane = await planeOf();
    const edge = plane.edges.get('F3')!;
    edge.points = [new Point(500, 120), new Point(500, 120)];

    expect(new EdgeDamage(plane, new Set()).broken(edge, undefined, true)).toBe(true);
  });

  it('sees no detached ends on a line without points', async () => {
    const plane = await planeOf();
    const edge = plane.edges.get('F3')!;
    edge.points = [];

    expect(new EdgeDamage(plane, new Set()).detachedEnds(edge)).toEqual([]);
  });

  it('measures the gap of an end that docks on another line', async () => {
    const plane = await planeOf();
    const element = plane.edges.get('F1')!.el;
    const note = new PlaneEdge('note', element, 'association', [new Point(250, 300), new Point(530, 130)]);
    note.sourceId = 'E2';
    note.targetId = 'F3';
    plane.edges.set('note', note);
    const damage = new EdgeDamage(plane, new Set());
    const before = damage.edgeBefore(note);
    note.points = [new Point(250, 300), new Point(530, 90)];

    expect(before.targetGap).toBe(10);
    expect(damage.broken(note, before, true)).toBe(true);
  });

  it('allows a round shape the gap to its border', async () => {
    const plane = await planeOf();
    const damage = new EdgeDamage(plane, new Set());

    expect(damage.edgeBefore(plane.edges.get('F1')!).sourceGap).toBe(0);
  });

  it('ignores the shapes on the ends of a line that grazes others', async () => {
    const plane = await planeOf();
    const damage = new EdgeDamage(plane, new Set());
    const edge = plane.edges.get('F5')!;

    expect(damage.grazes(edge, ['B', 'A', 'E2'])).toBe(false);
    expect(damage.grazes(plane.edges.get('F2')!, ['B', 'C', 'E'], { margin: 1 })).toBe(false);
    expect(damage.grazes(edge, ['C'], { points: [new Point(450, 0), new Point(450, 200)] })).toBe(true);
  });

  it('counts a label as grazed only when asked', async () => {
    const plane = await planeOf();
    const damage = new EdgeDamage(plane, new Set());
    const edge = plane.edges.get('F1')!;
    const label = plane.shapes.get('E2')!.label ?? new Box(0, 0, 1, 1);
    const across = [new Point(label.center.x, label.y - 5), new Point(label.center.x, label.bottom + 5)];

    expect(damage.grazes(edge, ['E2'], { points: across })).toBe(false);
    expect(damage.grazes(edge, ['E2'], { points: across, labels: true })).toBe(true);
  });

  it('sees no grazing on a line without points', async () => {
    const plane = await planeOf();

    expect(new EdgeDamage(plane, new Set(['C'])).grazes(plane.edges.get('F1')!, ['C'], { points: [] })).toBe(false);
  });

  it('checks only associations against the shapes placed in this run', async () => {
    const plane = await planeOf('models/incremental/collabnote.bpmn');
    const damage = new EdgeDamage(plane, new Set(['S2']));
    const across = [new Point(100, 460), new Point(300, 460)];

    expect(damage.touchesFresh(plane.edges.get('As')!, across)).toBe(true);
    expect(damage.touchesFresh(plane.edges.get('As')!)).toBe(false);
    expect(damage.touchesFresh(plane.edges.get('H1')!, across)).toBe(false);
  });

  it('keeps out the hosts around a boundary event from the cut shapes', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const damage = new EdgeDamage(plane, new Set());

    expect(damage.edgeBefore(plane.edges.get('F9')!).cut).toEqual(new Set());
  });
});
