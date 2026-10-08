/**
 * Connections and labels in a kept drawing: src/diagram/reroute.ts (routing
 * one connection with the BPMN side conventions, deciding which kept
 * connections need a new route), src/diagram/labels.ts (label placement)
 * and the text rendering of the layout block (src/format.ts renderLayout).
 */
import { describe, expect, it } from 'vitest';
import type { DEdge, DShape, Plane } from '../src/diagram/plane.js';
import { brokenEdge, edgeBefore, routeEdge, routingLines } from '../src/diagram/reroute.js';
import { labelAt, placeEdgeLabel, placeShapeLabel, refitLabel } from '../src/diagram/labels.js';
import { renderLayout } from '../src/format.js';
import { Doc } from '../src/document.js';
import type { El } from '../src/model.js';

/** A real element for `type` with `name` (labels read the name, routing the type). */
const els = Doc.create({ processId: 'P' });
function el(type: string, id: string, name?: string): El {
  return els.moddle.create(type, { id, ...(name ? { name } : {}) });
}

function sh(id: string, kind: DShape['kind'], b: [number, number, number, number], extra: Partial<DShape> = {}, name?: string): DShape {
  const type = kind === 'task' ? 'bpmn:Task' : kind === 'gateway' ? 'bpmn:ExclusiveGateway' : kind === 'boundary' ? 'bpmn:BoundaryEvent' : kind === 'participant' ? 'bpmn:Participant' : 'bpmn:EndEvent';
  return { id, el: el(type, id, name), kind, container: kind === 'participant', bounds: { x: b[0], y: b[1], width: b[2], height: b[3] }, ...extra };
}

function ed(id: string, kind: DEdge['kind'], sourceId: string, targetId: string, pts: Array<[number, number]> = [], name?: string): DEdge {
  const type = kind === 'sequenceFlow' ? 'bpmn:SequenceFlow' : kind === 'messageFlow' ? 'bpmn:MessageFlow' : 'bpmn:Association';
  return { id, el: el(type, id, name), kind, sourceId, targetId, points: pts.map(([x, y]) => ({ x, y })) };
}

function plane(shapes: DShape[], edges: DEdge[] = []): Plane {
  return { id: 'p', rootId: 'r', root: el('bpmn:Process', 'r'), shapes: new Map(shapes.map((s) => [s.id, s])), edges: new Map(edges.map((e) => [e.id, e])), dropped: [] };
}

describe('routeEdge', () => {
  it('draws a straight flow between facing tasks and leaves a boundary event through its border', () => {
    const p = plane(
      [sh('A', 'task', [100, 100, 100, 80]), sh('B', 'task', [300, 100, 100, 80]), sh('BE', 'boundary', [160, 162, 36, 36], { hostId: 'A' }), sh('X', 'event', [400, 300, 36, 36])],
      [ed('F', 'sequenceFlow', 'A', 'B'), ed('FX', 'sequenceFlow', 'BE', 'X')],
    );
    expect(routeEdge(p, p.edges.get('F')!, { lines: [] })).toEqual([{ x: 200, y: 140 }, { x: 300, y: 140 }]);
    const fx = routeEdge(p, p.edges.get('FX')!, { lines: [] })!;
    expect(fx[0]).toEqual({ x: 178, y: 198 });
    expect(fx[1]!.x).toBe(178);
  });

  it('routes message flows vertically and avoids foreign pools', () => {
    const p = plane(
      [sh('Up', 'participant', [0, 0, 600, 100]), sh('Mid', 'participant', [0, 150, 300, 100]), sh('Down', 'participant', [0, 300, 600, 100]), sh('T', 'task', [400, 310, 100, 80], { poolId: 'Down' })],
      [ed('M', 'messageFlow', 'Up', 'T')],
    );
    const pts = routeEdge(p, p.edges.get('M')!, { lines: [] })!;
    expect(pts[0]!.y).toBe(100);
    expect(pts[pts.length - 1]!.y).toBe(310);
    expect(pts.every((q) => q.x > 300)).toBe(true);
  });

  it('keeps an association straight when nothing is in the way', () => {
    const p = plane([sh('A', 'task', [100, 100, 100, 80]), sh('N', 'event', [260, 0, 36, 36])], [ed('As', 'association', 'N', 'A')]);
    const pts = routeEdge(p, p.edges.get('As')!, { lines: [] })!;
    expect(pts).toHaveLength(2);
  });
});

