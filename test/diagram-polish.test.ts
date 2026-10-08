/**
 * Regressions found by blind visual judges comparing edits on hand-drawn
 * models (incremental engine, src/diagram/): connection labels that stayed
 * behind, long names overflowing their task, two flows on one gateway vertex
 * after a lane change, an event sub-process stretched by the space tool, and
 * the empty flow a removal left on its row. The fixtures in
 * test/fixtures/incremental/polish-*.bpmn are small synthetic hand drawings.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { layoutProblems } from '../src/diagram/metrics.js';
import { readPlanes, type DEdge, type DShape, type Plane } from '../src/diagram/plane.js';
import { routeOrthogonal } from '../src/diagram/router.js';
import { makeSpace } from '../src/diagram/space.js';
import { activitySize, BOTTOM_ROOM, fitsInside, innerLines } from '../src/diagram/text.js';
import type { Box, Point } from '../src/layout/types.js';
import type { El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, type MutationResult } from '../src/pipeline.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(HERE, 'fixtures', 'incremental', name), 'utf8');

async function run(xml: string, ops: Op[]): Promise<{ r: MutationResult; before: Doc; after: Doc }> {
  const before = await Doc.fromXml(xml, 'x.bpmn');
  const r = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  const after = await Doc.fromXml(r.xml);
  expect(after.importWarnings).toEqual([]);
  expect(r.layout.mode).toBe('incremental');
  return { r, before, after };
}

function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const p of readPlanes(doc.definitions)) for (const s of p.shapes.values()) out.set(s.id, s);
  return out;
}

function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const p of readPlanes(doc.definitions)) for (const e of p.edges.values()) out.set(e.id, e);
  return out;
}

const right = (b: Box): number => b.x + b.width;
const bottom = (b: Box): number => b.y + b.height;
const cy = (b: Box): number => b.y + b.height / 2;
const overlap = (a: Box, b: Box): boolean => a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;

/** The vertices of a gateway's diamond, as "x,y". */
const vertices = (b: Box): string[] => [`${b.x},${cy(b)}`, `${right(b)},${cy(b)}`, `${b.x + b.width / 2},${b.y}`, `${b.x + b.width / 2},${bottom(b)}`];
const key = (p: Point): string => `${p.x},${p.y}`;

/* ------------------------------------------------------------------ */
/* space tool                                                           */
/* ------------------------------------------------------------------ */

const EL = {} as El;
function sh(id: string, kind: DShape['kind'], b: [number, number, number, number], extra: Partial<DShape> = {}): DShape {
  const container = kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && extra.expanded === true);
  return { id, el: EL, kind, container, bounds: { x: b[0], y: b[1], width: b[2], height: b[3] }, ...extra };
}
function ed(id: string, sourceId: string, targetId: string, pts: Array<[number, number]>, extra: Partial<DEdge> = {}): DEdge {
  return { id, el: EL, kind: 'sequenceFlow', sourceId, targetId, points: pts.map(([x, y]) => ({ x, y })), ...extra };
}
function plane(shapes: DShape[], edges: DEdge[] = []): Plane {
  return { id: 'p', rootId: 'r', root: EL, shapes: new Map(shapes.map((s) => [s.id, s])), edges: new Map(edges.map((e) => [e.id, e])), dropped: [] };
}

