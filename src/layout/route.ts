/**
 * Orthogonal edge routing for one scope (coordinates relative to the scope).
 *
 *  - same row: straight line (a reserved empty band or a bypass underneath
 *    when something is in the way)
 *  - target below: down from the source, then right (branch drop)
 *  - target above: right from the source, then up into the target's bottom
 *    (join); alternatives: hook from the column gap, up from the source's top
 *    and right into the target, or into the target's left side
 *  - loops: down into a channel below everything in their column span, left,
 *    up into the target's bottom; or over the top when that is cleaner. Every
 *    loop is scored over side/centre exits and entries: hits count 1000,
 *    crossings 1, a border point already used by another flow 2.
 *  - data associations are orthogonal stubs (vertical / horizontal / Z)
 */
import { LABEL_LINE, METRICS, SIZES, boxesOverlap, center, labelSize, type Box, type GArtifact, type GEdge, type GNode, type LaneBandInfo, type Point, type ScopeLayout } from './types.js';

interface Channel {
  y: number;
  from: number;
  to: number;
}

type Segment = [Point, Point];

/** artifacts that are already positioned when the edges are routed (data objects/stores, notes of boundary events) */
export function routedArtifacts(layout: ScopeLayout): GArtifact[] {
  return layout.artifacts.filter((a) => a.kind !== 'annotation' || !!a.anchorNode?.host);
}

function obstacles(layout: ScopeLayout): Box[] {
  const boxes: Box[] = [];
  for (const n of layout.nodes) {
    boxes.push(n.box);
    for (const b of n.boundary) boxes.push(b.box);
  }
  for (const a of routedArtifacts(layout)) boxes.push(a.box);
  return boxes;
}

function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  return x1 < box.x + box.width && x2 > box.x && y1 < box.y + box.height && y2 > box.y;
}

/** number of boxes a path cuts through (segment ends shrunk so touching the own border does not count) */
export function hitCount(points: Point[], boxes: Box[], ignore: Box[]): number {
  const hit = new Set<Box>();
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    const a2 = { x: a.x + dx * 2, y: a.y + dy * 2 };
    const b2 = { x: b.x - dx * 2, y: b.y - dy * 2 };
    for (const box of boxes) if (!ignore.includes(box) && segmentHitsBox(a2, b2, box)) hit.add(box);
  }
  return hit.size;
}

function pathHits(points: Point[], boxes: Box[], ignore: Box[]): boolean {
  return hitCount(points, boxes, ignore) > 0;
}

