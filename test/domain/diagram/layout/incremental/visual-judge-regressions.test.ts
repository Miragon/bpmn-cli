/**
 * Regressions found by blind visual judges comparing edits on hand-drawn
 * models (incremental engine, src/diagram/): connection labels that stayed
 * behind, long names overflowing their task, two flows on one gateway vertex
 * after a lane change (only a join's entries from below share one, its
 * bottom vertex), an event sub-process stretched by the space tool, and
 * the empty flow a removal left on its row. The fixtures in
 * test/fixtures/incremental/polish-*.bpmn are small synthetic hand drawings.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Doc } from '../../../../../src/domain/document/Doc.js';
import type { DEdge, DShape, Plane } from '../../../../../src/domain/diagram/di/types.js';
import { activitySize, BOTTOM_ROOM, fitsInside, innerLines } from '../../../../../src/domain/diagram/utils/text.js';
import { LayoutAnalysis } from '../../../../../src/domain/diagram/di/LayoutAnalysis.js';
import { DiagramReader } from '../../../../../src/domain/diagram/di/DiagramReader.js';
import { OrthogonalRouter } from '../../../../../src/domain/diagram/layout/incremental/OrthogonalRouter.js';
import { Drawing } from '../../../../../src/domain/diagram/layout/incremental/Drawing.js';
import type { Box, Point } from '../../../../../src/domain/diagram/di/types.js';
import type { El } from '../../../../../src/domain/document/utils/moddle.js';
import type { EditCommand } from '../../../../../src/domain/commands/types.js';
import { mutateDoc } from '../../../../../src/index.js';
import { type MutationResult } from '../../../../../src/domain/batch/types.js';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const fixture = (name: string): string => readFileSync(join(HERE, 'fixtures', 'incremental', name), 'utf8');

async function run(xml: string, ops: EditCommand[]): Promise<{ result: MutationResult; before: Doc; after: Doc }> {
  const before = await Doc.fromXml(xml, 'x.bpmn');
  const result = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  const after = await Doc.fromXml(result.xml);
  expect(after.importWarnings).toEqual([]);
  expect(result.layout.mode).toBe('incremental');
  return { result, before, after };
}

function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const diagramPlane of new DiagramReader(doc.definitions).planes()) for (const shape of diagramPlane.shapes.values()) out.set(shape.id, shape);
  return out;
}

function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const diagramPlane of new DiagramReader(doc.definitions).planes()) for (const edge of diagramPlane.edges.values()) out.set(edge.id, edge);
  return out;
}

const right = (box: Box): number => box.x + box.width;
const bottom = (box: Box): number => box.y + box.height;
const cy = (box: Box): number => box.y + box.height / 2;
const overlap = (first: Box, second: Box): boolean => first.x < right(second) && right(first) > second.x && first.y < bottom(second) && bottom(first) > second.y;

/** The vertices of a gateway's diamond, as "x,y". */
const vertices = (box: Box): string[] => [`${box.x},${cy(box)}`, `${right(box)},${cy(box)}`, `${box.x + box.width / 2},${box.y}`, `${box.x + box.width / 2},${bottom(box)}`];
const key = (point: Point): string => `${point.x},${point.y}`;

/* ------------------------------------------------------------------ */
/* space tool                                                           */
/* ------------------------------------------------------------------ */

const EL = {} as El;
function sh(id: string, kind: DShape['kind'], bounds: [number, number, number, number], extra: Partial<DShape> = {}): DShape {
  const container = kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && extra.expanded === true);
  return { id, el: EL, kind, container, bounds: { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] }, ...extra };
}
function ed(id: string, sourceId: string, targetId: string, pts: Array<[number, number]>, extra: Partial<DEdge> = {}): DEdge {
  return { id, el: EL, kind: 'sequenceFlow', sourceId, targetId, points: pts.map(([pointX, pointY]) => ({ x: pointX, y: pointY })), ...extra };
}
function plane(shapes: DShape[], edges: DEdge[] = []): Plane {
  return { id: 'p', rootId: 'r', root: EL, shapes: new Map(shapes.map((shape) => [shape.id, shape])), edges: new Map(edges.map((edge) => [edge.id, edge])), dropped: [] };
}

