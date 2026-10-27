/**
 * The geometry tools of the incremental engine on hand-built planes:
 * src/domain/diagram/layout/incremental/SpaceTool.ts (space tool, strip closing, frame growth) and
 * src/domain/diagram/layout/incremental/Separation.ts (local overlap removal, tidy).
 */
import { describe, expect, it } from 'vitest';
import type { Box, Point } from '../../../src/domain/diagram/di/types.js';
import type { El } from '../../../src/domain/document/utils/moddle.js';
import type { DEdge, DShape, Plane } from '../../../src/domain/diagram/di/types.js';
import { Drawing } from '../../../src/domain/diagram/layout/incremental/Drawing.js';

const EL = {} as El;

function sh(id: string, kind: DShape['kind'], bounds: [number, number, number, number], extra: Partial<DShape> = {}): DShape {
  const container = kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && extra.expanded === true);
  return { id, el: EL, kind, container, bounds: { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] }, ...extra };
}

function ed(id: string, sourceId: string, targetId: string, pts: Array<[number, number]>): DEdge {
  return { id, el: EL, kind: 'sequenceFlow', sourceId, targetId, points: pts.map(([pointX, pointY]) => ({ x: pointX, y: pointY })) };
}

function plane(shapes: DShape[], edges: DEdge[] = []): Plane {
  return { id: 'p', rootId: 'r', root: EL, shapes: new Map(shapes.map((shape) => [shape.id, shape])), edges: new Map(edges.map((edge) => [edge.id, edge])), dropped: [] };
}