function orient(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/** proper crossing of two segments (shared endpoints and collinear overlaps do not count) */
function segmentsCross(s1: Segment, s2: Segment): boolean {
  const [a, b] = s1, [c, d] = s2;
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

function toSegments(points: Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  return out;
}

/** every segment of every routed sequence flow of the scope */
export function routedSegments(layout: ScopeLayout): Segment[] {
  return layout.edges.flatMap((e) => toSegments(e.points));
}

function countCrossings(points: Point[], routed: Segment[]): number {
  let n = 0;
  for (const a of toSegments(points)) for (const b of routed) if (segmentsCross(a, b)) n++;
  return n;
}

function bottom(b: Box): number {
  return b.y + b.height;
}

function right(b: Box): number {
  return b.x + b.width;
}

/** true when the boundary events of a host sit on the left part of its bottom border (collapsed sub-processes) */
function boundaryLeft(n: GNode): boolean {
  return n.kind === 'subProcess' && !n.child;
}

/** x where a line enters an expanded sub-process from the top (off-centre: the name sits at the top centre) */
function topX(n: GNode): number {
  return n.child ? n.box.x + Math.min(40, n.box.width / 4) : center(n.box).x;
}

/** x on a node's bottom border for data association stubs (beside the drop line, away from boundary events) */
export function dataX(n: GNode): number {
  const cx = center(n.box).x;
  if (!n.boundary.length) return cx + Math.min(30, n.box.width / 2 - 10);
  return boundaryLeft(n) ? cx + 30 : cx - 30;
}

/**
 * Candidate x positions on the bottom border of a node for drops and rises:
 * the centre (or the free part beside the boundary events), then the sides.
 */
function bottomCandidates(n: GNode): number[] {
  const b = n.box;
  const cx = center(b).x;
  if (!n.boundary.length) return b.width >= 100 ? [cx, cx - 25, cx + 25] : [cx];
  return boundaryLeft(n) ? [right(b) - 20, right(b) - 8] : [b.x + 20, b.x + 8];
}

export function routeEdges(layout: ScopeLayout): void {
  const boxes = obstacles(layout);
  const channels: Channel[] = [];
  const topChannels: Channel[] = [];
  const allNodes = [...layout.nodes, ...layout.nodes.flatMap((n) => n.boundary)];
  const routed: Segment[] = [];
  const usedBottom = new Map<GNode, number[]>();
  const usedTop = new Map<GNode, number[]>();
  const used = (map: Map<GNode, number[]>, n: GNode, x: number): boolean => (map.get(n) ?? []).some((u) => Math.abs(u - x) < 1);
  const use = (map: Map<GNode, number[]>, n: GNode, x: number): void => {
    const list = map.get(n) ?? [];
    list.push(x);
    map.set(n, list);
  };
  const bandOf = (n: GNode): LaneBandInfo | undefined => layout.laneBands?.find((b) => b.nodes.has(n.host ?? n));

  /** x on the bottom border of `n` for a vertical stub of length `len` that hits nothing and is not yet used */
  const bottomSlot = (n: GNode, len: number): number => {
    const cands = bottomCandidates(n);
    const ok = (x: number): boolean => !pathHits([{ x, y: bottom(n.box) }, { x, y: bottom(n.box) + len }], boxes, [n.box]);
    return cands.find((x) => ok(x) && !used(usedBottom, n, x)) ?? cands.find(ok) ?? cands[0]!;
  };
  /** the "target below" drop x of a node (stable: the same for every branch, so labels line up) */
  const exitX = (n: GNode): number => bottomCandidates(n)[0]!;
  /** a node whose bottom border carries a branch drop */
  const hasDownExit = (n: GNode): boolean => n.out.some((e) => !e.back && center(e.target.box).y > center(n.box).y + 1);
  /** where a flow enters a node from below: beside the drop line when the node has one */
  const entryX = (n: GNode): number => {
    const cands = bottomCandidates(n);
    return cands.length > 1 && hasDownExit(n) ? cands[1]! : cands[0]!;
  };

  /** lowest occupied y over a column span (layers), including boundary events */
  const spanBottom = (fromLayer: number, toLayer: number): number => {
    let maxY = 0;
    for (const n of allNodes) {
      const l = n.host ? n.host.layer : n.layer;
      if (l >= fromLayer && l <= toLayer) maxY = Math.max(maxY, bottom(n.box));
    }
    return maxY;
  };
  /** highest y (smallest) of any node, artifact or routed edge point inside an x range (restricted to a lane band) */
  const rangeTop = (x1: number, x2: number, band?: LaneBandInfo): number => {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const inBand = (y: number): boolean => !band || (y >= band.top && y <= band.bottom);
    let minY = Infinity;
    for (const n of allNodes) if (n.box.x <= hi && right(n.box) >= lo && inBand(center(n.box).y)) minY = Math.min(minY, n.box.y);
    for (const a of routedArtifacts(layout)) if (a.box.x <= hi && right(a.box) >= lo && inBand(center(a.box).y)) minY = Math.min(minY, a.box.y);
    for (const [a, b] of routed) {
      if (Math.max(a.x, b.x) >= lo && Math.min(a.x, b.x) <= hi && inBand(a.y) && inBand(b.y)) minY = Math.min(minY, a.y, b.y);
    }
    return minY === Infinity ? 0 : minY;
  };
  /** lowest y of any node, artifact or routed edge point inside an x range (restricted to a lane band) */
  const rangeBottom = (x1: number, x2: number, band?: LaneBandInfo): number => {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const inBand = (y: number): boolean => !band || (y >= band.top && y <= band.bottom);
    let maxY = 0;
    for (const n of allNodes) if (n.box.x <= hi && right(n.box) >= lo && inBand(center(n.box).y)) maxY = Math.max(maxY, bottom(n.box));
    for (const a of routedArtifacts(layout)) if (a.box.x <= hi && right(a.box) >= lo && inBand(center(a.box).y)) maxY = Math.max(maxY, bottom(a.box));
    for (const [a, b] of routed) {
      if (Math.max(a.x, b.x) >= lo && Math.min(a.x, b.x) <= hi && inBand(a.y) && inBand(b.y)) maxY = Math.max(maxY, a.y, b.y);
    }
    return maxY;
  };
  const freeChannel = (list: Channel[], fromX: number, toX: number, base: number, step: number): number => {
    const lo = Math.min(fromX, toX), hi = Math.max(fromX, toX);
    let y = base;
    while (list.some((c) => c.y === y && c.from <= hi && lo <= c.to)) y += step;
    return y;
  };
  const channelFor = (fromX: number, toX: number, base: number): number => {
    const y = freeChannel(channels, fromX, toX, base, METRICS.loopGap / 2);
    channels.push({ y, from: Math.min(fromX, toX), to: Math.max(fromX, toX) });
    return y;
  };

  /**
   * Path from `s` down to height `y`: straight drop at `ex` when the column
   * below is free, otherwise out of the right side into the column gap.
   */
  const exitToBelow = (s: GNode, ex: number, y: number): Point[] => {
    const sb = s.box;
    const direct: Point[] = [{ x: ex, y: bottom(sb) }, { x: ex, y }];
    if (!pathHits(direct, boxes, [sb])) return direct;
    const gapX = right(sb) + METRICS.hGap / 2;
    const sideY = sb.y + sb.height * 0.75;
    const viaGap: Point[] = [{ x: right(sb), y: sideY }, { x: gapX, y: sideY }, { x: gapX, y }];
    return pathHits(viaGap, boxes, [sb]) ? direct : viaGap;
  };

  /**
   * Path that reaches `t` from below starting at height `y` in the column gap
   * left of the target: up the gap, short hook right, into the bottom border.
   * Falls back to a straight rise at the entry x when the gap is blocked.
   */
  const hookFromBelow = (t: GNode, y: number): Point[] => {
    const tb = t.box;
    const tx = bottomSlot(t, 30);
    const hookY = bottom(tb) + 15;
    const direct: Point[] = [{ x: tx, y }, { x: tx, y: bottom(tb) }];
    if (y <= hookY || !pathHits(direct, boxes, [tb])) return direct;
    // the gap right of the target is usually free of join lines (they end at the target's column)
    for (const gapX of [right(tb) + METRICS.hGap / 2, tb.x - METRICS.hGap / 2]) {
      const path: Point[] = [{ x: gapX, y }, { x: gapX, y: hookY }, { x: tx, y: hookY }, { x: tx, y: bottom(tb) }];
      if (!pathHits(path, boxes, [tb])) return path;
    }
    return direct;
  };

  const forward = layout.edges.filter((e) => !e.back);
  // loops: narrow spans first so nested loops get the inner channels
  const loops = layout.edges.filter((e) => e.back).sort((a, b) => Math.abs(center(a.source.box).x - center(a.target.box).x) - Math.abs(center(b.source.box).x - center(b.target.box).x));
  for (const e of [...forward, ...loops]) {
    const s = e.source, t = e.target;
    const sb = s.box, tb = t.box;
    const sc = center(sb), tc = center(tb);
    const ignore = [sb, tb];
    let pts: Point[] = [];
    let chosenChannel: { list: Channel[]; y: number; x1: number; x2: number } | undefined;

    if (e.back) {
      const src = s.host ?? s;
      if (src === t) {
        // self loop below the node
        const x1 = sb.x + sb.width * 0.7, x2 = sb.x + sb.width * 0.3;
        const y = bottom(sb) + 40;
        pts = [{ x: x1, y: bottom(sb) }, { x: x1, y }, { x: x2, y }, { x: x2, y: bottom(sb) }];
      } else {
        const band = bandOf(src);
        const sameBand = band && band === bandOf(t) ? band : undefined;
        const x1 = tb.x - METRICS.hGap / 2, x2 = right(sb) + METRICS.hGap / 2;
        const ex = s.host ? sc.x : exitX(s);
        const tx = entryX(t);
        const sideY = sb.y + sb.height * 0.75;
        type Cand = { pts: Point[]; exit?: [Map<GNode, number[]>, GNode, number]; entry?: [Map<GNode, number[]>, GNode, number]; channel?: { list: Channel[]; y: number }; penalty: number };
        const cands: Cand[] = [];
        // channel below every node and every routed edge between the two columns
        const base = rangeBottom(x1, x2, sameBand) + METRICS.loopGap;
        const y = freeChannel(channels, x1, x2, base, METRICS.loopGap / 2);
        const hookY = bottom(tb) + 15;
        const exits: Array<{ pts: Point[]; x?: number }> = [
          { pts: [{ x: ex, y: bottom(sb) }, { x: ex, y }], x: ex },
          { pts: [{ x: right(sb), y: sideY }, { x: x2, y: sideY }, { x: x2, y }] },
          { pts: [{ x: sb.x, y: sideY }, { x: sb.x - METRICS.hGap / 2, y: sideY }, { x: sb.x - METRICS.hGap / 2, y }] },
        ];
        const entries: Array<{ pts: Point[]; x?: number; penalty?: number }> = [
          { pts: [{ x: tx, y }, { x: tx, y: bottom(tb) }], x: tx },
          { pts: [{ x: right(tb) + METRICS.hGap / 2, y }, { x: right(tb) + METRICS.hGap / 2, y: hookY }, { x: tx, y: hookY }, { x: tx, y: bottom(tb) }], x: tx },
          { pts: [{ x: x1, y }, { x: x1, y: hookY }, { x: tx, y: hookY }, { x: tx, y: bottom(tb) }], x: tx },
        ];
        // a gateway's bottom vertex carries its branch drops, so a loop may enter through the left vertex instead
        if (t.kind === 'gateway') entries.push({ pts: [{ x: x1, y }, { x: x1, y: tc.y }, { x: tb.x, y: tc.y }], penalty: 1.5 });
        for (const ex2 of exits) {
          for (const en of entries) {
            cands.push({
              pts: [...ex2.pts, ...en.pts],
              exit: ex2.x !== undefined ? [usedBottom, s.host ?? s, ex2.x] : undefined,
              entry: en.x !== undefined ? [usedBottom, t, en.x] : undefined,
              channel: { list: channels, y },
              penalty: en.penalty ?? 0,
            });
          }
        }
        // over the top: source top -> top channel -> target top (side exits / entries as above); slightly penalised
        const topBase = rangeTop(x1, x2, sameBand) - METRICS.loopGap;
        const topY = freeChannel(topChannels, x1, x2, topBase, -METRICS.loopGap / 2);
        const ttx = topX(t);
        const topHookY = tb.y - 15;
        const sideYTop = sb.y + sb.height * 0.25;
        const topExits: Array<{ pts: Point[]; x?: number }> = [
          { pts: [{ x: sc.x, y: sb.y }, { x: sc.x, y: topY }], x: sc.x },
          { pts: [{ x: right(sb), y: sideYTop }, { x: x2, y: sideYTop }, { x: x2, y: topY }] },
          { pts: [{ x: sb.x, y: sideYTop }, { x: sb.x - METRICS.hGap / 2, y: sideYTop }, { x: sb.x - METRICS.hGap / 2, y: topY }] },
        ];
        const topEntries: Array<{ pts: Point[]; x?: number }> = [
          { pts: [{ x: ttx, y: topY }, { x: ttx, y: tb.y }], x: ttx },
          { pts: [{ x: right(tb) + METRICS.hGap / 2, y: topY }, { x: right(tb) + METRICS.hGap / 2, y: topHookY }, { x: ttx, y: topHookY }, { x: ttx, y: tb.y }], x: ttx },
          { pts: [{ x: x1, y: topY }, { x: x1, y: topHookY }, { x: ttx, y: topHookY }, { x: ttx, y: tb.y }], x: ttx },
        ];
        for (const ex2 of topExits) {
          for (const en of topEntries) {
            cands.push({
              pts: [...ex2.pts, ...en.pts],
              exit: ex2.x !== undefined ? [usedTop, s.host ?? s, ex2.x] : undefined,
              entry: en.x !== undefined ? [usedTop, t, en.x] : undefined,
              channel: { list: topChannels, y: topY },
              penalty: 0.5,
            });
          }
        }
        // target below the source (lanes): straight down, or out of the side and down into the target's top
        if (tb.y > bottom(sb)) {
          const midY = (bottom(sb) + tb.y) / 2;
          cands.push({ pts: [{ x: ex, y: bottom(sb) }, { x: ex, y: midY }, { x: ttx, y: midY }, { x: ttx, y: tb.y }], exit: [usedBottom, s.host ?? s, ex], entry: [usedTop, t, ttx], penalty: 0.25 });
          const sideX = ttx < sc.x ? sb.x : right(sb);
          cands.push({ pts: [{ x: sideX, y: sc.y }, { x: ttx, y: sc.y }, { x: ttx, y: tb.y }], entry: [usedTop, t, ttx], penalty: 0.25 });
        }
        let best: { c: Cand; score: number } | undefined;
        cands.forEach((c, i) => {
          let score = hitCount(c.pts, boxes, ignore) * 1000 + countCrossings(c.pts, routed) * 3 + c.penalty + i * 0.001;
          if (c.exit && used(c.exit[0], c.exit[1], c.exit[2])) score += 2;
          if (c.entry && used(c.entry[0], c.entry[1], c.entry[2])) score += 2;
          if (!best || score < best.score) best = { c, score };
        });
        const win = best!.c;
        pts = win.pts;
        if (win.exit) use(win.exit[0], win.exit[1], win.exit[2]);
        if (win.entry) use(win.entry[0], win.entry[1], win.entry[2]);
        if (win.channel) chosenChannel = { list: win.channel.list, y: win.channel.y, x1, x2 };
      }
    } else if (Math.abs(sc.y - tc.y) < 1) {
      pts = [{ x: right(sb), y: sc.y }, { x: tb.x, y: tc.y }];
      if (e.bandY !== undefined) {
        // reserved empty band: drop, run along the band, hook into the join from below
        const ex = exitX(s);
        pts = [...exitToBelow(s, ex, e.bandY), ...hookFromBelow(t, e.bandY)];
        use(usedBottom, s, ex);
      } else if (pathHits(pts, boxes, ignore)) {
        const base = spanBottom(s.layer, t.layer) + METRICS.loopGap;
        const y = channelFor(exitX(s), tb.x - 20, base);
        pts = [...exitToBelow(s, exitX(s), y), ...hookFromBelow(t, y)];
      }
    } else if (tc.y > sc.y) {
      // drop from the source (or from the boundary event), then right
      const ex = s.host ? sc.x : exitX(s);
      pts = [{ x: ex, y: bottom(sb) }, { x: ex, y: tc.y }, { x: tb.x, y: tc.y }];
      if (pathHits(pts, boxes, ignore)) {
        // fall back: right, down, right
        const midX = right(sb) + METRICS.hGap / 2;
        pts = [{ x: right(sb), y: sc.y }, { x: midX, y: sc.y }, { x: midX, y: tc.y }, { x: tb.x, y: tc.y }];
        if (pathHits(pts, boxes, ignore)) {
          const base = spanBottom(s.host ? s.host.layer : s.layer, t.layer) + METRICS.loopGap;
          const y = channelFor(ex, tb.x - 20, base);
          pts = [{ x: ex, y: bottom(sb) }, { x: ex, y }, { x: tb.x - 20, y }, { x: tb.x - 20, y: tc.y }, { x: tb.x, y: tc.y }];
        }
      } else use(usedBottom, s.host ?? s, ex);
    } else {
      // right, then up into the target's bottom (join)
      const tx = entryX(t);
      const cands: Array<{ pts: Point[]; x?: number }> = [
        { pts: [{ x: right(sb), y: sc.y }, { x: tx, y: sc.y }, { x: tx, y: bottom(tb) }], x: tx },
        { pts: [{ x: right(sb), y: sc.y }, ...hookFromBelow(t, sc.y)], x: tx },
      ];
      // up out of the source's top, then right into the target's left side (target in a lane above)
      if (tb.x >= right(sb)) cands.push({ pts: [{ x: sc.x, y: sb.y }, { x: sc.x, y: tc.y }, { x: tb.x, y: tc.y }] });
      // into the target's left side through the column gap before it
      if (tb.x - METRICS.hGap / 2 > right(sb)) cands.push({ pts: [{ x: right(sb), y: sc.y }, { x: tb.x - METRICS.hGap / 2, y: sc.y }, { x: tb.x - METRICS.hGap / 2, y: tc.y }, { x: tb.x, y: tc.y }] });
      let best: { pts: Point[]; score: number; x?: number } | undefined;
      cands.forEach((c, i) => {
        const score = hitCount(c.pts, boxes, ignore) * 1000 + countCrossings(c.pts, routed) + i * 0.5;
        if (!best || score < best.score) best = { pts: c.pts, score, ...(c.x !== undefined ? { x: c.x } : {}) };
      });
      pts = best!.pts;
      if (best!.x !== undefined) use(usedBottom, t, best!.x);
      if (best!.score >= 1000) {
        const base = spanBottom(s.layer, t.layer) + METRICS.loopGap;
        const y = channelFor(tb.x - METRICS.hGap / 2, exitX(s), base);
        pts = [...exitToBelow(s, exitX(s), y), ...hookFromBelow(t, y)];
      }
    }
    e.points = dedupe(pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })));
    routed.push(...toSegments(e.points));
    if (chosenChannel) chosenChannel.list.push({ y: chosenChannel.y, from: Math.min(chosenChannel.x1, chosenChannel.x2), to: Math.max(chosenChannel.x1, chosenChannel.x2) });
    e.label = flowLabel(e);
  }
  // nodes whose top border carries a flow get their label beside
  for (const n of allNodes) n.topUsed = false;
  for (const e of layout.edges) {
    for (const p of [e.points[0]!, e.points[e.points.length - 1]!]) {
      for (const n of allNodes) if (p && Math.abs(p.y - n.box.y) < 1 && p.x >= n.box.x && p.x <= right(n.box)) n.topUsed = true;
    }
  }
  // channels extend the content height
  const maxChannel = Math.max(0, ...channels.map((c) => c.y));
  layout.height = Math.max(layout.height, maxChannel + 10);
  // loops drawn over the top may have produced negative y: shift everything down
  let minY = 0;
  for (const e of layout.edges) for (const p of e.points) minY = Math.min(minY, p.y);
  for (const e of layout.edges) if (e.label) minY = Math.min(minY, e.label.y);
  if (minY < 0) {
    const dy = -minY + 10;
    for (const n of layout.nodes) {
      n.box.y += dy;
      for (const b of n.boundary) b.box.y += dy;
    }
    for (const a of routedArtifacts(layout)) a.box.y += dy;
    for (const e of layout.edges) {
      for (const p of e.points) p.y += dy;
      if (e.label) e.label.y += dy;
      if (e.bandY !== undefined) e.bandY += dy;
    }
    for (const c of layout.compensations) for (const p of c.points) p.y += dy;
    if (layout.laneBands) for (const b of layout.laneBands) {
      b.top += dy;
      b.bottom += dy;
    }
    layout.height += dy;
  }
}

