import type { Box, Point } from '../drawing/utils/geom.js';
import { containsPoint, grow, unionAll } from '../drawing/utils/geom.js';
import { LayoutAnalysis } from '../drawing/LayoutAnalysis.js';
import { ProblemLocator } from '../drawing/ProblemLocator.js';
import { problemKey, type LayoutProblem } from '../drawing/utils/problems.js';
import type { Plane } from '../drawing/types.js';
import { TileGrid } from './TileGrid.js';
import { LAYER, MARGIN, MAX_TILES, MIN_LABEL_SCALE, type Frame, type Item, type RenderOptions, type RenderProblem, type RenderResult } from './types.js';
import { meets, pointsBox } from './utils/boxes.js';
import { scaleText } from './utils/scale.js';
import { FILL, n } from './utils/svg.js';

const FOCUS_MARGIN = 40;
const BADGE = '#e03131';
/** in image px: a badge keeps its size when the drawing is scaled */
const BADGE_R = 9;
const FONT = 'Arial, Arimo, sans-serif';

export class Composer {
  constructor(
    private readonly items: Item[],
    private readonly frame: Frame,
    private readonly opts: RenderOptions,
  ) {}

  result(): RenderResult {
    const { items, frame, opts } = this;
    const notes = frame.notes;
    const fit = items.filter((i) => !i.extra);
    const content = unionAll((fit.length ? fit : items).map((i) => i.fit ?? i.box)) ?? { x: 0, y: 0, width: 0, height: 0 };
    let view = grow(content, MARGIN);
    let scale = opts.scale ?? 1;
    if (!(scale > 0) || !Number.isFinite(scale)) scale = 1;
    const base = scale;
    const max = opts.maxSize && opts.maxSize > 0 ? opts.maxSize : undefined;
    const fitted = (v: Box): number => (max && Math.max(v.width, v.height) * base > max ? max / Math.max(v.width, v.height) : base);
    const focus = new Set(opts.focus ?? []);
    if (focus.size && fitted(view) < MIN_LABEL_SCALE && frame.located) {
      const near = Composer.nearFocus(frame.located, focus);
      const region = unionAll(items.filter((i) => i.id !== undefined && (focus.has(i.id) || (near.has(i.id) && !frame.located!.edges.has(i.id)))).map((i) => i.box));
      if (region) {
        notes.push(`the whole plane would be drawn at ${scaleText(fitted(view))} of its size: the image shows the region around the ${focus.size} element${focus.size > 1 ? 's' : ''} in focus (\`bpmn render <file>\` draws all of it)`);
        view = grow(region, FOCUS_MARGIN);
      }
    }
    scale = fitted(view);
    const listed = opts.problems ? this.problemList(opts.problems) : [];
    const cut = opts.tiles && scale < MIN_LABEL_SCALE && max ? new TileGrid(items, view, frame, max / base, listed).cut() : undefined;
    const tiled = cut && 'views' in cut ? cut.views : undefined;
    if (opts.tiles && scale >= MIN_LABEL_SCALE) notes.push(`--tiles: the image is readable as one (scale ${scaleText(scale)}); no tiles`);
    if (tiled) {
      scale = base;
      const bands = Math.max(...tiled.map((t) => t.band ?? 1));
      const parts = tiled.length > 1 ? `split into ${tiled.length} tiles${bands > 1 ? ` (${bands} bands)` : ''} at the diagram's columns (show --layout c<n>)` : 'one tile holds every shape and label';
      notes.push(`${parts}, each at scale ${scaleText(base)}${cut && 'views' in cut && cut.skipped ? '; parts with no shape or label (empty, or only connections passing through) are left out' : ''}`);
    } else if (scale < MIN_LABEL_SCALE) {
      if (cut && 'over' in cut) notes.push(`--tiles: the drawing needs more than ${MAX_TILES} tiles at scale ${scaleText(base)}: it is drawn as one image instead`);
      notes.push(`the labels are drawn at ${scaleText(scale)} of their size (below ${MIN_LABEL_SCALE}: hard to read); render a part instead: --around <id> [--depth n], --path <from> <to> or ${opts.tiles ? '--scope <id>' : '--tiles'}`);
    }
    const views = tiled ?? [{ view }];
    const problems = opts.problems ? this.badges(listed, views, scale) : [];
    const images = views.map((t, i) => {
      const s = tiled ? Math.min(base, max ? max / Math.max(t.view.width, t.view.height) : base) : scale;
      return { ...this.emit(t.view, s, tiled ? i + 1 : undefined), ...(t.columns ? { columns: t.columns } : {}), ...(t.band ? { band: t.band } : {}) };
    });
    const first = images[0]!;
    return {
      svg: first.svg,
      width: first.width,
      height: first.height,
      scale: Math.round(scale * 10000) / 10000,
      tokens: first.tokens,
      plane: frame.plane,
      planes: frame.planes,
      notes,
      problems,
      ...(frame.nodes ? { nodes: frame.nodes } : {}),
      ...(tiled ? { tiles: images } : {}),
    };
  }