const box = (drawingPlane: Plane, id: string): Box => drawingPlane.shapes.get(id)!.bounds;
const pts = (drawingPlane: Plane, id: string): Point[] => drawingPlane.edges.get(id)!.points;

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
    const drawingPlane = pooled();
    const result = new Drawing(drawingPlane).makeSpace({ axis: 'x', line: 350, delta: 120 });
    expect(box(drawingPlane, 'A')).toEqual({ x: 200, y: 135, width: 100, height: 80 });
    expect(box(drawingPlane, 'B').x).toBe(520);
    expect(box(drawingPlane, 'BE').x).toBe(580);
    expect(drawingPlane.shapes.get('B')!.label!.x).toBe(520);
    expect(box(drawingPlane, 'C').x).toBe(520);
    expect(box(drawingPlane, 'Pool').width).toBe(820);
    expect(box(drawingPlane, 'L1').width).toBe(790);
    expect(box(drawingPlane, 'L2').width).toBe(790);
    expect([...result.moved].sort()).toEqual(['B', 'BE', 'C']);
    expect(pts(drawingPlane, 'F1')).toEqual([{ x: 300, y: 175 }, { x: 520, y: 175 }]);
    expect(pts(drawingPlane, 'F2')).toEqual([{ x: 250, y: 215 }, { x: 250, y: 325 }, { x: 520, y: 325 }]);
  });

  it('confines the effect to the band of `within`', () => {
    const drawingPlane = pooled();
    new Drawing(drawingPlane).makeSpace({ axis: 'x', line: 350, delta: 50, within: { x: 0, y: 100, width: 1000, height: 150 } });
    expect(box(drawingPlane, 'B').x).toBe(450);
    expect(box(drawingPlane, 'C').x).toBe(400);
    // the lanes stay aligned with the grown pool
    expect(box(drawingPlane, 'L2').width).toBe(box(drawingPlane, 'Pool').width - 30);
  });

  it('on the y axis moves lanes below and grows the pool; content follows its pool', () => {
    const drawingPlane = pooled();
    drawingPlane.shapes.set('Pool2', sh('Pool2', 'participant', [100, 450, 700, 200]));
    drawingPlane.shapes.set('D', sh('D', 'task', [700, 500, 100, 80], { poolId: 'Pool2' }));
    new Drawing(drawingPlane).makeSpace({ axis: 'y', line: 249, delta: 60, within: { x: 400, y: 0, width: 100, height: 1000 } });
    expect(box(drawingPlane, 'L1').height).toBe(210);
    expect(box(drawingPlane, 'L2').y).toBe(310);
    expect(box(drawingPlane, 'Pool').height).toBe(360);
    expect(box(drawingPlane, 'C').y).toBe(345);
    // Pool2 overlaps the band and lies beyond the line: it moves with all of its content, D included
    expect(box(drawingPlane, 'Pool2').y).toBe(510);
    expect(box(drawingPlane, 'D').y).toBe(560);
    expect(box(drawingPlane, 'A').y).toBe(135);
  });

  it('never touches kept shapes', () => {
    const drawingPlane = pooled();
    new Drawing(drawingPlane).makeSpace({ axis: 'x', line: 350, delta: 50, keep: new Set(['B']) });
    expect(box(drawingPlane, 'B').x).toBe(400);
    expect(box(drawingPlane, 'BE').x).toBe(460);
    expect(box(drawingPlane, 'C').x).toBe(450);
  });

  it('moves the content of a container that lies beyond the line with it', () => {
    const drawingPlane = plane([sh('Sub', 'subProcess', [400, 100, 300, 200], { expanded: true }), sh('In', 'task', [450, 150, 100, 80], { parentId: 'Sub' })]);
    new Drawing(drawingPlane).makeSpace({ axis: 'y', line: 90, delta: 40, within: { x: 600, y: 0, width: 200, height: 500 } });
    expect(box(drawingPlane, 'Sub').y).toBe(140);
    expect(box(drawingPlane, 'In').y).toBe(190);
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
    const drawingPlane = withSub();
    new Drawing(drawingPlane).makeSpace({ axis: 'y', line: 349, delta: 60 });
    expect(box(drawingPlane, 'SP').height).toBe(260);
    // bottom-border events follow the bottom border, with their label; the right-border event (above the line) stays
    expect(box(drawingPlane, 'BB').y).toBe(392);
    expect(box(drawingPlane, 'BL').y).toBe(392);
    expect(drawingPlane.shapes.get('BB')!.label!.y).toBe(412);
    expect(box(drawingPlane, 'BR').y).toBe(230);
    const otherPlane = withSub();
    new Drawing(otherPlane).makeSpace({ axis: 'x', line: 699, delta: 40 });
    expect(box(otherPlane, 'BR').x).toBe(722);
    expect(box(otherPlane, 'BB').x).toBe(600);
  });

  it('a negative delta in a sub-process band shrinks only the containers inside the band, never past their content', () => {
    const drawingPlane = withSub();
    const result = new Drawing(drawingPlane).makeSpace({ axis: 'x', line: 400, delta: -100, within: { ...box(drawingPlane, 'SP') } });
    expect(box(drawingPlane, 'Pool').width).toBe(900);
    expect(box(drawingPlane, 'L1').width).toBe(870);
    expect(box(drawingPlane, 'SP').width).toBe(400);
    expect(box(drawingPlane, 'SB').x).toBe(440);
    expect(result.resized.has('Pool')).toBe(false);
    // shrinking further than the content allows stops 10 px after it
    const otherPlane = withSub();
    new Drawing(otherPlane).makeSpace({ axis: 'x', line: 660, delta: -150, within: { ...box(otherPlane, 'SP') } });
    expect(box(otherPlane, 'SP').x + box(otherPlane, 'SP').width).toBe(650);
  });

  it('a collaboration-level artifact drawn in a pool moves with it', () => {
    const drawingPlane = withSub();
    drawingPlane.shapes.set('Pool2', sh('Pool2', 'participant', [100, 550, 900, 200]));
    drawingPlane.shapes.set('Note', sh('Note', 'annotation', [300, 540, 100, 30]));
    new Drawing(drawingPlane).makeSpace({ axis: 'y', line: 520, delta: 50, within: { x: 100, y: 0, width: 150, height: 1000 } });
    expect(box(drawingPlane, 'Pool2').y).toBe(600);
    expect(box(drawingPlane, 'Note').y).toBe(590);
  });

  it('fitInFrame keeps an expanded sub-process together with its content and inner connections', () => {
    const drawingPlane = withSub();
    // the sub-process sticks out of the lane at the bottom (its content below the line the lane grows at):
    // the lane grows, the content and the connection inside do not move
    box(drawingPlane, 'SP').y = 380;
    box(drawingPlane, 'SP').height = 260;
    box(drawingPlane, 'SA').y = 520;
    box(drawingPlane, 'SB').y = 520;
    drawingPlane.edges.get('G')!.points = [{ x: 340, y: 560 }, { x: 540, y: 560 }];
    new Drawing(drawingPlane).fitInFrame('SP', 15);
    expect(box(drawingPlane, 'L1').height).toBeGreaterThan(400);
    expect(box(drawingPlane, 'SA').y).toBe(520);
    expect(box(drawingPlane, 'SB').y).toBe(520);
    expect(pts(drawingPlane, 'G')).toEqual([{ x: 340, y: 560 }, { x: 540, y: 560 }]);
  });
});