function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
}

function flowLabel(e: GEdge): Box | undefined {
  const name = e.el.get<string | undefined>('name');
  if (!name) return undefined;
  const { width, height } = labelSize(name);
  const pts = e.points;
  if (pts.length < 2) return undefined;
  if (e.back && (e.source.host ?? e.source) === e.target && pts.length === 4) {
    // self loop: below the loop's bottom segment
    const a = pts[1]!, b = pts[2]!;
    return { x: Math.round((a.x + b.x) / 2 - width / 2), y: a.y + 4, width, height };
  }
  // longest horizontal segment (or the first segment)
  let a = pts[0]!, b = pts[1]!;
  let best = -1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = Math.abs(pts[i + 1]!.x - pts[i]!.x);
    if (pts[i]!.y === pts[i + 1]!.y && len > best) {
      best = len;
      a = pts[i]!;
      b = pts[i + 1]!;
    }
  }
  if (a.y === b.y) {
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
    // near the segment's start (for loops the start is the right end), never past its end
    const x = e.back ? Math.max(lo + 2, hi - width - 8) : Math.min(lo + 8, Math.max(lo + 2, hi - width - 4));
    return { x: Math.round(x), y: a.y - height - 4, width, height };
  }
  // vertical only: right of the segment
  return { x: a.x + 6, y: Math.min(a.y, b.y) + 6, width, height };
}

