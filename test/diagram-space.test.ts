/**
 * The geometry tools of the incremental engine on hand-built planes:
 * src/diagram/space.ts (space tool, strip closing, frame growth) and
 * src/diagram/separate.ts (local overlap removal, tidy).
 */
import { describe, expect, it } from 'vitest';
import type { Box, Point } from '../src/layout/types.js';
import type { El } from '../src/model.js';
import type { DEdge, DShape, Plane } from '../src/diagram/plane.js';
import { closeStrip, fitInFrame, makeSpace, shiftShape } from '../src/diagram/space.js';
import { separate, tidy } from '../src/diagram/separate.js';

const EL = {} as El;

function sh(id: string, kind: DShape['kind'], b: [number, number, number, number], extra: Partial<DShape> = {}): DShape {
  const container = kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && extra.expanded === true);
  return { id, el: EL, kind, container, bounds: { x: b[0], y: b[1], width: b[2], height: b[3] }, ...extra };
}

function ed(id: string, sourceId: string, targetId: string, pts: Array<[number, number]>): DEdge {
  return { id, el: EL, kind: 'sequenceFlow', sourceId, targetId, points: pts.map(([x, y]) => ({ x, y })) };
}

function plane(shapes: DShape[], edges: DEdge[] = []): Plane {
  return { id: 'p', rootId: 'r', root: EL, shapes: new Map(shapes.map((s) => [s.id, s])), edges: new Map(edges.map((e) => [e.id, e])), dropped: [] };
}

const box = (p: Plane, id: string): Box => p.shapes.get(id)!.bounds;
const pts = (p: Plane, id: string): Point[] => p.edges.get(id)!.points;

/** A pool with two lanes; A -> B in lane 1, C in lane 2; B has a boundary event and a label. */
function pooled(): Plane {
  return plane(
    [
      sh('Pool', 'participant', [100, 100, 700, 300]),
      sh('L1', 'lane', [130, 100, 670, 150], { poolId: 'Pool' }),
      sh('L2', 'lane', [130, 250, 670, 150], { poolId: 'Pool' }),
      sh('A', 'task', [200, 135, 100, 80], { laneId: 'L1', poolId: 'Pool' }),
      sh('B', 'task', [400, 135, 100, 80], { laneId: 'L1', poolId: 'Pool', label: { x: 400, y: 220, width: 40, height: 14 } }),
      sh('BE', 'boundary', [460, 197, 36, 36], { hostId: 'B', laneId: 'L1', poolId: 'Pool' }),
      sh('C', 'task', [400, 285, 100, 80], { laneId: 'L2', poolId: 'Pool' }),
    ],
    [ed('F1', 'A', 'B', [[300, 175], [400, 175]]), ed('F2', 'A', 'C', [[250, 215], [250, 325], [400, 325]])],
  );
}