describe('makeSpace: labels go with their connection', () => {
  it('moves the label of a translated message flow even outside the `within` band', () => {
    const p = plane(
      [sh('Top', 'participant', [100, 0, 800, 60]), sh('Pool', 'participant', [100, 120, 800, 200]), sh('A', 'task', [200, 160, 100, 80], { poolId: 'Pool' }), sh('R', 'task', [400, 160, 100, 80], { poolId: 'Pool' })],
      [ed('M', 'R', 'Top', [[450, 160], [450, 60]], { kind: 'messageFlow', label: { x: 456, y: 85, width: 40, height: 14 } })],
    );
    makeSpace(p, { axis: 'x', line: 301, delta: 150, within: { x: 100, y: 120, width: 800, height: 200 } });
    expect(p.edges.get('M')!.points).toEqual([{ x: 600, y: 160 }, { x: 600, y: 60 }]);
    expect(p.edges.get('M')!.label!.x).toBe(606);
  });

  it('keeps the label of a connection that stays and of the part of a stretched one before the line', () => {
    const p = plane(
      [sh('A', 'task', [100, 100, 100, 80]), sh('B', 'task', [500, 100, 100, 80]), sh('C', 'task', [100, 300, 100, 80]), sh('D', 'task', [200, 300, 30, 80])],
      [ed('F', 'A', 'B', [[200, 140], [500, 140]], { label: { x: 210, y: 120, width: 30, height: 14 } }), ed('K', 'C', 'D', [[200, 340], [200, 340]], { label: { x: 420, y: 320, width: 30, height: 14 } })],
    );
    makeSpace(p, { axis: 'x', line: 300, delta: 100, within: { x: 0, y: 50, width: 1000, height: 150 } });
    expect(p.edges.get('F')!.points).toEqual([{ x: 200, y: 140 }, { x: 600, y: 140 }]);
    expect(p.edges.get('F')!.label!.x).toBe(210);
    // a connection outside the band does not move, nor does its label (even beyond the line)
    expect(p.edges.get('K')!.label!.x).toBe(420);
  });
});

describe('makeSpace: expanded sub-processes the line crosses', () => {
  /** A -> N in the main row; Sub1 (mostly left of x=301) and Sub2 (mostly right) below, neither holding A. */
  function rows(): Plane {
    return plane(
      [
        sh('Pool', 'participant', [100, 0, 900, 600]),
        sh('A', 'task', [200, 40, 100, 80], { poolId: 'Pool' }),
        sh('N', 'task', [360, 40, 100, 80], { poolId: 'Pool' }),
        sh('Sub1', 'subProcess', [150, 200, 250, 150], { poolId: 'Pool', expanded: true }),
        sh('S1a', 'event', [170, 260, 36, 36], { poolId: 'Pool', parentId: 'Sub1' }),
        sh('S1b', 'event', [340, 260, 36, 36], { poolId: 'Pool', parentId: 'Sub1', label: { x: 335, y: 300, width: 46, height: 14 } }),
        sh('Sub2', 'subProcess', [250, 400, 400, 150], { poolId: 'Pool', expanded: true }),
        sh('S2a', 'event', [270, 460, 36, 36], { poolId: 'Pool', parentId: 'Sub2' }),
        sh('S2b', 'event', [580, 460, 36, 36], { poolId: 'Pool', parentId: 'Sub2' }),
        sh('S2x', 'boundary', [632, 532, 36, 36], { poolId: 'Pool', hostId: 'Sub2' }),
      ],
      [
        ed('F', 'A', 'N', [[300, 80], [360, 80]]),
        ed('G1', 'S1a', 'S1b', [[206, 278], [270, 278], [270, 278], [340, 278]], { label: { x: 310, y: 262, width: 20, height: 14 } }),
        ed('G2', 'S2a', 'S2b', [[306, 478], [330, 478], [330, 500], [580, 500], [580, 496]]),
      ],
    );
  }

  it('anchored outside them: the one mostly before the line stays, the other moves as a whole', () => {
    const p = rows();
    const r = makeSpace(p, { axis: 'x', line: 301, delta: 160, anchors: ['A'] });
    expect(p.shapes.get('Sub1')!.bounds).toEqual({ x: 150, y: 200, width: 250, height: 150 });
    expect(p.shapes.get('S1b')!.bounds.x).toBe(340);
    expect(p.shapes.get('S1b')!.label!.x).toBe(335);
    expect(p.edges.get('G1')!.points.map((q) => q.x)).toEqual([206, 270, 270, 340]);
    expect(p.edges.get('G1')!.label!.x).toBe(310);
    expect(p.shapes.get('Sub2')!.bounds).toEqual({ x: 410, y: 400, width: 400, height: 150 });
    expect(p.shapes.get('S2a')!.bounds.x).toBe(430);
    expect(p.shapes.get('S2b')!.bounds.x).toBe(740);
    expect(p.shapes.get('S2x')!.bounds.x).toBe(792);
    // the inner connection is translated, bends before the line included
    expect(p.edges.get('G2')!.points.map((q) => q.x)).toEqual([466, 490, 490, 740, 740]);
    expect(p.shapes.get('N')!.bounds.x).toBe(520);
    expect(r.resized.has('Sub1')).toBe(false);
    expect(r.resized.has('Sub2')).toBe(false);
  });

  it('anchored inside one: that one grows, as without anchors', () => {
    const p = rows();
    makeSpace(p, { axis: 'x', line: 301, delta: 160, anchors: ['S1a'] });
    expect(p.shapes.get('Sub1')!.bounds.width).toBe(410);
    expect(p.shapes.get('S1a')!.bounds.x).toBe(170);
    expect(p.shapes.get('S1b')!.bounds.x).toBe(500);
    const q = rows();
    makeSpace(q, { axis: 'x', line: 301, delta: 160 });
    expect(q.shapes.get('Sub1')!.bounds.width).toBe(410);
    expect(q.shapes.get('Sub2')!.bounds.width).toBe(560);
  });
});