/** Compensation links, associations and data associations. */
export function routeLinks(layout: ScopeLayout): void {
  const boxes = obstacles(layout);
  const flows = routedSegments(layout);
  for (const c of layout.compensations) {
    const eb = c.event.box, hb = c.handler.box;
    const ex = eb.x + eb.width / 2;
    if (ex >= hb.x && ex <= hb.x + hb.width) c.points = [{ x: ex, y: bottom(eb) }, { x: ex, y: hb.y }];
    else {
      const midY = (bottom(eb) + hb.y) / 2;
      const hx = hb.x + hb.width / 2;
      c.points = [{ x: ex, y: bottom(eb) }, { x: ex, y: midY }, { x: hx, y: midY }, { x: hx, y: hb.y }];
    }
    c.points = c.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }
  const drawn: Segment[] = [];
  for (const a of layout.artifacts) {
    for (const link of a.links) {
      const other = link.from === a ? link.to : link.from;
      const node = other.flow ? undefined : layout.nodes.find((x) => x.box === other.box) ?? layout.nodes.flatMap((x) => x.boundary).find((x) => x.box === other.box);
      const path = linkPath(a.box, other.box, node, boxes, [...flows, ...drawn], other.flow ? 'flow' : 'shape');
      const pts = link.from === a ? path : [...path].reverse();
      link.points = pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
      drawn.push(...toSegments(link.points));
    }
  }
}