describe('makeSpace', () => {
  it('moves shapes beyond the line, grows containers crossing it, keeps the rest', () => {
    const p = pooled();
    const r = makeSpace(p, { axis: 'x', line: 350, delta: 120 });
    expect(box(p, 'A')).toEqual({ x: 200, y: 135, width: 100, height: 80 });
    expect(box(p, 'B').x).toBe(520);
    expect(box(p, 'BE').x).toBe(580);
    expect(p.shapes.get('B')!.label!.x).toBe(520);
    expect(box(p, 'C').x).toBe(520);
    expect(box(p, 'Pool').width).toBe(820);
    expect(box(p, 'L1').width).toBe(790);
    expect(box(p, 'L2').width).toBe(790);
    expect([...r.moved].sort()).toEqual(['B', 'BE', 'C']);
    expect(pts(p, 'F1')).toEqual([{ x: 300, y: 175 }, { x: 520, y: 175 }]);
    expect(pts(p, 'F2')).toEqual([{ x: 250, y: 215 }, { x: 250, y: 325 }, { x: 520, y: 325 }]);
  });

  it('confines the effect to the band of `within`', () => {
    const p = pooled();
    makeSpace(p, { axis: 'x', line: 350, delta: 50, within: { x: 0, y: 100, width: 1000, height: 150 } });
    expect(box(p, 'B').x).toBe(450);
    expect(box(p, 'C').x).toBe(400);
    // the lanes stay aligned with the grown pool
    expect(box(p, 'L2').width).toBe(box(p, 'Pool').width - 30);
  });

  it('on the y axis moves lanes below and grows the pool; content follows its pool', () => {
    const p = pooled();
    p.shapes.set('Pool2', sh('Pool2', 'participant', [100, 450, 700, 200]));
    p.shapes.set('D', sh('D', 'task', [700, 500, 100, 80], { poolId: 'Pool2' }));
    makeSpace(p, { axis: 'y', line: 249, delta: 60, within: { x: 400, y: 0, width: 100, height: 1000 } });
    expect(box(p, 'L1').height).toBe(210);
    expect(box(p, 'L2').y).toBe(310);
    expect(box(p, 'Pool').height).toBe(360);
    expect(box(p, 'C').y).toBe(345);
    // Pool2 overlaps the band and lies beyond the line: it moves with all of its content, D included
    expect(box(p, 'Pool2').y).toBe(510);
    expect(box(p, 'D').y).toBe(560);
    expect(box(p, 'A').y).toBe(135);
  });

  it('never touches kept shapes', () => {
    const p = pooled();
    makeSpace(p, { axis: 'x', line: 350, delta: 50, keep: new Set(['B']) });
    expect(box(p, 'B').x).toBe(400);
    expect(box(p, 'BE').x).toBe(460);
    expect(box(p, 'C').x).toBe(450);
  });

  it('moves the content of a container that lies beyond the line with it', () => {
    const p = plane([sh('Sub', 'subProcess', [400, 100, 300, 200], { expanded: true }), sh('In', 'task', [450, 150, 100, 80], { parentId: 'Sub' })]);
    makeSpace(p, { axis: 'y', line: 90, delta: 40, within: { x: 600, y: 0, width: 200, height: 500 } });
    expect(box(p, 'Sub').y).toBe(140);
    expect(box(p, 'In').y).toBe(190);
  });
});

/** A pool with one lane; the lane holds an expanded sub-process (content SA, SB; boundary events on its bottom and right border) and a task T right of it. */
function withSub(): Plane {
  return plane(
    [
      sh('Pool', 'participant', [100, 100, 900, 400]),
      sh('L1', 'lane', [130, 100, 870, 400], { poolId: 'Pool' }),
      sh('SP', 'subProcess', [200, 150, 500, 200], { expanded: true, laneId: 'L1', poolId: 'Pool' }),
      sh('SA', 'task', [240, 200, 100, 80], { parentId: 'SP', laneId: 'L1', poolId: 'Pool' }),
      sh('SB', 'task', [540, 200, 100, 80], { parentId: 'SP', laneId: 'L1', poolId: 'Pool' }),
      sh('BB', 'boundary', [600, 332, 36, 36], { hostId: 'SP', laneId: 'L1', poolId: 'Pool', label: { x: 640, y: 352, width: 30, height: 14 } }),
      sh('BL', 'boundary', [232, 332, 36, 36], { hostId: 'SP', laneId: 'L1', poolId: 'Pool' }),
      sh('BR', 'boundary', [682, 230, 36, 36], { hostId: 'SP', laneId: 'L1', poolId: 'Pool' }),
      sh('T', 'task', [850, 400, 100, 80], { laneId: 'L1', poolId: 'Pool' }),
    ],
    [ed('G', 'SA', 'SB', [[340, 240], [540, 240]])],
  );
}

