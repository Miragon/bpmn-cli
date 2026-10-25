/**
 * Connections and labels in a kept drawing: src/layout/incremental/EdgeRouter.ts (routing
 * one connection with the BPMN side conventions, deciding which kept
 * connections need a new route), src/layout/incremental/LabelPlacer.ts (label placement)
 * and the text rendering of the layout block (src/report/utils/result-lines.ts renderLayout).
 */
import { describe, expect, it } from 'vitest';
import type { DEdge, DShape, Plane } from '../src/drawing/types.js';
import { crossings } from '../src/drawing/utils/routing.js';
import { labelAt } from '../src/drawing/utils/labels.js';
import { renderLayout } from '../src/report/utils/result-lines.js';
import { Doc } from '../src/model/Doc.js';
import { Drawing } from '../src/layout/incremental/Drawing.js';
import type { El } from '../src/model/utils/moddle.js';

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
    expect(new Drawing(p).route(p.edges.get('F')!, { lines: [] })).toEqual([{ x: 200, y: 140 }, { x: 300, y: 140 }]);
    const fx = new Drawing(p).route(p.edges.get('FX')!, { lines: [] })!;
    expect(fx[0]).toEqual({ x: 178, y: 198 });
    expect(fx[1]!.x).toBe(178);
  });

  it('routes message flows vertically and avoids foreign pools', () => {
    const p = plane(
      [sh('Up', 'participant', [0, 0, 600, 100]), sh('Mid', 'participant', [0, 150, 300, 100]), sh('Down', 'participant', [0, 300, 600, 100]), sh('T', 'task', [400, 310, 100, 80], { poolId: 'Down' })],
      [ed('M', 'messageFlow', 'Up', 'T')],
    );
    const pts = new Drawing(p).route(p.edges.get('M')!, { lines: [] })!;
    expect(pts[0]!.y).toBe(100);
    expect(pts[pts.length - 1]!.y).toBe(310);
    expect(pts.every((q) => q.x > 300)).toBe(true);
  });

  it('a join entry follows the hook bundle of the other entries into the shared bottom vertex, unless that costs a crossing the way to a free vertex does not', () => {
    // the join J (bottom vertex 325,50) over an end event; three entries rise in the gap right of it and hook in;
    // W takes its left vertex, the new task N lies below the entries' tasks
    const hook = (id: string, y: number): DEdge => ed(id, 'sequenceFlow', id.slice(0, 2), 'J', [[200, y], [385, y], [385, 65], [325, 65], [325, 50]]);
    const setup = (cross: boolean): Plane =>
      plane(
        [
          sh('J', 'gateway', [300, 0, 50, 50]),
          sh('EB', 'event', [307, 90, 36, 36]),
          sh('W', 'task', [100, -15, 100, 80]),
          ...[1, 2, 3].map((k) => sh(`H${k}`, 'task', [100, 20 + 100 * k, 100, 80])),
          sh('N', 'task', [100, 420, 100, 80]),
          ...(cross ? [sh('Y', 'task', [460, 140, 100, 80]), sh('Z', 'event', [230, 162, 36, 36])] : []),
        ],
        [ed('WJ', 'sequenceFlow', 'W', 'J', [[200, 25], [300, 25]]), hook('H1J', 160), hook('H2J', 260), hook('H3J', 360), ed('NJ', 'sequenceFlow', 'N', 'J'), ...(cross ? [ed('YZ', 'sequenceFlow', 'Y', 'Z', [[460, 180], [266, 180]])] : [])],
      );
    let p = setup(false);
    expect(new Drawing(p).route(p.edges.get('NJ')!, { lines: new Drawing(p).routingLines('NJ') })).toEqual([{ x: 200, y: 460 }, { x: 385, y: 460 }, { x: 385, y: 65 }, { x: 325, y: 65 }, { x: 325, y: 50 }]);
    // Y -> Z crosses the bundle's column: joining it would cross that flow, the way to the free top vertex does not
    p = setup(true);
    const pts = new Drawing(p).route(p.edges.get('NJ')!, { lines: new Drawing(p).routingLines('NJ') })!;
    expect(pts.at(-1)).toEqual({ x: 325, y: 0 });
    expect(crossings(pts, new Drawing(p).routingLines('NJ'))).toBe(0);
  });

  it('keeps an association straight when nothing is in the way', () => {
    const p = plane([sh('A', 'task', [100, 100, 100, 80]), sh('N', 'event', [260, 0, 36, 36])], [ed('As', 'association', 'N', 'A')]);
    const pts = new Drawing(p).route(p.edges.get('As')!, { lines: [] })!;
    expect(pts).toHaveLength(2);
  });
});