describe('brokenEdge', () => {
  const setup = (): Plane =>
    plane([sh('A', 'task', [100, 100, 100, 80]), sh('B', 'task', [300, 100, 100, 80]), sh('C', 'task', [100, 300, 100, 80])], [ed('F', 'sequenceFlow', 'A', 'B', [[200, 140], [300, 140]])]);

  it('keeps an intact connection', () => {
    const p = setup();
    expect(brokenEdge(p, p.edges.get('F')!, edgeBefore(p, p.edges.get('F')!))).toBe(false);
  });

  it('flags a connection whose end lost its shape, that turned diagonal, or now cuts a shape', () => {
    let p = setup();
    let before = edgeBefore(p, p.edges.get('F')!);
    p.shapes.get('B')!.bounds.y += 50;
    expect(brokenEdge(p, p.edges.get('F')!, before)).toBe(true);
    p = setup();
    before = edgeBefore(p, p.edges.get('F')!);
    p.edges.get('F')!.points[1] = { x: 300, y: 150 };
    expect(brokenEdge(p, p.edges.get('F')!, before)).toBe(true);
    p = setup();
    before = edgeBefore(p, p.edges.get('F')!);
    p.shapes.set('N', sh('N', 'event', [230, 122, 36, 36]));
    expect(brokenEdge(p, p.edges.get('F')!, before)).toBe(true);
  });

  it('does not reroute a hand-drawn connection for a defect it already had', () => {
    const p = setup();
    p.shapes.set('N', sh('N', 'event', [230, 122, 36, 36]));
    const before = edgeBefore(p, p.edges.get('F')!);
    expect(before.cut.has('N')).toBe(true);
    expect(brokenEdge(p, p.edges.get('F')!, before)).toBe(false);
  });

  it('feeds labels to the router as diagonals', () => {
    const p = setup();
    p.shapes.get('A')!.label = { x: 120, y: 190, width: 60, height: 14 };
    expect(routingLines(p)).toContainEqual([{ x: 120, y: 190 }, { x: 180, y: 204 }]);
    expect(routingLines(p, 'F')).not.toContainEqual(p.edges.get('F')!.points);
  });
});

describe('labels', () => {
  it('puts event labels below and gateway labels above, off lines and shapes', () => {
    const p = plane([sh('E', 'event', [100, 100, 36, 36], {}, 'Done'), sh('G', 'gateway', [300, 100, 50, 50], {}, 'ok?')]);
    expect(placeShapeLabel(p, p.shapes.get('E')!)!.y).toBe(142);
    expect(placeShapeLabel(p, p.shapes.get('G')!)!.y).toBeLessThan(100);
    // a line right below the event pushes its label to the next side
    p.edges.set('L', ed('L', 'sequenceFlow', 'X', 'Y', [[0, 148], [400, 148]]));
    const box = placeShapeLabel(p, p.shapes.get('E')!)!;
    expect(box.y + box.height).toBeLessThanOrEqual(100);
    expect(placeShapeLabel(p, p.shapes.get('E')!, 'right')!.x).toBeGreaterThan(136);
  });

  it('hangs a boundary label below the host, right of the event', () => {
    const p = plane([sh('H', 'task', [100, 100, 100, 80]), sh('B', 'boundary', [160, 162, 36, 36], { hostId: 'H' }, 'Late')]);
    const box = placeShapeLabel(p, p.shapes.get('B')!)!;
    expect(box).toMatchObject({ x: 200, y: 182 });
    expect(labelAt(p.shapes.get('B')!, { width: 30, height: 14 }, 'below', p.shapes.get('H')!)).toMatchObject({ x: 200, y: 182 });
  });

  it('puts a flow label above its first long horizontal segment, near the start', () => {
    const p = plane([], [ed('F', 'sequenceFlow', 'A', 'B', [[100, 100], [100, 200], [400, 200]], 'yes')]);
    const box = placeEdgeLabel(p, p.edges.get('F')!)!;
    expect(box.y + box.height).toBe(196);
    expect(box.x).toBe(108);
  });

  it('refits a renamed label on the side it was on', () => {
    const p = plane([sh('E', 'event', [100, 100, 36, 36], {}, 'Everything has been booked and archived')]);
    const e = p.shapes.get('E')!;
    e.label = { x: 98, y: 142, width: 40, height: 14 };
    const box = refitLabel(p, e)!;
    expect(box.y).toBe(142);
    expect(box.height).toBeGreaterThan(14);
    expect(box.x + box.width / 2).toBeCloseTo(118, 0);
  });
});

describe('renderLayout', () => {
  it('prints the mode, what changed and the quality delta', () => {
    const lines = renderLayout({
      status: 'ok',
      mode: 'incremental',
      reason: 'hand-made diagram: kept, changes placed locally',
      warnings: [],
      expanded: [],
      placed: ['N', 'Flow_1'],
      moved: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
      rerouted: [],
      pruned: ['X'],
      notes: ['Sub drawn collapsed'],
      metrics: {
        before: { counts: {} as never, score: 3 },
        after: { counts: {} as never, score: 8 },
        added: [{ kind: 'crossings', ids: ['F1', 'F2'] }],
        resolved: [{ kind: 'labelOnLine', ids: ['E', 'F3'] }],
      },
    });
    expect(lines).toEqual([
      'layout: ok - incremental (hand-made diagram: kept, changes placed locally)',
      '  placed: N, Flow_1',
      '  moved: A, B, C, D, E, F, G, H (+1 more)',
      '  pruned: X',
      '  note: Sub drawn collapsed',
      'layout quality: score 3 -> 8; added: crossings [F1, F2]; resolved: labelOnLine [E, F3]',
    ]);
    expect(renderLayout({ status: 'skipped', warnings: [], expanded: [] })).toEqual(['layout: skipped']);
  });
});
