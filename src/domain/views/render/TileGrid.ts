import type { Box } from '../../diagram/utils/geom.js';
import { containsPoint } from '../../diagram/utils/geom.js';
import type { LayoutProblem } from '../../diagram/utils/problems.js';
import type { DShape } from '../../diagram/di/types.js';
import { is } from '../../document/utils/moddle.js';
import { DiagramColumns } from '../DiagramColumns.js';
import { MARGIN, MAX_TILES, type Frame, type Item } from './types.js';
import { meets } from '../utils/boxes.js';

export interface TileView {
  view: Box;
  columns?: [number, number];
  band?: number;
}

interface Span {
  start: number;
  end: number;
}

/**
 * The tiles of an unreadable image: cut between the plane's columns, and between rows when
 * too tall; only tiles with a shape, a label or a numbered problem in them are kept.
 */
export class TileGrid {
  constructor(
    private readonly items: Item[],
    private readonly view: Box,
    private readonly frame: Frame,
    private readonly budget: number,
    private readonly problems: LayoutProblem[],
  ) {}

  cut(): { views: TileView[]; skipped: boolean } | { over: true } | undefined {
    const { items, view, frame, budget } = this;
    const plane = frame.located;
    if (!plane) return undefined;
    const marks: Box[] = items.filter((item) => !item.extra && item.content && meets(item.content, view)).map((item) => item.content!);
    for (const problem of this.problems) if (problem.at && problem.at.plane === plane.rootId && !frame.fileProblems && containsPoint(view, problem.at)) marks.push({ x: problem.at.x, y: problem.at.y, width: 0, height: 0 });
    if (!marks.length) return undefined;
    const drawnShape = (shape: DShape): boolean => (!frame.drawn || frame.drawn.has(shape.id)) && !shape.container && shape.kind !== 'group' && meets(shape.bounds, view);
    const leaves = [...plane.shapes.values()].filter(drawnShape);
    const leafIds = new Set(leaves.map((shape) => shape.id));
    const columns = new DiagramColumns(plane).spans()
      .map((column) => {
        const boxes = column.ids.filter((id) => leafIds.has(id)).map((id) => plane.shapes.get(id)!.bounds);
        return { index: column.index, start: Math.min(...boxes.map((box) => box.x)), end: Math.max(...boxes.map((box) => box.x + box.width)), count: boxes.length };
      })
      .filter((column) => column.count > 0);
    const others = leaves.filter((shape) => !is(shape.el, 'bpmn:FlowNode') || shape.kind === 'boundary').map((shape) => ({ start: shape.bounds.x, end: shape.bounds.x + shape.bounds.width }));
    const xs = this.axisPieces(view.x, view.x + view.width, marks.map((mark) => ({ start: mark.x, end: mark.x + mark.width })), [...columns, ...others], MAX_TILES);
    const ys = xs && this.axisPieces(view.y, view.y + view.height, marks.map((mark) => ({ start: mark.y, end: mark.y + mark.height })), leaves.map((shape) => ({ start: shape.bounds.y, end: shape.bounds.y + shape.bounds.height })), MAX_TILES);
    if (!xs || !ys) return { over: true };
    const kept = new Set<number>();
    for (const mark of marks) {
      const [x0, x1] = TileGrid.piecesMet(xs.pieces, mark.x, mark.x + mark.width);
      const [y0, y1] = TileGrid.piecesMet(ys.pieces, mark.y, mark.y + mark.height);
      for (let row = y0; row <= y1; row++) {
        for (let column = x0; column <= x1; column++) {
          kept.add(row * xs.pieces.length + column);
          if (kept.size > MAX_TILES) return { over: true };
        }
      }
    }
    const bands = ys.pieces.map((_piece, row) => xs.pieces.some((_piece, column) => kept.has(row * xs.pieces.length + column)));
    const bandCount = bands.filter(Boolean).length;
    const out: TileView[] = [];
    let band = 0;
    ys.pieces.forEach((rowSpan, yi) => {
      if (!bands[yi]) return;
      band++;
      xs.pieces.forEach((columnSpan, xi) => {
        if (!kept.has(yi * xs.pieces.length + xi)) return;
        const inside = columns.filter((column) => (column.start + column.end) / 2 >= columnSpan.start && (column.start + column.end) / 2 < columnSpan.end).map((column) => column.index);
        out.push({ view: { x: columnSpan.start, y: rowSpan.start, width: columnSpan.end - columnSpan.start, height: rowSpan.end - rowSpan.start }, ...(inside.length ? { columns: [Math.min(...inside), Math.max(...inside)] as [number, number] } : {}), ...(bandCount > 1 ? { band } : {}) });
      });
    });
    return { views: out, skipped: xs.skipped || ys.skipped || kept.size < xs.pieces.length * ys.pieces.length };
  }

  /** Gaps of half a tile and more between the content's stretches are left out. */
  private axisPieces(lo: number, hi: number, content: Span[], cuts: Span[], room: number): { pieces: Span[]; skipped: boolean } | undefined {
    const stretches = TileGrid.mergeSpans(
      content.map((stretch) => ({ start: Math.max(lo, stretch.start - MARGIN), end: Math.min(hi, stretch.end + MARGIN) })),
      this.budget / 2,
    );
    if (stretches.length > room) return undefined;
    const pieces: Span[] = [];
    for (const stretch of stretches) {
      const part = this.cutAxis(stretch.start, stretch.end, cuts, room - pieces.length);
      if (!part) return undefined;
      pieces.push(...part);
    }
    const skipped = stretches.length > 1 || (stretches[0] !== undefined && (stretches[0].start > lo + 0.5 || stretches[0].end < hi - 0.5));
    return { pieces, skipped };
  }

  /** Cut in the middle of the gaps between `spans` where one is in reach. */
  private cutAxis(lo: number, hi: number, spans: Span[], room: number): Span[] | undefined {
    const budget = this.budget;
    const merged = TileGrid.mergeSpans(spans, 0);
    const cuts: number[] = [];
    for (let index = 0; index + 1 < merged.length; index++) cuts.push((merged[index]!.end + merged[index + 1]!.start) / 2);
    const out: Span[] = [];
    let start = lo;
    let nextCut = 0;
    while (hi - start > budget) {
      if (out.length >= room) return undefined;
      const target = start + (hi - start) / Math.ceil((hi - start) / budget);
      while (nextCut < cuts.length && cuts[nextCut]! <= start + 1) nextCut++;
      let at = start + budget;
      let best = Infinity;
      for (let cutIndex = nextCut; cutIndex < cuts.length && cuts[cutIndex]! - start <= budget; cutIndex++) {
        const distance = Math.abs(cuts[cutIndex]! - target);
        if (distance < best) {
          best = distance;
          at = cuts[cutIndex]!;
        }
      }
      out.push({ start, end: at });
      start = at;
    }
    out.push({ start, end: hi });
    return out.length > room ? undefined : out;
  }

  private static mergeSpans(spans: Span[], gap: number): Span[] {
    const merged: Span[] = [];
    for (const span of [...spans].sort((first, second) => first.start - second.start)) {
      const last = merged[merged.length - 1];
      if (last && span.start - last.end < gap) last.end = Math.max(last.end, span.end);
      else merged.push({ ...span });
    }
    return merged;
  }

  private static piecesMet(pieces: Span[], start: number, end: number): [number, number] {
    let first = 0;
    while (first < pieces.length && pieces[first]!.end < start) first++;
    let last = first - 1;
    while (last + 1 < pieces.length && pieces[last + 1]!.start <= end) last++;
    return [first, last];
  }
}