describe('closeStrip', () => {
  it('pulls everything back when the strip is empty', () => {
    const drawingPlane = plane([sh('A', 'task', [100, 100, 100, 80]), sh('C', 'task', [500, 100, 100, 80])], [ed('F', 'A', 'C', [[200, 140], [500, 140]])]);
    const result = new Drawing(drawingPlane).closeStrip({ axis: 'x', from: 240, to: 460, gap: 60 });
    expect(result).toBeDefined();
    expect(box(drawingPlane, 'C').x).toBe(340);
    expect(pts(drawingPlane, 'F')).toEqual([{ x: 200, y: 140 }, { x: 340, y: 140 }]);
  });

  it('refuses when a shape, a label or a bend is in the strip', () => {
    const shape = plane([sh('A', 'task', [100, 100, 100, 80]), sh('X', 'event', [300, 400, 36, 36]), sh('C', 'task', [500, 100, 100, 80])]);
    expect(new Drawing(shape).closeStrip({ axis: 'x', from: 240, to: 460, gap: 60 })).toBeUndefined();
    const label = plane([sh('A', 'task', [100, 100, 100, 80], { label: { x: 320, y: 200, width: 40, height: 14 } }), sh('C', 'task', [500, 100, 100, 80])]);
    expect(new Drawing(label).closeStrip({ axis: 'x', from: 240, to: 460, gap: 60 })).toBeUndefined();
    const bend = plane([sh('A', 'task', [100, 100, 100, 80]), sh('C', 'task', [500, 100, 100, 80])], [ed('F', 'A', 'C', [[150, 180], [150, 300], [350, 300], [350, 400], [550, 400], [550, 180]])]);
    expect(new Drawing(bend).closeStrip({ axis: 'x', from: 240, to: 460, gap: 60 })).toBeUndefined();
    expect(new Drawing(bend).closeStrip({ axis: 'x', from: 240, to: 460, gap: 60, ignore: new Set(['F']) })).toBeDefined();
  });
});

describe('fitInFrame and shiftShape', () => {
  it('grows the lane and the pool around a shape that sticks out', () => {
    const drawingPlane = pooled();
    box(drawingPlane, 'A').y = 200; // reaches 280 > lane bottom 250
    new Drawing(drawingPlane).fitInFrame('A', 15);
    expect(box(drawingPlane, 'L1').height).toBe(195);
    expect(box(drawingPlane, 'L2').y).toBe(295);
    expect(box(drawingPlane, 'Pool').height).toBe(345);
    expect(box(drawingPlane, 'A').y).toBe(200);
  });

  it('moves a host with its label and boundary events', () => {
    const drawingPlane = pooled();
    expect(new Drawing(drawingPlane).shift('B', 10, 5).sort()).toEqual(['B', 'BE']);
    expect(box(drawingPlane, 'BE')).toMatchObject({ x: 470, y: 202 });
    expect(drawingPlane.shapes.get('B')!.label).toMatchObject({ x: 410, y: 225 });
  });
});