/* ------------------------------------------------------------------ */
/* router                                                               */
/* ------------------------------------------------------------------ */

describe('router: gateway vertices, taken sides, crossings next to an arrowhead', () => {
  const g: Box = { x: 100, y: 100, width: 50, height: 50 };

  it('keeps a middle-only port on the vertex even when another connection docks there', () => {
    const t: Box = { x: 250, y: 160, width: 100, height: 80 };
    const docked = [[{ x: 150, y: 125 }, { x: 250, y: 125 }]];
    const free = routeOrthogonal({ source: g, target: t, sourceSides: ['right'], obstacles: [], lines: docked });
    const middle = routeOrthogonal({ source: g, target: t, sourceSides: ['right'], sourceMiddle: true, obstacles: [], lines: docked });
    expect(key(free[0]!)).not.toBe('150,125');
    expect(key(middle[0]!)).toBe('150,125');
  });

  it('leaves by another vertex than a taken one when that costs no more than a crossing', () => {
    const t: Box = { x: 250, y: 300, width: 100, height: 80 };
    const taken = [[{ x: 125, y: 150 }, { x: 125, y: 220 }, { x: 250, y: 220 }]];
    const pts = routeOrthogonal({ source: g, target: t, sourceSides: ['right', 'bottom', 'top'], sourceMiddle: true, sourceAvoid: ['bottom'], obstacles: [{ x: 250, y: 180, width: 100, height: 80 }], lines: taken });
    expect(key(pts[0]!)).toBe('150,125');
  });

  it('crosses another connection away from its arrowhead', () => {
    // the line to cross ends at the box E; going straight down would cross right before its arrowhead
    const s: Box = { x: 100, y: 100, width: 100, height: 80 };
    const t: Box = { x: 230, y: 300, width: 100, height: 80 };
    const line = [[{ x: 120, y: 240 }, { x: 290, y: 240 }]];
    const pts = routeOrthogonal({ source: s, target: t, sourceSides: ['right'], targetSides: ['top', 'left'], sourceMiddle: true, obstacles: [{ x: 290, y: 222, width: 36, height: 36 }], lines: line });
    const crossAt = pts.slice(1).flatMap((q, i) => {
      const p = pts[i]!;
      return p.x === q.x && Math.min(p.y, q.y) < 240 && Math.max(p.y, q.y) > 240 ? [p.x] : [];
    });
    expect(crossAt.length).toBe(1);
    expect(Math.abs(290 - crossAt[0]!)).toBeGreaterThanOrEqual(25);
  });
});

/* ------------------------------------------------------------------ */
/* text of activities                                                   */
/* ------------------------------------------------------------------ */