describe('makeSpace: labels go with their connection', () => {
  it('moves the label of a translated message flow even outside the `within` band', () => {
    const drawnPlane = plane(
      [sh('Top', 'participant', [100, 0, 800, 60]), sh('Pool', 'participant', [100, 120, 800, 200]), sh('A', 'task', [200, 160, 100, 80], { poolId: 'Pool' }), sh('R', 'task', [400, 160, 100, 80], { poolId: 'Pool' })],
      [ed('M', 'R', 'Top', [[450, 160], [450, 60]], { kind: 'messageFlow', label: { x: 456, y: 85, width: 40, height: 14 } })],
    );
    new Drawing(drawnPlane).makeSpace({ axis: 'x', line: 301, delta: 150, within: { x: 100, y: 120, width: 800, height: 200 } });
    expect(drawnPlane.edges.get('M')!.points).toEqual([{ x: 600, y: 160 }, { x: 600, y: 60 }]);
    expect(drawnPlane.edges.get('M')!.label!.x).toBe(606);
  });

  it('keeps the label of a connection that stays and of the part of a stretched one before the line', () => {
    const drawnPlane = plane(
      [sh('A', 'task', [100, 100, 100, 80]), sh('B', 'task', [500, 100, 100, 80]), sh('C', 'task', [100, 300, 100, 80]), sh('D', 'task', [200, 300, 30, 80])],
      [ed('F', 'A', 'B', [[200, 140], [500, 140]], { label: { x: 210, y: 120, width: 30, height: 14 } }), ed('K', 'C', 'D', [[200, 340], [200, 340]], { label: { x: 420, y: 320, width: 30, height: 14 } })],
    );
    new Drawing(drawnPlane).makeSpace({ axis: 'x', line: 300, delta: 100, within: { x: 0, y: 50, width: 1000, height: 150 } });
    expect(drawnPlane.edges.get('F')!.points).toEqual([{ x: 200, y: 140 }, { x: 600, y: 140 }]);
    expect(drawnPlane.edges.get('F')!.label!.x).toBe(210);
    // a connection outside the band does not move, nor does its label (even beyond the line)
    expect(drawnPlane.edges.get('K')!.label!.x).toBe(420);
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
    const drawnPlane = rows();
    const spaceResult = new Drawing(drawnPlane).makeSpace({ axis: 'x', line: 301, delta: 160, anchors: ['A'] });
    expect(drawnPlane.shapes.get('Sub1')!.bounds).toEqual({ x: 150, y: 200, width: 250, height: 150 });
    expect(drawnPlane.shapes.get('S1b')!.bounds.x).toBe(340);
    expect(drawnPlane.shapes.get('S1b')!.label!.x).toBe(335);
    expect(drawnPlane.edges.get('G1')!.points.map((point) => point.x)).toEqual([206, 270, 270, 340]);
    expect(drawnPlane.edges.get('G1')!.label!.x).toBe(310);
    expect(drawnPlane.shapes.get('Sub2')!.bounds).toEqual({ x: 410, y: 400, width: 400, height: 150 });
    expect(drawnPlane.shapes.get('S2a')!.bounds.x).toBe(430);
    expect(drawnPlane.shapes.get('S2b')!.bounds.x).toBe(740);
    expect(drawnPlane.shapes.get('S2x')!.bounds.x).toBe(792);
    // the inner connection is translated, bends before the line included
    expect(drawnPlane.edges.get('G2')!.points.map((point) => point.x)).toEqual([466, 490, 490, 740, 740]);
    expect(drawnPlane.shapes.get('N')!.bounds.x).toBe(520);
    expect(spaceResult.resized.has('Sub1')).toBe(false);
    expect(spaceResult.resized.has('Sub2')).toBe(false);
  });

  it('anchored inside one: that one grows, as without anchors', () => {
    const drawnPlane = rows();
    new Drawing(drawnPlane).makeSpace({ axis: 'x', line: 301, delta: 160, anchors: ['S1a'] });
    expect(drawnPlane.shapes.get('Sub1')!.bounds.width).toBe(410);
    expect(drawnPlane.shapes.get('S1a')!.bounds.x).toBe(170);
    expect(drawnPlane.shapes.get('S1b')!.bounds.x).toBe(500);
    const freePlane = rows();
    new Drawing(freePlane).makeSpace({ axis: 'x', line: 301, delta: 160 });
    expect(freePlane.shapes.get('Sub1')!.bounds.width).toBe(410);
    expect(freePlane.shapes.get('Sub2')!.bounds.width).toBe(560);
  });
});

/* ------------------------------------------------------------------ */
/* router                                                               */
/* ------------------------------------------------------------------ */