describe('separate', () => {
  it('pushes the later of two overlapping shapes right, never the fixed ones', () => {
    const drawingPlane = plane([sh('A', 'task', [100, 100, 100, 80]), sh('N', 'task', [210, 100, 100, 80]), sh('B', 'task', [290, 100, 100, 80])]);
    const result = new Drawing(drawingPlane).separate({ active: ['N'], movable: ['N', 'B'] });
    expect(box(drawingPlane, 'A').x).toBe(100);
    expect(box(drawingPlane, 'N').x).toBe(220);
    expect(box(drawingPlane, 'B').x).toBe(340);
    expect([...result.moved].sort()).toEqual(['B', 'N']);
    expect(result.unresolved).toEqual([]);
  });

  it('leaves conflicts that already existed before the edit alone', () => {
    const drawingPlane = plane([sh('A', 'task', [100, 100, 100, 80]), sh('B', 'task', [205, 100, 100, 80]), sh('N', 'event', [400, 300, 36, 36])]);
    const baseline = new Map([...drawingPlane.shapes.values()].filter((shape) => shape.id !== 'N').map((shape) => [shape.id, { ...shape.bounds }]));
    box(drawingPlane, 'B').y += 1; // B moved a little but its conflict with A is not worse
    new Drawing(drawingPlane).separate({ active: ['B', 'N'], movable: ['A', 'B', 'N'], baseline });
    expect(box(drawingPlane, 'A').x).toBe(100);
    expect(box(drawingPlane, 'B')).toMatchObject({ x: 205, y: 101 });
  });

  it('checks only the own box of a new boundary event, with a smaller gap', () => {
    const drawingPlane = plane([sh('H', 'task', [100, 100, 100, 80]), sh('BE', 'boundary', [160, 162, 36, 36], { hostId: 'H' }), sh('X', 'task', [220, 120, 100, 80])]);
    new Drawing(drawingPlane).separate({ active: ['BE'], movable: ['H', 'X'] });
    // 24 px between the event and X: fine for a boundary event (8 px), so nothing moves
    expect(box(drawingPlane, 'X').x).toBe(220);
    expect(box(drawingPlane, 'H').x).toBe(100);
  });

  it('grows the frame instead of leaving it', () => {
    const drawingPlane = pooled();
    drawingPlane.shapes.set('N', sh('N', 'task', [400, 150, 100, 80], { laneId: 'L1', poolId: 'Pool' }));
    new Drawing(drawingPlane).separate({ active: ['N'], movable: ['N', 'B'] });
    const boxOfN = box(drawingPlane, 'N');
    const boxOfB = box(drawingPlane, 'B');
    expect(boxOfN.y >= boxOfB.y + boxOfB.height + 20 || boxOfN.x >= boxOfB.x + boxOfB.width + 20 || boxOfB.x >= boxOfN.x + boxOfN.width + 20).toBe(true);
    const lane = box(drawingPlane, 'L1');
    for (const id of ['N', 'B']) expect(box(drawingPlane, id).y + box(drawingPlane, id).height).toBeLessThanOrEqual(lane.y + lane.height);
  });

  it('tidy removes overlaps among all shapes, keeping the order', () => {
    const drawingPlane = plane([sh('A', 'task', [100, 100, 100, 80]), sh('B', 'task', [150, 100, 100, 80]), sh('C', 'task', [180, 120, 100, 80])]);
    const result = new Drawing(drawingPlane).tidy();
    expect(result.unresolved).toEqual([]);
    const [boxA, boxB, boxC] = ['A', 'B', 'C'].map((id) => box(drawingPlane, id));
    expect(boxA!.x).toBe(100);
    for (const [first, second] of [[boxA!, boxB!], [boxA!, boxC!], [boxB!, boxC!]] as const) {
      const gapX = Math.max(second.x - (first.x + first.width), first.x - (second.x + second.width));
      const gapY = Math.max(second.y - (first.y + first.height), first.y - (second.y + second.height));
      expect(gapX >= 20 || gapY >= 20).toBe(true);
    }
    expect(boxB!.x).toBeGreaterThanOrEqual(boxA!.x);
  });
});
