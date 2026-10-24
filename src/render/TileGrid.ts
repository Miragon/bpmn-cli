import type { Box } from '../diagram/geom.js';
import type { LayoutProblem } from '../diagram/metrics.js';
import type { DShape } from '../diagram/plane.js';
import { is } from '../model/utils/moddle.js';
import { planeColumns } from '../query/layout-view.js';
import { MARGIN, MAX_TILES, type Frame, type Item } from './types.js';
import { contains, meets } from './utils/boxes.js';

export interface TileView {
  view: Box;
  columns?: [number, number];
  band?: number;
}

interface Span {
  a: number;
  b: number;
}

/**
 * The tiles of an unreadable image (see contract): cut between the plane's
 * columns, and between rows when too tall, each at most `budget` (drawing px)
 * on a side; only tiles with a shape, a label or a numbered problem in them.
 */
export class TileGrid {
  constructor(
    private readonly items: Item[],
    private readonly view: Box,
    private readonly frame: Frame,
    private readonly budget: number,
    private readonly problems: LayoutProblem[],
  ) {}

  /** The tiles; `over` when that takes more than MAX_TILES tiles; undefined when nothing is to be tiled. */
  cut(): { views: TileView[]; skipped: boolean } | { over: true } | undefined {
    const { items, view, frame, budget } = this;
    const plane = frame.located;
    if (!plane) return undefined;
    // what a tile must hold to be kept
    const marks: Box[] = items.filter((i) => !i.extra && i.content && meets(i.content, view)).map((i) => i.content!);
    for (const p of this.problems) if (p.at && p.at.plane === plane.rootId && !frame.fileProblems && contains(view, p.at)) marks.push({ x: p.at.x, y: p.at.y, width: 0, height: 0 });
    if (!marks.length) return undefined;
    const drawnShape = (s: DShape): boolean => (!frame.drawn || frame.drawn.has(s.id)) && !s.container && s.kind !== 'group' && meets(s.bounds, view);
    const leaves = [...plane.shapes.values()].filter(drawnShape);
    const leafIds = new Set(leaves.map((s) => s.id));
    const columns = planeColumns(plane)
      .map((c) => {
        const boxes = c.ids.filter((id) => leafIds.has(id)).map((id) => plane.shapes.get(id)!.bounds);
        return { index: c.index, a: Math.min(...boxes.map((b) => b.x)), b: Math.max(...boxes.map((b) => b.x + b.width)), n: boxes.length };
      })
      .filter((c) => c.n > 0);
    const others = leaves.filter((s) => !is(s.el, 'bpmn:FlowNode') || s.kind === 'boundary').map((s) => ({ a: s.bounds.x, b: s.bounds.x + s.bounds.width }));
    const xs = this.axisPieces(view.x, view.x + view.width, marks.map((b) => ({ a: b.x, b: b.x + b.width })), [...columns, ...others], MAX_TILES);
    const ys = xs && this.axisPieces(view.y, view.y + view.height, marks.map((b) => ({ a: b.y, b: b.y + b.height })), leaves.map((s) => ({ a: s.bounds.y, b: s.bounds.y + s.bounds.height })), MAX_TILES);
    if (!xs || !ys) return { over: true };
    // the cells holding a mark (every piece holds one: the tiles are at least as many as the pieces of either axis)
    const kept = new Set<number>();
    for (const m of marks) {
      const [x0, x1] = TileGrid.piecesMet(xs.pieces, m.x, m.x + m.width);
      const [y0, y1] = TileGrid.piecesMet(ys.pieces, m.y, m.y + m.height);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          kept.add(y * xs.pieces.length + x);
          if (kept.size > MAX_TILES) return { over: true };
        }
      }
    }
    const bands = ys.pieces.map((_, y) => xs.pieces.some((_, x) => kept.has(y * xs.pieces.length + x)));
    const bandCount = bands.filter(Boolean).length;
    const out: TileView[] = [];
    let band = 0;
    ys.pieces.forEach((y, yi) => {
      if (!bands[yi]) return;
      band++;
      xs.pieces.forEach((x, xi) => {
        if (!kept.has(yi * xs.pieces.length + xi)) return;
        const inside = columns.filter((c) => (c.a + c.b) / 2 >= x.a && (c.a + c.b) / 2 < x.b).map((c) => c.index);
        out.push({ view: { x: x.a, y: y.a, width: x.b - x.a, height: y.b - y.a }, ...(inside.length ? { columns: [Math.min(...inside), Math.max(...inside)] as [number, number] } : {}), ...(bandCount > 1 ? { band } : {}) });
      });
    });
    return { views: out, skipped: xs.skipped || ys.skipped || kept.size < xs.pieces.length * ys.pieces.length };
  }

  /**
   * The pieces of one axis: the content's stretches (gaps of half a tile and
   * more between them are left out), each cut by cutAxis; undefined when it
   * takes more than `room` pieces.
   */
  private axisPieces(lo: number, hi: number, content: Span[], cuts: Span[], room: number): { pieces: Span[]; skipped: boolean } | undefined {
    const stretches = TileGrid.mergeSpans(
      content.map((c) => ({ a: Math.max(lo, c.a - MARGIN), b: Math.min(hi, c.b + MARGIN) })),
      this.budget / 2,
    );
    if (stretches.length > room) return undefined;
    const pieces: Span[] = [];
    for (const s of stretches) {
      const part = this.cutAxis(s.a, s.b, cuts, room - pieces.length);
      if (!part) return undefined;
      pieces.push(...part);
    }
    const skipped = stretches.length > 1 || (stretches[0] !== undefined && (stretches[0].a > lo + 0.5 || stretches[0].b < hi - 0.5));
    return { pieces, skipped };
  }

  /**
   * Pieces of [lo, hi] of at most the budget, cut in the middle of the gaps
   * between `spans` where one is in reach, as even as the gaps allow;
   * undefined when it takes more than `room` pieces.
   */
  private cutAxis(lo: number, hi: number, spans: Span[], room: number): Span[] | undefined {
    const budget = this.budget;
    const merged = TileGrid.mergeSpans(spans, 0);
    const cuts: number[] = [];
    for (let i = 0; i + 1 < merged.length; i++) cuts.push((merged[i]!.b + merged[i + 1]!.a) / 2);
    const out: Span[] = [];
    let start = lo;
    let k = 0;
    while (hi - start > budget) {
      if (out.length >= room) return undefined;
      const target = start + (hi - start) / Math.ceil((hi - start) / budget);
      while (k < cuts.length && cuts[k]! <= start + 1) k++;
      let at = start + budget;
      let best = Infinity;
      for (let j = k; j < cuts.length && cuts[j]! - start <= budget; j++) {
        const d = Math.abs(cuts[j]! - target);
        if (d < best) {
          best = d;
          at = cuts[j]!;
        }
      }
      out.push({ a: start, b: at });
      start = at;
    }
    out.push({ a: start, b: hi });
    return out.length > room ? undefined : out;
  }

  /** Spans sorted and merged where they overlap or lie less than `gap` apart. */
  private static mergeSpans(spans: Span[], gap: number): Span[] {
    const merged: Span[] = [];
    for (const s of [...spans].sort((x, y) => x.a - y.a)) {
      const last = merged[merged.length - 1];
      if (last && s.a - last.b < gap) last.b = Math.max(last.b, s.b);
      else merged.push({ ...s });
    }
    return merged;
  }

  /** The index range of the pieces a span meets. */
  private static piecesMet(pieces: Span[], a: number, b: number): [number, number] {
    let first = 0;
    while (first < pieces.length && pieces[first]!.b < a) first++;
    let last = first - 1;
    while (last + 1 < pieces.length && pieces[last + 1]!.a <= b) last++;
    return [first, last];
  }
}