describe('text: bpmn-js line breaking and the size an activity needs', () => {
  const LONG = 'Check all submitted documents thoroughly and inform the responsible clerk about the outcome';

  it('breaks lines like bpmn-js (padding 7, Arial 12px, proportional shortening, long words cut)', () => {
    expect(innerLines(LONG, 120)).toBe(6);
    expect(innerLines('Auftrag als fakturiert markieren', 100)).toBe(3);
    expect(innerLines('Zahlungseingang abwarten', 100)).toBe(2);
    expect(innerLines('Bestellung prüfen (Abteilungsleitung)', 100)).toBe(4);
    expect(innerLines('Bench inserted task', 100)).toBe(2);
  });

  it('fits 5 lines into 80 px, 3 with a marker or boundary event below', () => {
    expect(fitsInside('Bestellung prüfen (Abteilungsleitung)', { width: 100, height: 80 })).toBe(true);
    expect(fitsInside('Bestellung prüfen (Abteilungsleitung)', { width: 100, height: 80 }, BOTTOM_ROOM)).toBe(false);
    expect(fitsInside(LONG, { width: 120, height: 80 })).toBe(false);
  });

  it('grows wider in steps of 20 first, then higher at the narrowest useful width; never smaller', () => {
    expect(activitySize('Short name', { width: 100, height: 80 })).toBeUndefined();
    expect(activitySize(LONG, { width: 100, height: 80 })).toEqual({ width: 140, height: 80 });
    expect(activitySize(LONG, { width: 100, height: 80 }, BOTTOM_ROOM)).toEqual({ width: 160, height: 100 });
    expect(activitySize(LONG, { width: 300, height: 200 })).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* through the pipeline on hand drawings                                */
/* ------------------------------------------------------------------ */

describe('judged edits on hand drawings', () => {
  it('insert: the message flow label moves with its flow; event sub-processes the line crosses are moved or kept, never stretched', async () => {
    const xml = fixture('polish-collab.bpmn');
    const { before, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'New step', after: 'A' }]);
    const b = shapes(before);
    const a = shapes(after);
    const dx = a.get('R')!.bounds.x - b.get('R')!.bounds.x;
    expect(dx).toBeGreaterThan(0);
    const m0 = edges(before).get('M1')!;
    const m1 = edges(after).get('M1')!;
    expect(m1.points).toEqual(m0.points.map((p) => ({ x: p.x + dx, y: p.y })));
    expect(m1.label!.x).toBe(m0.label!.x + dx);
    expect(m1.label!.y).toBe(m0.label!.y);
    // mostly before the insertion line: untouched with its content and inner flows
    for (const id of ['ESP', 'ES', 'ET', 'EE']) expect(a.get(id)!.bounds, id).toEqual(b.get(id)!.bounds);
    expect(edges(after).get('EF2')!.points).toEqual(edges(before).get('EF2')!.points);
    // mostly beyond it: moved as a whole
    for (const id of ['ESP2', 'BS', 'BT', 'BE']) expect(a.get(id)!.bounds, id).toEqual({ ...b.get(id)!.bounds, x: b.get(id)!.bounds.x + dx });
    expect(edges(after).get('BF1')!.points).toEqual(edges(before).get('BF1')!.points.map((p) => ({ x: p.x + dx, y: p.y })));
  });

  it('rename: a long name grows its task (wider, then higher), the boundary event stays on the border, what follows keeps its distance', async () => {
    const xml = fixture('polish-rename.bpmn');
    const name = 'Check all submitted documents thoroughly and inform the responsible clerk about the outcome';
    const { r, before, after } = await run(xml, [{ op: 'set', id: 'A', values: { name } }]);
    const b = shapes(before);
    const a = shapes(after);
    const A = a.get('A')!.bounds;
    expect(A.x).toBe(b.get('A')!.bounds.x);
    expect(cy(A)).toBe(cy(b.get('A')!.bounds));
    expect(A.width).toBeGreaterThan(100);
    expect(A.width).toBeLessThanOrEqual(200);
    expect(fitsInside(name, A, BOTTOM_ROOM)).toBe(true);
    const B = a.get('B')!.bounds;
    expect(Math.abs(cy(B) - bottom(A))).toBeLessThanOrEqual(3);
    expect(B.x).toBeGreaterThanOrEqual(A.x);
    expect(right(B)).toBeLessThanOrEqual(right(A));
    expect(a.get('C')!.bounds.x - right(A)).toBeGreaterThanOrEqual(40);
    expect(overlap(a.get('B')!.label!, A)).toBe(false);
    expect(layoutProblems(after.definitions).counts.overlaps).toBe(0);
    expect(r.layout.notes.some((n) => n.startsWith('A grew'))).toBe(true);
  });

  it('rename: a short name never shrinks a shape; a name that fits changes nothing', async () => {
    const xml = fixture('polish-rename.bpmn');
    const { before, after } = await run(xml, [
      { op: 'set', id: 'C', values: { name: 'Ship' } },
      { op: 'set', id: 'A', values: { name: 'Check the order' } },
    ]);
    const b = shapes(before);
    const a = shapes(after);
    for (const id of ['A', 'B', 'C', 'E', 'EB']) expect(a.get(id)!.bounds, id).toEqual(b.get(id)!.bounds);
  });

  it('lane change: the rerouted flows use free vertices of the split and the join, and only vertices', async () => {
    const xml = fixture('polish-lanes.bpmn');
    const { after } = await run(xml, [{ op: 'set', id: 'T1', values: { lane: 'L2' } }]);
    const a = shapes(after);
    const es = [...edges(after).values()];
    for (const gw of ['G1', 'J']) {
      const v = vertices(a.get(gw)!.bounds);
      const docks = [...es.filter((e) => e.sourceId === gw).map((e) => e.points[0]!), ...es.filter((e) => e.targetId === gw).map((e) => e.points[e.points.length - 1]!)].map(key);
      expect(docks).toHaveLength(3);
      for (const d of docks) expect(v, `${gw} ${d}`).toContain(d);
      expect(new Set(docks).size, gw).toBe(3);
    }
  });

  it('remove: when other rows block the strip, the row of the removed node closes on its own', async () => {
    const xml = fixture('polish-remove.bpmn');
    const { before, after } = await run(xml, [{ op: 'remove', ids: ['X'] }]);
    const b = shapes(before);
    const a = shapes(after);
    const dx = a.get('M')!.bounds.x - b.get('M')!.bounds.x;
    expect(a.get('M')!.bounds.x).toBe(b.get('X')!.bounds.x);
    expect(a.get('E2')!.bounds.x - b.get('E2')!.bounds.x).toBe(dx);
    expect(a.get('M')!.label!.x - b.get('M')!.label!.x).toBe(dx);
    for (const id of ['S', 'H', 'B', 'E1', 'Org']) expect(a.get(id)!.bounds, id).toEqual(b.get(id)!.bounds);
    expect(layoutProblems(after.definitions).counts.overlaps).toBe(0);
  });

  it('remove: the row stays when closing it would leave an associated artifact behind', async () => {
    const xml = fixture('polish-remove.bpmn')
      .replace('<bpmn:sequenceFlow id="f1"', '<bpmn:textAnnotation id="T"><bpmn:text>Mail to the customer</bpmn:text></bpmn:textAnnotation><bpmn:association id="As" sourceRef="M" targetRef="T"/><bpmn:sequenceFlow id="f1"')
      .replace(
        '<bpmndi:BPMNEdge id="f1_di"',
        '<bpmndi:BPMNShape id="T_di" bpmnElement="T"><dc:Bounds x="600" y="100" width="120" height="30"/></bpmndi:BPMNShape><bpmndi:BPMNEdge id="As_di" bpmnElement="As"><di:waypoint x="566" y="266"/><di:waypoint x="620" y="130"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge id="f1_di"',
      );
    const { before, after } = await run(xml, [{ op: 'remove', ids: ['X'] }]);
    const b = shapes(before);
    const a = shapes(after);
    for (const id of ['M', 'E2', 'T']) expect(a.get(id)!.bounds, id).toEqual(b.get(id)!.bounds);
  });
});