/**
 * Path from an artifact to the element it belongs to. Candidates: a straight
 * stub (vertical / horizontal), an L or Z through the gap, a run along the
 * artifact's own row and, for short clean connections, the plain diagonal
 * BPMN normally draws. The candidate that cuts no shape, crosses the fewest
 * lines and is shortest wins.
 */
function linkPath(a: Box, n: Box, node: GNode | undefined, boxes: Box[], lines: Segment[], end: 'shape' | 'flow'): Point[] {
  const ac = center(a), nc = center(n);
  const ignore = [a, n];
  const cands: Point[][] = [];
  const push = (...pts: Point[]): void => {
    const path = dedupe(pts);
    if (path.length >= 2) cands.push(path);
  };
  // straight stub: vertical when the boxes share an x range, horizontal when they share a y range
  const xLo = Math.max(a.x + 4, n.x + 8), xHi = Math.min(right(a) - 4, right(n) - 8);
  if (xLo <= xHi) {
    const x = Math.min(Math.max(ac.x, xLo), xHi);
    if (a.y >= bottom(n)) push({ x, y: a.y }, { x, y: bottom(n) });
    else if (bottom(a) <= n.y) push({ x, y: bottom(a) }, { x, y: n.y });
  }
  const yLo = Math.max(a.y + 4, n.y + 8), yHi = Math.min(bottom(a) - 4, bottom(n) - 8);
  if (yLo <= yHi) {
    const y = Math.min(Math.max(ac.y, yLo), yHi);
    if (a.x >= right(n)) push({ x: a.x, y }, { x: right(n), y });
    else if (right(a) <= n.x) push({ x: right(a), y }, { x: n.x, y });
  }
  const nx = node ? dataX(node) : nc.x;
  const ny = ac.y > nc.y ? bottom(n) : n.y;
  const side = ac.x < nc.x ? right(a) : a.x;
  if (end === 'shape') {
    // along the artifact's own row, then vertically into the element's near border
    push({ x: side, y: ac.y }, { x: nx, y: ac.y }, { x: nx, y: ny });
    // out of the artifact's near border, along the element's row, into its side
    const ay = ac.y > nc.y ? a.y : bottom(a);
    const nSide = ac.x < nc.x ? n.x : right(n);
    push({ x: ac.x, y: ay }, { x: ac.x, y: nc.y }, { x: nSide, y: nc.y });
  } else {
    // a point on a flow: meet it orthogonally
    push({ x: nc.x, y: ac.y > nc.y ? a.y : bottom(a) }, { x: nc.x, y: nc.y });
    push({ x: side, y: ac.y }, { x: nc.x, y: ac.y }, { x: nc.x, y: nc.y });
  }
  if (end === 'shape') {
    // a horizontal run at a free height, approaching the element from below or from its side
    const lo = Math.min(ac.x, nc.x), hi = Math.max(ac.x, nc.x);
    let under = Math.max(bottom(a), bottom(n));
    for (const box of boxes) if (box !== a && box !== n && box.x <= hi && right(box) >= lo) under = Math.max(under, bottom(box));
    under += 20;
    const approachX = ac.x < nc.x ? n.x - 20 : right(n) + 20;
    const nSideX = ac.x < nc.x ? n.x : right(n);
    const runs = [ac.y, bottom(a) + 15, a.y - 15, under];
    for (const y of runs) {
      const exit: Point[] = y > bottom(a) ? [{ x: ac.x, y: bottom(a) }, { x: ac.x, y }] : y < a.y ? [{ x: ac.x, y: a.y }, { x: ac.x, y }] : [{ x: side, y }];
      // into the element's near horizontal border
      push(...exit, { x: nx, y }, { x: nx, y: y > nc.y ? bottom(n) : n.y });
      // around the element's column and into its side
      push(...exit, { x: approachX, y }, { x: approachX, y: nc.y }, { x: nSideX, y: nc.y });
    }
  }
  // the plain diagonal (what BPMN draws by default)
  cands.push([borderPoint(a, nc), end === 'flow' ? nc : borderPoint(n, ac)]);
  const length = (pts: Point[]): number => {
    let len = 0;
    for (const [p, q] of toSegments(pts)) len += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    return len;
  };
  let best: { pts: Point[]; score: number } | undefined;
  cands.forEach((pts, i) => {
    const score = hitCount(pts, boxes, ignore) * 1000 + countCrossings(pts, lines) * 8 + length(pts) * 0.002 + i * 0.01;
    if (!best || score < best.score) best = { pts, score };
  });
  return best!.pts;
}