describe('makeSpace and boundary events / shrinking', () => {
  it('boundary events of a resized sub-process stay on its border: the part beyond the line moves', () => {
    const p = withSub();
    makeSpace(p, { axis: 'y', line: 349, delta: 60 });
    expect(box(p, 'SP').height).toBe(260);
    // bottom-border events follow the bottom border, with their label; the right-border event (above the line) stays
    expect(box(p, 'BB').y).toBe(392);
    expect(box(p, 'BL').y).toBe(392);
    expect(p.shapes.get('BB')!.label!.y).toBe(412);
    expect(box(p, 'BR').y).toBe(230);
    const q = withSub();
    makeSpace(q, { axis: 'x', line: 699, delta: 40 });
    expect(box(q, 'BR').x).toBe(722);
    expect(box(q, 'BB').x).toBe(600);
  });

  it('a negative delta in a sub-process band shrinks only the containers inside the band, never past their content', () => {
    const p = withSub();
    const r = makeSpace(p, { axis: 'x', line: 400, delta: -100, within: { ...box(p, 'SP') } });
    expect(box(p, 'Pool').width).toBe(900);
    expect(box(p, 'L1').width).toBe(870);
    expect(box(p, 'SP').width).toBe(400);
    expect(box(p, 'SB').x).toBe(440);
    expect(r.resized.has('Pool')).toBe(false);
    // shrinking further than the content allows stops 10 px after it
    const q = withSub();
    makeSpace(q, { axis: 'x', line: 660, delta: -150, within: { ...box(q, 'SP') } });
    expect(box(q, 'SP').x + box(q, 'SP').width).toBe(650);
  });

  it('a collaboration-level artifact drawn in a pool moves with it', () => {
    const p = withSub();
    p.shapes.set('Pool2', sh('Pool2', 'participant', [100, 550, 900, 200]));
    p.shapes.set('Note', sh('Note', 'annotation', [300, 540, 100, 30]));
    makeSpace(p, { axis: 'y', line: 520, delta: 50, within: { x: 100, y: 0, width: 150, height: 1000 } });
    expect(box(p, 'Pool2').y).toBe(600);
    expect(box(p, 'Note').y).toBe(590);
  });

  it('fitInFrame keeps an expanded sub-process together with its content and inner connections', () => {
    const p = withSub();
    // the sub-process sticks out of the lane at the bottom (its content below the line the lane grows at):
    // the lane grows, the content and the connection inside do not move
    box(p, 'SP').y = 380;
    box(p, 'SP').height = 260;
    box(p, 'SA').y = 520;
    box(p, 'SB').y = 520;
    p.edges.get('G')!.points = [{ x: 340, y: 560 }, { x: 540, y: 560 }];
    fitInFrame(p, 'SP', 15);
    expect(box(p, 'L1').height).toBeGreaterThan(400);
    expect(box(p, 'SA').y).toBe(520);
    expect(box(p, 'SB').y).toBe(520);
    expect(pts(p, 'G')).toEqual([{ x: 340, y: 560 }, { x: 540, y: 560 }]);
  });
});

describe('closeStrip', () => {
  it('pulls everything back when the strip is empty', () => {
    const p = plane([sh('A', 'task', [100, 100, 100, 80]), sh('C', 'task', [500, 100, 100, 80])], [ed('F', 'A', 'C', [[200, 140], [500, 140]])]);
    const r = closeStrip(p, { axis: 'x', from: 240, to: 460, gap: 60 });
    expect(r).toBeDefined();
    expect(box(p, 'C').x).toBe(340);
    expect(pts(p, 'F')).toEqual([{ x: 200, y: 140 }, { x: 340, y: 140 }]);
  });

  it('refuses when a shape, a label or a bend is in the strip', () => {
    const shape = plane([sh('A', 'task', [100, 100, 100, 80]), sh('X', 'event', [300, 400, 36, 36]), sh('C', 'task', [500, 100, 100, 80])]);
    expect(closeStrip(shape, { axis: 'x', from: 240, to: 460, gap: 60 })).toBeUndefined();
    const label = plane([sh('A', 'task', [100, 100, 100, 80], { label: { x: 320, y: 200, width: 40, height: 14 } }), sh('C', 'task', [500, 100, 100, 80])]);
    expect(closeStrip(label, { axis: 'x', from: 240, to: 460, gap: 60 })).toBeUndefined();
    const bend = plane([sh('A', 'task', [100, 100, 100, 80]), sh('C', 'task', [500, 100, 100, 80])], [ed('F', 'A', 'C', [[150, 180], [150, 300], [350, 300], [350, 400], [550, 400], [550, 180]])]);
    expect(closeStrip(bend, { axis: 'x', from: 240, to: 460, gap: 60 })).toBeUndefined();
    expect(closeStrip(bend, { axis: 'x', from: 240, to: 460, gap: 60, ignore: new Set(['F']) })).toBeDefined();
  });
});