  private static nearFocus(plane: Plane, focus: Set<string>): Set<string> {
    const near = new Set<string>();
    for (const e of plane.edges.values()) {
      const ends = [e.sourceId, e.targetId].filter((x): x is string => !!x);
      if (focus.has(e.id) || ends.some((x) => focus.has(x))) for (const x of ends) near.add(x);
    }
    return near;
  }

  private emit(view: Box, scale: number, tile: number | undefined): { svg: string; width: number; height: number; tokens: number } {
    const width = Math.max(1, Math.round(view.width * scale));
    const height = Math.max(1, Math.round(view.height * scale));
    const visible = this.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => meets(item.box, view) && (item.tile === undefined || item.tile === (tile ?? 1)))
      .sort((a, b) => a.item.layer - b.item.layer || a.index - b.index)
      .map(({ item }) => item.svg);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(view.x)} ${n(view.y)} ${n(view.width)} ${n(view.height)}" font-family="${FONT}">\n` +
      `<rect x="${n(view.x)}" y="${n(view.y)}" width="${n(view.width)}" height="${n(view.height)}" fill="${FILL}"/>\n` +
      visible.join('\n') +
      (visible.length ? '\n' : '') +
      '</svg>\n';
    return { svg, width, height, tokens: Math.round((width * height) / 784) };
  }

  private static problemBox(plane: Plane, ids: string[]): Box | undefined {
    const boxes: Box[] = [];
    for (const id of ids) {
      const s = plane.shapes.get(id);
      if (s) boxes.push(s.bounds, ...(s.label ? [s.label] : []));
      const e = plane.edges.get(id);
      if (e?.points.length) boxes.push(pointsBox(e.points), ...(e.label ? [e.label] : []));
    }
    return unionAll(boxes);
  }

  private problemList(asked: true | readonly LayoutProblem[]): LayoutProblem[] {
    const frame = this.frame;
    const defs = frame.defs;
    if (!defs || !frame.located) return [];
    const located = frame.fileProblems ?? new ProblemLocator(defs).locate(LayoutAnalysis.of(defs).problems);
    if (asked === true) {
      const shown = frame.drawn;
      return shown ? located.filter((p) => p.ids.some((id) => shown.has(id))) : located;
    }
    const pool = new Map<string, LayoutProblem[]>();
    for (const p of located) pool.set(problemKey(p), [...(pool.get(problemKey(p)) ?? []), p]);
    return asked.map((p) => pool.get(problemKey(p))?.shift() ?? p);
  }

  private badges(listed: LayoutProblem[], views: Array<{ view: Box }>, scale: number): RenderProblem[] {
    const frame = this.frame;
    const plane = frame.located;
    const r = BADGE_R / scale;
    const placed: Point[] = [];
    return listed.map((p, i) => {
      const out: RenderProblem = { n: i + 1, kind: p.kind, ids: p.ids, ...(p.detail !== undefined ? { detail: p.detail } : {}), drawn: false };
      const at = p.at;
      if (!plane || frame.fileProblems || !at || at.plane !== plane.rootId) return out;
      const tile = views.findIndex((v) => containsPoint(v.view, at));
      if (tile < 0) return out;
      const box = Composer.problemBox(plane, p.ids) ?? { x: at.x, y: at.y, width: 0, height: 0 };
      const spot = Composer.freeSpot(at, placed, r, box);
      placed.push(spot);
      const label = String(i + 1);
      const size = (label.length > 2 ? 9 : 11) / scale;
      this.items.push({
        box: grow({ x: spot.x, y: spot.y, width: 0, height: 0 }, r),
        layer: LAYER.badge,
        extra: true,
        ...(views.length > 1 ? { tile: tile + 1 } : {}),
        svg: `<g data-problem="${i + 1}"><circle cx="${n(spot.x)}" cy="${n(spot.y)}" r="${n(r)}" fill="${BADGE}" stroke="${FILL}" stroke-width="${n(1.5 / scale)}"/><text x="${n(spot.x)}" y="${n(spot.y + size * 0.36)}" font-size="${n(size)}" fill="${FILL}" text-anchor="middle">${label}</text></g>`,
      });
      return { ...out, drawn: true, ...(views.length > 1 ? { tile: tile + 1 } : {}) };
    });
  }

  /** Its point, else the nearest spot inside `box` that no earlier badge covers. */
  private static freeSpot(at: Point, placed: Point[], r: number, box: Box): Point {
    const free = (p: Point): boolean => placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= 2 * r - 0.01);
    if (free(at)) return at;
    for (const ring of [2, 4, 6]) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const p = { x: at.x + Math.cos(a) * ring * r, y: at.y + Math.sin(a) * ring * r };
        if (containsPoint(box, p) && free(p)) return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
      }
    }
    return at;
  }
}
