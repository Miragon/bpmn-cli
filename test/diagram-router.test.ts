/**
 * Tests of the single-connection orthogonal router (src/diagram/router.ts).
 *
 * Every route is checked against the contract (`expectValid`): ≥ 2 points,
 * orthogonal segments without zero-length or collinear interior points, the
 * first point on an allowed side of the source border, the last on an allowed
 * side of the target border, ≥ 15 px straight stubs before the first and
 * after the last bend, no obstacle cut (unless the test says so), inside the
 * frame when one is given. The scenarios then assert the shape of the route.
 */
import { describe, expect, it } from 'vitest';
import { attachedSide, defaultSides } from '../src/diagram/utils/sides.js';
import { OrthogonalRouter, type RouteRequest } from '../src/diagram/OrthogonalRouter.js';
import { type Side } from '../src/diagram/types.js';
import type { Box, Point } from '../src/diagram/types.js';

const box = (x: number, y: number, width = 100, height = 80): Box => ({ x, y, width, height });
const TASK_OUT = defaultSides('task', 'source');
const TASK_IN = defaultSides('task', 'target');

function sideOf(p: Point, b: Box): Side | undefined {
  const inX = p.x >= b.x && p.x <= b.x + b.width;
  const inY = p.y >= b.y && p.y <= b.y + b.height;
  if (inY && p.x === b.x) return 'left';
  if (inY && p.x === b.x + b.width) return 'right';
  if (inX && p.y === b.y) return 'top';
  if (inX && p.y === b.y + b.height) return 'bottom';
  return undefined;
}

function hits(points: Point[], b: Box): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, c = points[i + 1]!;
    if (Math.min(a.x, c.x) < b.x + b.width && Math.max(a.x, c.x) > b.x && Math.min(a.y, c.y) < b.y + b.height && Math.max(a.y, c.y) > b.y) return true;
  }
  return false;
}

function crossings(points: Point[], line: Point[]): number {
  const orient = (a: Point, b: Point, c: Point): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  let n = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    for (let k = 0; k + 1 < line.length; k++) {
      const a = points[i]!, b = points[i + 1]!, c = line[k]!, d = line[k + 1]!;
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) n++;
    }
  }
  return n;
}

const segLen = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

interface Expect {
  /** the route may cut obstacles (no free route exists) */
  mayHit?: boolean;
  /** the route may leave the frame (nothing free fits inside) */
  mayLeaveFrame?: boolean;
}

function expectValid(req: RouteRequest, points: Point[], opts: Expect = {}): void {
  expect(points.length).toBeGreaterThanOrEqual(2);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    expect(a.x === b.x || a.y === b.y, `segment ${i} orthogonal`).toBe(true);
    expect(segLen(a, b), `segment ${i} not empty`).toBeGreaterThan(0);
    const c = points[i + 2];
    if (c) expect((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y), `point ${i + 1} is a bend`).toBe(false);
  }
  for (const p of points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  const first = sideOf(points[0]!, req.source), last = sideOf(points[points.length - 1]!, req.target);
  expect(first, 'first point on the source border').toBeDefined();
  expect(last, 'last point on the target border').toBeDefined();
  expect(req.sourceSides ?? ['left', 'right', 'top', 'bottom']).toContain(first);
  expect(req.targetSides ?? ['left', 'right', 'top', 'bottom']).toContain(last);
  if (points.length > 2) {
    expect(segLen(points[0]!, points[1]!), 'source stub').toBeGreaterThanOrEqual(15);
    expect(segLen(points[points.length - 2]!, points[points.length - 1]!), 'target stub').toBeGreaterThanOrEqual(15);
  }
  if (!opts.mayHit) {
    for (const o of req.obstacles) expect(hits(points, o), `cuts obstacle ${JSON.stringify(o)}`).toBe(false);
    expect(hits(points, req.source), 'cuts the source').toBe(false);
    expect(hits(points, req.target), 'cuts the target').toBe(false);
  }
  if (req.frame && !opts.mayLeaveFrame) {
    const f = req.frame;
    for (const p of points) {
      expect(p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height, `${JSON.stringify(p)} inside the frame`).toBe(true);
    }
  }
}