describe('fitInFrame and shiftShape', () => {
  it('grows the lane and the pool around a shape that sticks out', () => {
    const p = pooled();
    box(p, 'A').y = 200; // reaches 280 > lane bottom 250
    fitInFrame(p, 'A', 15);
    expect(box(p, 'L1').height).toBe(195);
    expect(box(p, 'L2').y).toBe(295);
    expect(box(p, 'Pool').height).toBe(345);
    expect(box(p, 'A').y).toBe(200);
  });

  it('moves a host with its label and boundary events', () => {
    const p = pooled();
    expect(shiftShape(p, 'B', 10, 5).sort()).toEqual(['B', 'BE']);
    expect(box(p, 'BE')).toMatchObject({ x: 470, y: 202 });
    expect(p.shapes.get('B')!.label).toMatchObject({ x: 410, y: 225 });
  });
});

describe('separate', () => {
  it('pushes the later of two overlapping shapes right, never the fixed ones', () => {
    const p = plane([sh('A', 'task', [100, 100, 100, 80]), sh('N', 'task', [210, 100, 100, 80]), sh('B', 'task', [290, 100, 100, 80])]);
    const r = separate(p, { active: ['N'], movable: ['N', 'B'] });
    expect(box(p, 'A').x).toBe(100);
    expect(box(p, 'N').x).toBe(220);
    expect(box(p, 'B').x).toBe(340);
    expect([...r.moved].sort()).toEqual(['B', 'N']);
    expect(r.unresolved).toEqual([]);
  });

  it('leaves conflicts that already existed before the edit alone', () => {
    const p = plane([sh('A', 'task', [100, 100, 100, 80]), sh('B', 'task', [205, 100, 100, 80]), sh('N', 'event', [400, 300, 36, 36])]);
    const baseline = new Map([...p.shapes.values()].filter((s) => s.id !== 'N').map((s) => [s.id, { ...s.bounds }]));
    box(p, 'B').y += 1; // B moved a little but its conflict with A is not worse
    separate(p, { active: ['B', 'N'], movable: ['A', 'B', 'N'], baseline });
    expect(box(p, 'A').x).toBe(100);
    expect(box(p, 'B')).toMatchObject({ x: 205, y: 101 });
  });

  it('checks only the own box of a new boundary event, with a smaller gap', () => {
    const p = plane([sh('H', 'task', [100, 100, 100, 80]), sh('BE', 'boundary', [160, 162, 36, 36], { hostId: 'H' }), sh('X', 'task', [220, 120, 100, 80])]);
    separate(p, { active: ['BE'], movable: ['H', 'X'] });
    // 24 px between the event and X: fine for a boundary event (8 px), so nothing moves
    expect(box(p, 'X').x).toBe(220);
    expect(box(p, 'H').x).toBe(100);
  });

  it('grows the frame instead of leaving it', () => {
    const p = pooled();
    p.shapes.set('N', sh('N', 'task', [400, 150, 100, 80], { laneId: 'L1', poolId: 'Pool' }));
    separate(p, { active: ['N'], movable: ['N', 'B'] });
    const n = box(p, 'N');
    const b = box(p, 'B');
    expect(n.y >= b.y + b.height + 20 || n.x >= b.x + b.width + 20 || b.x >= n.x + n.width + 20).toBe(true);
    const lane = box(p, 'L1');
    for (const id of ['N', 'B']) expect(box(p, id).y + box(p, id).height).toBeLessThanOrEqual(lane.y + lane.height);
  });

  it('tidy removes overlaps among all shapes, keeping the order', () => {
    const p = plane([sh('A', 'task', [100, 100, 100, 80]), sh('B', 'task', [150, 100, 100, 80]), sh('C', 'task', [180, 120, 100, 80])]);
    const r = tidy(p);
    expect(r.unresolved).toEqual([]);
    const [a, b, c] = ['A', 'B', 'C'].map((id) => box(p, id));
    expect(a!.x).toBe(100);
    for (const [s, t] of [[a!, b!], [a!, c!], [b!, c!]] as const) {
      const gapX = Math.max(t.x - (s.x + s.width), s.x - (t.x + t.width));
      const gapY = Math.max(t.y - (s.y + s.height), s.y - (t.y + t.height));
      expect(gapX >= 20 || gapY >= 20).toBe(true);
    }
    expect(b!.x).toBeGreaterThanOrEqual(a!.x);
  });
});