/** Point on the border of `box` on the line from its centre towards `to`. */
export function borderPoint(box: Box, to: Point): Point {
  const c = center(box);
  const dx = to.x - c.x, dy = to.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx !== 0 ? Math.abs((box.width / 2) / dx) : Infinity;
  const sy = dy !== 0 ? Math.abs((box.height / 2) / dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

export interface LabelOptions {
  /** put an event label above the shape (a message flow docks at its bottom) */
  above?: boolean;
}

/** External label boxes for events, gateways, boundary events and data objects. */
export function elementLabel(n: { box: Box; el: GNode['el']; host?: GNode; topUsed?: boolean } | GArtifact, kind: 'event' | 'gateway' | 'boundary' | 'data', opts: LabelOptions = {}): Box | undefined {
  const name = n.el.get<string | undefined>('name');
  if (!name) return undefined;
  const b = n.box;
  const cx = b.x + b.width / 2;
  switch (kind) {
    case 'gateway': {
      if ('topUsed' in n && n.topUsed) {
        // a flow leaves through the top: label to the upper left of the diamond
        const { width, height } = labelSize(name, 80);
        return { x: Math.round(cx - 8 - width), y: b.y - height - 2, width, height };
      }
      const { width, height } = labelSize(name);
      return { x: Math.round(cx - width / 2), y: b.y - height - 6, width, height };
    }
    case 'boundary': {
      const { width, height } = labelSize(name);
      const host = 'host' in n ? n.host : undefined;
      const hostBottom = host ? bottom(host.box) : b.y + b.height / 2;
      const siblings = host?.boundary ?? [];
      const i = Math.max(0, siblings.findIndex((s) => s.box === b));
      if (siblings.length === 2 && i === 1) return { x: b.x - 4 - width, y: hostBottom + 2, width, height };
      const stagger = siblings.length >= 3 ? i * (LABEL_LINE + 2) : 0;
      return { x: b.x + b.width + 4, y: hostBottom + 2 + stagger, width, height };
    }
    default: {
      const { width, height } = labelSize(name);
      if (opts.above) return { x: Math.round(cx - width / 2), y: b.y - height - 6, width, height };
      return { x: Math.round(cx - width / 2), y: b.y + b.height + 6, width, height };
    }
  }
}

export { SIZES, boxesOverlap };