function route(req: RouteRequest, opts: Expect = {}): Point[] {
  const points = OrthogonalRouter.route(req);
  expectValid(req, points, opts);
  return points;
}

/** deterministic pseudo random numbers (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('routeOrthogonal: basic shapes', () => {
  it('draws a straight horizontal line between facing boxes on one row', () => {
    const pts = route({ source: box(0, 0), target: box(300, 0), obstacles: [], sourceSides: TASK_OUT, targetSides: TASK_IN });
    expect(pts).toEqual([{ x: 100, y: 40 }, { x: 300, y: 40 }]);
  });

  it('stays straight when the centres differ but the boxes face each other (offset port on the larger box)', () => {
    const req = { source: box(0, 0), target: box(300, 30, 36, 36), obstacles: [], sourceSides: TASK_OUT, targetSides: defaultSides('event', 'target') };
    expect(route(req)).toEqual([{ x: 100, y: 48 }, { x: 300, y: 48 }]);
  });

  it('draws a straight vertical line between stacked boxes', () => {
    const pts = route({ source: box(0, 0), target: box(0, 200), obstacles: [], sourceSides: ['bottom'], targetSides: ['top'] });
    expect(pts).toEqual([{ x: 50, y: 80 }, { x: 50, y: 200 }]);
  });

  it('routes an L to a lower target: down from the source, right into the left side (branch drop)', () => {
    const pts = route({ source: box(0, 0), target: box(300, 200), obstacles: [], sourceSides: TASK_OUT, targetSides: TASK_IN });
    expect(pts).toEqual([{ x: 50, y: 80 }, { x: 50, y: 240 }, { x: 300, y: 240 }]);
  });

  it('routes an L into the top when only the top may be entered', () => {
    const pts = route({ source: box(0, 0), target: box(300, 200), obstacles: [], sourceSides: ['right'], targetSides: ['top'] });
    expect(pts).toEqual([{ x: 100, y: 40 }, { x: 350, y: 40 }, { x: 350, y: 200 }]);
  });

  it('routes a Z (exit right, enter left) with the jog centred between the boxes', () => {
    const pts = route({ source: box(0, 0), target: box(300, 200), obstacles: [], sourceSides: ['right'], targetSides: ['left'] });
    expect(pts).toEqual([{ x: 100, y: 40 }, { x: 200, y: 40 }, { x: 200, y: 240 }, { x: 300, y: 240 }]);
  });

  it('joins an upper target from below: right from the source, up into the bottom', () => {
    const pts = route({ source: box(0, 200), target: box(300, 0, 50, 50), obstacles: [], sourceSides: TASK_OUT, targetSides: defaultSides('gateway', 'target') });
    expect(pts).toEqual([{ x: 100, y: 240 }, { x: 325, y: 240 }, { x: 325, y: 50 }]);
  });
});

describe('routeOrthogonal: obstacles', () => {
  it('goes around a wall between source and target (U-route) without cutting it', () => {
    const wall = box(200, -60, 40, 400);
    const req = { source: box(0, 100), target: box(400, 100), obstacles: [wall], sourceSides: TASK_OUT, targetSides: TASK_IN };
    const pts = route(req);
    expect(pts.length).toBe(4);
    const channel = pts[1]!.y;
    expect(channel < wall.y || channel > wall.y + wall.height).toBe(true);
    expect(pts[1]!.y).toBe(pts[2]!.y);
  });

  it('bypasses a node on the row with a straight line otherwise blocked', () => {
    const blocker = box(200, 0);
    const pts = route({ source: box(0, 0), target: box(400, 0), obstacles: [blocker], sourceSides: TASK_OUT, targetSides: TASK_IN });
    expect(pts.length).toBeGreaterThan(2);
    expect(hits(pts, blocker)).toBe(false);
  });

  it('loops back below the row when the target is left of the source', () => {
    const source = box(400, 0), target = box(0, 0), between = box(200, 0);
    const pts = route({ source, target, obstacles: [between], sourceSides: TASK_OUT, targetSides: TASK_IN });
    expect(sideOf(pts[0]!, source)).toBe('bottom');
    expect(sideOf(pts[pts.length - 1]!, target)).toBe('bottom');
    expect(Math.min(...pts.map((p) => p.y))).toBeGreaterThanOrEqual(80);
    expect(pts).toEqual([{ x: 450, y: 80 }, { x: 450, y: 95 }, { x: 50, y: 95 }, { x: 50, y: 80 }]);
  });

  it('honours forced sides: exit bottom to a target on the same row', () => {
    const source = box(0, 0), target = box(300, 0);
    const pts = route({ source, target, obstacles: [], sourceSides: ['bottom'], targetSides: TASK_IN });
    expect(pts[0]).toEqual({ x: 50, y: 80 });
    expect(pts[1]!.x).toBe(50);
    expect(pts[1]!.y).toBeGreaterThanOrEqual(95);
    expect(sideOf(pts[pts.length - 1]!, target)).toBe('bottom');
  });

  it('moves the port beside a boundary event that blocks the middle of the exit side', () => {
    const host = box(0, 0), event = box(32, 62, 36, 36);
    const req = { source: host, target: box(0, 250), obstacles: [event], sourceSides: ['bottom'] as Side[], targetSides: TASK_IN };
    const pts = route(req);
    expect(pts[0]!.y).toBe(80);
    expect(pts[0]!.x < event.x || pts[0]!.x > event.x + event.width).toBe(true);
  });

  it('passes between two obstacles through the gap when that is shortest', () => {
    const top = box(200, -200, 40, 220), low = box(200, 60, 40, 200);
    const pts = route({ source: box(0, 0), target: box(400, 0), obstacles: [top, low], sourceSides: TASK_OUT, targetSides: TASK_IN });
    expect(pts).toEqual([{ x: 100, y: 40 }, { x: 400, y: 40 }]);
  });

  it('squeezes through a gap narrower than two margins when nothing else is free', () => {
    // a wall across the whole frame with a 12 px gap below the row of source and target
    const upper = box(200, 0, 40, 164), lower = box(200, 176, 40, 104);
    const frame = box(-20, 0, 540, 280);
    const pts = route({ source: box(0, 100), target: box(400, 100), obstacles: [upper, lower], frame, sourceSides: TASK_OUT, targetSides: TASK_IN });
    expect(pts.some((p) => p.y > 164 && p.y < 176)).toBe(true);
  });

  it('never cuts an obstacle when a free route exists (random scenes)', () => {
    const rand = rng(42);
    for (let scene = 0; scene < 40; scene++) {
      const source = box(Math.round(rand() * 800), Math.round(rand() * 600));
      let target = box(Math.round(rand() * 800), Math.round(rand() * 600));
      const clear = (b: Box, others: Box[], gap: number): boolean =>
        others.every((o) => b.x + b.width + gap <= o.x || o.x + o.width + gap <= b.x || b.y + b.height + gap <= o.y || o.y + o.height + gap <= b.y);
      if (!clear(target, [source], 40)) target = box(source.x + 300, source.y + 200);
      const obstacles: Box[] = [];
      for (let k = 0; k < 200 && obstacles.length < 25; k++) {
        const o = box(Math.round(rand() * 900 - 50), Math.round(rand() * 700 - 50), 36 + Math.round(rand() * 80), 36 + Math.round(rand() * 50));
        if (clear(o, [source, target], 40) && clear(o, obstacles, 20)) obstacles.push(o);
      }
      route({ source, target, obstacles, sourceSides: TASK_OUT, targetSides: TASK_IN });
    }
  });
});

describe('routeOrthogonal: lines, frame, fallback', () => {
  it('prefers a route that crosses no existing line when one of similar length exists', () => {
    const line = [{ x: 200, y: 150 }, { x: 200, y: 400 }];
    const req = { source: box(0, 0), target: box(300, 200), obstacles: [], lines: [line], sourceSides: TASK_OUT, targetSides: TASK_IN };
    const pts = route(req);
    expect(crossings(pts, line)).toBe(0);
    expect(pts).toEqual([{ x: 100, y: 40 }, { x: 350, y: 40 }, { x: 350, y: 200 }]);
  });

  it('accepts a crossing when avoiding it costs much more', () => {
    const line = [{ x: 200, y: -500 }, { x: 200, y: 500 }];
    const pts = route({ source: box(0, 0), target: box(400, 0), obstacles: [], lines: [line], sourceSides: TASK_OUT, targetSides: TASK_IN });
    expect(pts).toEqual([{ x: 100, y: 40 }, { x: 400, y: 40 }]);
  });

  it('avoids running on top of an existing line', () => {
    // an existing flow enters the target's left side on the row of the source
    const line = [{ x: 150, y: 240 }, { x: 300, y: 240 }];
    const pts = route({ source: box(0, 0), target: box(300, 200), obstacles: [], lines: [line], sourceSides: TASK_OUT, targetSides: TASK_IN });
    // it docks elsewhere (another side, or another point of the left side) and shares no stretch with the line
    expect(pts[pts.length - 1]).not.toEqual({ x: 300, y: 240 });
    for (let i = 0; i + 1 < pts.length; i++) {
      const [p, q] = [pts[i]!, pts[i + 1]!];
      const onLine = p.y === 240 && q.y === 240 && Math.min(Math.max(p.x, q.x), 300) - Math.max(Math.min(p.x, q.x), 150) > 0;
      expect(onLine, JSON.stringify(pts)).toBe(false);
    }
  });

  it('targetMerge: a further entry of a join rises along the last run of another one into the bottom vertex; without it, it keeps off that run', () => {
    // a join (gateway target) whose bottom vertex 325,50 another entry already rises into, straight from below
    const rise = [{ x: 325, y: 400 }, { x: 325, y: 50 }];
    const req = { source: box(0, 200), target: box(300, 0, 50, 50), obstacles: [], lines: [rise], sourceSides: ['right'] as Side[], targetSides: defaultSides('gateway', 'target'), targetMiddle: true };
    expect(route({ ...req, targetMerge: true })).toEqual([{ x: 100, y: 240 }, { x: 325, y: 240 }, { x: 325, y: 50 }]);
    const apart = route(req);
    expect(apart[apart.length - 1]).not.toEqual({ x: 325, y: 50 });
    for (let i = 0; i + 1 < apart.length; i++) {
      const [p, q] = [apart[i]!, apart[i + 1]!];
      expect(p.x === 325 && q.x === 325, JSON.stringify(apart)).toBe(false);
    }
  });

  it('targetMerge: a grid edge of 1 px or less on the shared tail is part of it (following the tail past it is no overlap)', () => {
    // the midline between the join's bottom (50) and the source's top (200) is y 125; the box right of them adds the grid
    // line bottom + margin, 1 or 0.5 px below it: the tail from y 240 up runs over that short grid edge into the vertex
    const rise = [{ x: 325, y: 400 }, { x: 325, y: 50 }];
    const req = { source: box(0, 200), target: box(300, 0, 50, 50), lines: [rise], sourceSides: ['right', 'top'] as Side[], targetSides: ['bottom'] as Side[], targetMiddle: true, targetMerge: true };
    for (const y of [31, 30.5]) {
      // leaving the tail at the short edge would cost the overlap: the route would turn up out of the source's top and join the tail above it
      expect(route({ ...req, obstacles: [box(400, y, 40, 80)] }), `grid line ${y + 95}`).toEqual([{ x: 100, y: 240 }, { x: 325, y: 240 }, { x: 325, y: 50 }]);
    }
  });

  describe('targetMerge: the shared tail of a hook bundle into the bottom vertex', () => {
    // a join (box 300,0 50x50, bottom vertex 325,50) with an end event right below it: its entries rise in the
    // column gap right of it (x 385) and hook left into the bottom vertex, as the engine draws them (hookFromBelow)
    const JOIN = box(300, 0, 50, 50);
    const hook = (y: number): Point[] => [{ x: 200, y }, { x: 385, y }, { x: 385, y: 65 }, { x: 325, y: 65 }, { x: 325, y: 50 }];
    const BUNDLE = [hook(160), hook(260), hook(360)];
    const SOURCES = [box(100, 120), box(100, 220), box(100, 320)];
    const BELOW = box(307, 90, 36, 36);
    const lane = { x: 100, y: -60, width: 500, height: 600 };
    const join = (lines: Point[][], extra: Partial<RouteRequest> = {}): RouteRequest => ({
      source: box(100, 420),
      target: JOIN,
      obstacles: [BELOW, ...SOURCES],
      lines,
      sourceSides: ['right'],
      targetSides: defaultSides('gateway', 'target'),
      targetMiddle: true,
      frame: lane,
      ...extra,
    });
    /** the route runs through a vertex of the join other than its last point */
    const touchesVertex = (pts: Point[]): boolean => {
      const vertices = [{ x: 325, y: 0 }, { x: 350, y: 25 }, { x: 325, y: 50 }, { x: 300, y: 25 }].filter((v) => v.x !== pts.at(-1)!.x || v.y !== pts.at(-1)!.y);
      return pts.slice(1).some((q, i) => {
        const p = pts[i]!;
        return vertices.some((v) => (p.x === q.x ? v.x === p.x && v.y >= Math.min(p.y, q.y) && v.y <= Math.max(p.y, q.y) : v.y === p.y && v.x >= Math.min(p.x, q.x) && v.x <= Math.max(p.x, q.x)));
      });
    };

    it('a 4th entry rises along the bundle and follows its hook into the shared bottom vertex, crossing nothing', () => {
      const pts = route(join(BUNDLE, { targetMerge: true }));
      expect(pts).toEqual([{ x: 200, y: 460 }, { x: 385, y: 460 }, { x: 385, y: 65 }, { x: 325, y: 65 }, { x: 325, y: 50 }]);
      expect(crossings(pts, BUNDLE.flat())).toBe(0);
    });

    it('a single entry: its last run, the short hook and the run before it are shared', () => {
      // the left vertex is taken by a flow from the left; the one entry from below rises in the gap and hooks in
      const left = [{ x: 150, y: 25 }, { x: 300, y: 25 }];
      const pts = route(join([hook(300), left], { source: box(150, 400), obstacles: [BELOW, box(100, 260)], targetAvoid: ['left'], targetMerge: true, frame: undefined }));
      expect(pts).toEqual([{ x: 250, y: 440 }, { x: 385, y: 440 }, { x: 385, y: 65 }, { x: 325, y: 65 }, { x: 325, y: 50 }]);
    });

    it('a route never runs along the join\'s box through another of its vertices (not under the diamond into the left vertex)', () => {
      // the bottom vertex taken and no merge: the free left vertex is reached across the bundle, not along y 50 through 325,50
      const out = [{ x: 350, y: 25 }, { x: 450, y: 25 }];
      for (const req of [join([...BUNDLE, out], { targetAvoid: ['bottom'], obstacles: [BELOW, ...SOURCES, box(450, -15)] }), join([...BUNDLE, out], { targetSides: ['left'] })]) {
        const pts = route(req);
        expect(touchesVertex(pts), JSON.stringify(pts)).toBe(false);
        expect(pts.at(-1)).toEqual({ x: 300, y: 25 });
      }
    });

    it('a route on the shared tail follows it into the vertex: leaving it for another vertex costs the overlap', () => {
      // straight below the bundle's column, the top vertex free and the bottom one also used by an outgoing flow
      const left = [{ x: 150, y: 25 }, { x: 300, y: 25 }];
      const pts = route(join([...BUNDLE, left], { source: box(335, 420), sourceSides: ['top'], targetAvoid: ['left', 'bottom'], targetMerge: true, frame: undefined }));
      expect(pts).toEqual([{ x: 385, y: 420 }, { x: 385, y: 65 }, { x: 325, y: 65 }, { x: 325, y: 50 }]);
    });
  });

  it('stays inside the frame (goes below the obstacle although above is shorter)', () => {
    const wall = box(200, 80, 40, 180);
    const base = { source: box(0, 100), target: box(400, 100), obstacles: [wall], sourceSides: TASK_OUT, targetSides: TASK_IN };
    const free = route(base);
    expect(Math.min(...free.map((p) => p.y))).toBeLessThan(80);
    const frame = box(-50, 90, 600, 230);
    const framed = route({ ...base, frame });
    expect(Math.max(...framed.map((p) => p.y))).toBeGreaterThan(260);
  });

  it('leaves the frame only when nothing obstacle-free fits inside it', () => {
    const wall = box(200, 50, 40, 300);
    const frame = box(-50, 60, 600, 260);
    const pts = route({ source: box(0, 100), target: box(400, 100), obstacles: [wall], frame, sourceSides: TASK_OUT, targetSides: TASK_IN }, { mayLeaveFrame: true });
    expect(hits(pts, wall)).toBe(false);
    expect(pts.some((p) => p.y < frame.y || p.y > frame.y + frame.height)).toBe(true);
  });

  it('still returns a route when the target is walled in (fallback through an obstacle)', () => {
    const target = box(400, 100);
    const ring = [box(370, 60, 20, 160), box(510, 60, 20, 160), box(370, 60, 160, 20), box(370, 200, 160, 20)];
    const req = { source: box(0, 100), target, obstacles: ring, sourceSides: TASK_OUT, targetSides: TASK_IN };
    const pts = route(req, { mayHit: true });
    expect(ring.filter((o) => hits(pts, o)).length).toBe(1);
  });

  it('is deterministic and independent of the order of obstacles and lines', () => {
    const rand = rng(7);
    const obstacles = Array.from({ length: 30 }, () => box(Math.round(rand() * 1200) + 150, Math.round(rand() * 800) - 300, 80, 60));
    const lines = Array.from({ length: 10 }, () => [
      { x: Math.round(rand() * 1200), y: Math.round(rand() * 600) },
      { x: Math.round(rand() * 1200), y: Math.round(rand() * 600) },
    ]).map(([a, b]) => [a!, { x: b!.x, y: a!.y }, b!]);
    const req = { source: box(0, 0), target: box(1500, 300), obstacles, lines, sourceSides: TASK_OUT, targetSides: TASK_IN };
    const first = OrthogonalRouter.route(req);
    expectValid(req, first, { mayHit: true });
    expect(OrthogonalRouter.route(req)).toEqual(first);
    expect(OrthogonalRouter.route({ ...req, obstacles: [...obstacles].reverse(), lines: [...lines].reverse() })).toEqual(first);
  });
});