describe('router: gateway vertices, taken sides, crossings next to an arrowhead', () => {
  const gateway: Box = { x: 100, y: 100, width: 50, height: 50 };

  it('keeps a middle-only port on the vertex even when another connection docks there', () => {
    const target: Box = { x: 250, y: 160, width: 100, height: 80 };
    const docked = [[{ x: 150, y: 125 }, { x: 250, y: 125 }]];
    const free = OrthogonalRouter.route({ source: gateway, target, sourceSides: ['right'], obstacles: [], lines: docked });
    const middle = OrthogonalRouter.route({ source: gateway, target, sourceSides: ['right'], sourceMiddle: true, obstacles: [], lines: docked });
    expect(key(free[0]!)).not.toBe('150,125');
    expect(key(middle[0]!)).toBe('150,125');
  });

  it('leaves by another vertex than a taken one when that costs no more than a crossing', () => {
    const target: Box = { x: 250, y: 300, width: 100, height: 80 };
    const taken = [[{ x: 125, y: 150 }, { x: 125, y: 220 }, { x: 250, y: 220 }]];
    const pts = OrthogonalRouter.route({ source: gateway, target, sourceSides: ['right', 'bottom', 'top'], sourceMiddle: true, sourceAvoid: ['bottom'], obstacles: [{ x: 250, y: 180, width: 100, height: 80 }], lines: taken });
    expect(key(pts[0]!)).toBe('150,125');
  });

  it('crosses another connection away from its arrowhead', () => {
    // the line to cross ends at the box E; going straight down would cross right before its arrowhead
    const source: Box = { x: 100, y: 100, width: 100, height: 80 };
    const target: Box = { x: 230, y: 300, width: 100, height: 80 };
    const line = [[{ x: 120, y: 240 }, { x: 290, y: 240 }]];
    const pts = OrthogonalRouter.route({ source, target, sourceSides: ['right'], targetSides: ['top', 'left'], sourceMiddle: true, obstacles: [{ x: 290, y: 222, width: 36, height: 36 }], lines: line });
    const crossAt = pts.slice(1).flatMap((point, pointIndex) => {
      const previous = pts[pointIndex]!;
      return previous.x === point.x && Math.min(previous.y, point.y) < 240 && Math.max(previous.y, point.y) > 240 ? [previous.x] : [];
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
    const shapesBefore = shapes(before);
    const shapesAfter = shapes(after);
    const dx = shapesAfter.get('R')!.bounds.x - shapesBefore.get('R')!.bounds.x;
    expect(dx).toBeGreaterThan(0);
    const m0 = edges(before).get('M1')!;
    const m1 = edges(after).get('M1')!;
    expect(m1.points).toEqual(m0.points.map((point) => ({ x: point.x + dx, y: point.y })));
    expect(m1.label!.x).toBe(m0.label!.x + dx);
    expect(m1.label!.y).toBe(m0.label!.y);
    // mostly before the insertion line: untouched with its content and inner flows
    for (const id of ['ESP', 'ES', 'ET', 'EE']) expect(shapesAfter.get(id)!.bounds, id).toEqual(shapesBefore.get(id)!.bounds);
    expect(edges(after).get('EF2')!.points).toEqual(edges(before).get('EF2')!.points);
    // mostly beyond it, but neither following the new node nor in the way of what moves: kept as a whole
    for (const id of ['ESP2', 'BS', 'BT', 'BE']) expect(shapesAfter.get(id)!.bounds, id).toEqual(shapesBefore.get(id)!.bounds);
    expect(edges(after).get('BF1')!.points).toEqual(edges(before).get('BF1')!.points);
  });

  it('rename: a long name grows its task (wider, then higher), the boundary event stays on the border, what follows keeps its distance', async () => {
    const xml = fixture('polish-rename.bpmn');
    const name = 'Check all submitted documents thoroughly and inform the responsible clerk about the outcome';
    const { result, before, after } = await run(xml, [{ op: 'set', id: 'A', values: { name } }]);
    const shapesBefore = shapes(before);
    const shapesAfter = shapes(after);
    const boundsA = shapesAfter.get('A')!.bounds;
    expect(boundsA.x).toBe(shapesBefore.get('A')!.bounds.x);
    expect(cy(boundsA)).toBe(cy(shapesBefore.get('A')!.bounds));
    expect(boundsA.width).toBeGreaterThan(100);
    expect(boundsA.width).toBeLessThanOrEqual(200);
    expect(fitsInside(name, boundsA, BOTTOM_ROOM)).toBe(true);
    const boundsB = shapesAfter.get('B')!.bounds;
    expect(Math.abs(cy(boundsB) - bottom(boundsA))).toBeLessThanOrEqual(3);
    expect(boundsB.x).toBeGreaterThanOrEqual(boundsA.x);
    expect(right(boundsB)).toBeLessThanOrEqual(right(boundsA));
    expect(shapesAfter.get('C')!.bounds.x - right(boundsA)).toBeGreaterThanOrEqual(40);
    expect(overlap(shapesAfter.get('B')!.label!, boundsA)).toBe(false);
    expect(LayoutAnalysis.of(after.definitions).counts.overlaps).toBe(0);
    expect(result.layout.notes.some((note) => note.startsWith('A grew'))).toBe(true);
  });

  it('rename: a short name never shrinks a shape; a name that fits changes nothing', async () => {
    const xml = fixture('polish-rename.bpmn');
    const { before, after } = await run(xml, [
      { op: 'set', id: 'C', values: { name: 'Ship' } },
      { op: 'set', id: 'A', values: { name: 'Check the order' } },
    ]);
    const shapesBefore = shapes(before);
    const shapesAfter = shapes(after);
    for (const id of ['A', 'B', 'C', 'E', 'EB']) expect(shapesAfter.get(id)!.bounds, id).toEqual(shapesBefore.get(id)!.bounds);
  });

  it('lane change: the rerouted flows dock only on vertices, free ones of the split; the join\'s entries from below share its bottom vertex', async () => {
    const xml = fixture('polish-lanes.bpmn');
    const { after } = await run(xml, [{ op: 'set', id: 'T1', values: { lane: 'L2' } }]);
    const shapesAfter = shapes(after);
    const es = [...edges(after).values()];
    const docksOf = (gw: string): string[] => [...es.filter((edge) => edge.sourceId === gw).map((edge) => edge.points[0]!), ...es.filter((edge) => edge.targetId === gw).map((edge) => edge.points[edge.points.length - 1]!)].map(key);
    for (const gw of ['G1', 'J']) {
      const docks = docksOf(gw);
      expect(docks).toHaveLength(3);
      for (const dock of docks) expect(vertices(shapesAfter.get(gw)!.bounds), `${gw} ${dock}`).toContain(dock);
    }
    expect(new Set(docksOf('G1')).size).toBe(3);
    // T1, now in the lower lane, rises into J's bottom vertex beside T2's flow (bpmn-js draws a join so), without crossing it
    const joinBounds = shapesAfter.get('J')!.bounds;
    const end = (id: string): string => key(edges(after).get(id)!.points.at(-1)!);
    expect(end('f4')).toBe(`${joinBounds.x + joinBounds.width / 2},${bottom(joinBounds)}`);
    expect(end('f5')).toBe(end('f4'));
    const between = LayoutAnalysis.of(after.definitions).problems.filter((problem) => problem.ids.includes('f4') && problem.ids.includes('f5'));
    expect(between).toEqual([]);
  });

  it('remove: when other rows block the strip, the row of the removed node closes on its own', async () => {
    const xml = fixture('polish-remove.bpmn');
    const { before, after } = await run(xml, [{ op: 'remove', ids: ['X'] }]);
    const shapesBefore = shapes(before);
    const shapesAfter = shapes(after);
    const dx = shapesAfter.get('M')!.bounds.x - shapesBefore.get('M')!.bounds.x;
    expect(shapesAfter.get('M')!.bounds.x).toBe(shapesBefore.get('X')!.bounds.x);
    expect(shapesAfter.get('E2')!.bounds.x - shapesBefore.get('E2')!.bounds.x).toBe(dx);
    expect(shapesAfter.get('M')!.label!.x - shapesBefore.get('M')!.label!.x).toBe(dx);
    for (const id of ['S', 'H', 'B', 'E1', 'Org']) expect(shapesAfter.get(id)!.bounds, id).toEqual(shapesBefore.get(id)!.bounds);
    expect(LayoutAnalysis.of(after.definitions).counts.overlaps).toBe(0);
  });

  it('remove: the row stays when closing it would leave an associated artifact behind', async () => {
    const xml = fixture('polish-remove.bpmn')
      .replace('<bpmn:sequenceFlow id="f1"', '<bpmn:textAnnotation id="T"><bpmn:text>Mail to the customer</bpmn:text></bpmn:textAnnotation><bpmn:association id="As" sourceRef="M" targetRef="T"/><bpmn:sequenceFlow id="f1"')
      .replace(
        '<bpmndi:BPMNEdge id="f1_di"',
        '<bpmndi:BPMNShape id="T_di" bpmnElement="T"><dc:Bounds x="600" y="100" width="120" height="30"/></bpmndi:BPMNShape><bpmndi:BPMNEdge id="As_di" bpmnElement="As"><di:waypoint x="566" y="266"/><di:waypoint x="620" y="130"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge id="f1_di"',
      );
    const { before, after } = await run(xml, [{ op: 'remove', ids: ['X'] }]);
    const shapesBefore = shapes(before);
    const shapesAfter = shapes(after);
    for (const id of ['M', 'E2', 'T']) expect(shapesAfter.get(id)!.bounds, id).toEqual(shapesBefore.get(id)!.bounds);
  });
});