describe('brokenEdge', () => {
  const setup = (): Plane =>
    plane([sh('A', 'task', [100, 100, 100, 80]), sh('B', 'task', [300, 100, 100, 80]), sh('C', 'task', [100, 300, 100, 80])], [ed('F', 'sequenceFlow', 'A', 'B', [[200, 140], [300, 140]])]);

  it('keeps an intact connection', () => {
    const p = setup();
    expect(new Drawing(p).brokenEdge(p.edges.get('F')!, new Drawing(p).edgeBefore(p.edges.get('F')!))).toBe(false);
  });

  it('flags a connection whose end lost its shape, that turned diagonal, or now cuts a shape', () => {
    let p = setup();
    let before = new Drawing(p).edgeBefore(p.edges.get('F')!);
    p.shapes.get('B')!.bounds.y += 50;
    expect(new Drawing(p).brokenEdge(p.edges.get('F')!, before)).toBe(true);
    p = setup();
    before = new Drawing(p).edgeBefore(p.edges.get('F')!);
    p.edges.get('F')!.points[1] = { x: 300, y: 150 };
    expect(new Drawing(p).brokenEdge(p.edges.get('F')!, before)).toBe(true);
    p = setup();
    before = new Drawing(p).edgeBefore(p.edges.get('F')!);
    p.shapes.set('N', sh('N', 'event', [230, 122, 36, 36]));
    expect(new Drawing(p).brokenEdge(p.edges.get('F')!, before)).toBe(true);
  });

  it('does not reroute a hand-drawn connection for a defect it already had', () => {
    const p = setup();
    p.shapes.set('N', sh('N', 'event', [230, 122, 36, 36]));
    const before = new Drawing(p).edgeBefore(p.edges.get('F')!);
    expect(before.cut.has('N')).toBe(true);
    expect(new Drawing(p).brokenEdge(p.edges.get('F')!, before)).toBe(false);
  });

  it('feeds labels to the router as diagonals', () => {
    const p = setup();
    p.shapes.get('A')!.label = { x: 120, y: 190, width: 60, height: 14 };
    expect(new Drawing(p).routingLines()).toContainEqual([{ x: 120, y: 190 }, { x: 180, y: 204 }]);
    expect(new Drawing(p).routingLines('F')).not.toContainEqual(p.edges.get('F')!.points);
  });
});

describe('labels', () => {
  it('puts event labels below and gateway labels above, off lines and shapes', () => {
    const p = plane([sh('E', 'event', [100, 100, 36, 36], {}, 'Done'), sh('G', 'gateway', [300, 100, 50, 50], {}, 'ok?')]);
    expect(new Drawing(p).placeShapeLabel(p.shapes.get('E')!)!.y).toBe(142);
    expect(new Drawing(p).placeShapeLabel(p.shapes.get('G')!)!.y).toBeLessThan(100);
    // a line right below the event pushes its label to the next side
    p.edges.set('L', ed('L', 'sequenceFlow', 'X', 'Y', [[0, 148], [400, 148]]));
    const box = new Drawing(p).placeShapeLabel(p.shapes.get('E')!)!;
    expect(box.y + box.height).toBeLessThanOrEqual(100);
    expect(new Drawing(p).placeShapeLabel(p.shapes.get('E')!, 'right')!.x).toBeGreaterThan(136);
  });

  it('hangs a boundary label below the host, right of the event', () => {
    const p = plane([sh('H', 'task', [100, 100, 100, 80]), sh('B', 'boundary', [160, 162, 36, 36], { hostId: 'H' }, 'Late')]);
    const box = new Drawing(p).placeShapeLabel(p.shapes.get('B')!)!;
    expect(box).toMatchObject({ x: 200, y: 182 });
    expect(labelAt(p.shapes.get('B')!, { width: 30, height: 14 }, 'below', p.shapes.get('H')!)).toMatchObject({ x: 200, y: 182 });
  });

  it('puts a flow label above its first long horizontal segment, near the start', () => {
    const p = plane([], [ed('F', 'sequenceFlow', 'A', 'B', [[100, 100], [100, 200], [400, 200]], 'yes')]);
    const box = new Drawing(p).placeEdgeLabel(p.edges.get('F')!)!;
    expect(box.y + box.height).toBe(196);
    expect(box.x).toBe(108);
  });

  it('keeps a label on the title of its sub-process where every free spot is outside the sub-process', () => {
    // the sub-process fits its gateway tightly: above it the title (widened by a rename), below, left and right its border
    const sub: DShape = { id: 'SP', el: el('bpmn:SubProcess', 'SP', 'Check the documents'), kind: 'subProcess', container: true, expanded: true, bounds: { x: 100, y: 100, width: 140, height: 80 } };
    const p = plane([sub, sh('G', 'gateway', [145, 124, 50, 50], { parentId: 'SP' }, 'Complete?')]);
    const g = p.shapes.get('G')!;
    g.label = { x: 133, y: 108, width: 75, height: 14 };
    expect(new Drawing(p).clearTitles(() => true)).toEqual([]);
    expect(g.label).toEqual({ x: 133, y: 108, width: 75, height: 14 });
    // with room below the gateway the label moves there, inside the sub-process
    sub.bounds.height = 120;
    expect(new Drawing(p).clearTitles(() => true)).toEqual([['G', 'SP']]);
    expect(g.label!.y).toBeGreaterThanOrEqual(174);
    expect(g.label!.y + g.label!.height).toBeLessThanOrEqual(220);
  });

  it('refits a renamed label on the side it was on', () => {
    const p = plane([sh('E', 'event', [100, 100, 36, 36], {}, 'Everything has been booked and archived')]);
    const e = p.shapes.get('E')!;
    e.label = { x: 98, y: 142, width: 40, height: 14 };
    const box = new Drawing(p).refitLabel(e)!;
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