describe('routeOrthogonal: performance', () => {
  it('routes in a 200-obstacle plane quickly', () => {
    const rand = rng(3);
    const shapes: Box[] = [];
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 20; col++) {
        shapes.push(box(col * 160 + Math.round(rand() * 20), row * 140 + Math.round(rand() * 20)));
      }
    }
    const pairs: Array<[number, number]> = [[0, 1], [21, 42], [5, 25], [60, 3], [0, 199], [150, 10], [99, 100], [33, 87]];
    const times: number[] = [];
    for (const [a, b] of pairs) {
      const source = shapes[a]!, target = shapes[b]!;
      const req = { source, target, obstacles: shapes.filter((s) => s !== source && s !== target), sourceSides: TASK_OUT, targetSides: TASK_IN };
      const t0 = performance.now();
      const pts = OrthogonalRouter.route(req);
      times.push(performance.now() - t0);
      expectValid(req, pts);
    }
    times.sort((x, y) => x - y);
    const median = times[Math.floor(times.length / 2)]!;
    expect(median).toBeLessThan(50);
    expect(times[times.length - 1]!).toBeLessThan(250);
  });
});

describe('defaultSides / attachedSide', () => {
  it('follows the BPMN conventions', () => {
    expect(defaultSides('task', 'source')).toEqual(['right', 'bottom', 'top']);
    expect(defaultSides('task', 'target')).toEqual(['left', 'bottom', 'top']);
    expect(defaultSides('gateway', 'source')).toEqual(['right', 'bottom', 'top']);
    expect(defaultSides('gateway', 'target')).toEqual(['left', 'bottom', 'top']);
    expect(defaultSides('boundary', 'source')).toEqual(['bottom']);
    expect(defaultSides('event', 'source')).toHaveLength(4);
    expect(defaultSides('event', 'target')).toHaveLength(4);
    expect(defaultSides('participant', 'target')).toEqual(['top', 'bottom']);
  });

  it('returns fresh arrays', () => {
    const a = defaultSides('event', 'source');
    a.pop();
    expect(defaultSides('event', 'source')).toHaveLength(4);
  });

  it('finds the host border a boundary event sits on', () => {
    const host = box(0, 0);
    expect(attachedSide(box(32, 62, 36, 36), host)).toBe('bottom');
    expect(attachedSide(box(82, 20, 36, 36), host)).toBe('right');
    expect(attachedSide(box(32, -18, 36, 36), host)).toBe('top');
  });
});
