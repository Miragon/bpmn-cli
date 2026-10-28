import type { Box, Point } from '../../diagram/utils/geom.js';
import { containsPoint, grow, unionAll } from '../../diagram/utils/geom.js';
import { LayoutAnalysis } from '../../diagram/di/LayoutAnalysis.js';
import { ProblemLocator } from '../../diagram/di/ProblemLocator.js';
import { problemKey, type LayoutProblem } from '../../diagram/utils/problems.js';
import type { Plane } from '../../diagram/di/types.js';
import { TileGrid } from './TileGrid.js';
import { LAYER, MARGIN, MAX_TILES, MIN_LABEL_SCALE, type RenderFrame, type Item, type RenderOptions, type RenderProblem, type RenderResult } from './types.js';
import { meets, pointsBox } from '../utils/boxes.js';
import { scaleText } from '../utils/scale.js';
import { FILL, formatNumber } from '../utils/svg.js';

const FOCUS_MARGIN = 40;
const BADGE = '#e03131';
/** in image px: a badge keeps its size when the drawing is scaled */
const BADGE_R = 9;
const FONT = 'Arial, Arimo, sans-serif';

export class Composer {
  constructor(
    private readonly items: Item[],
    private readonly frame: RenderFrame,
    private readonly opts: RenderOptions,
  ) {}

  result(): RenderResult {
    const { items, frame, opts } = this;
    const notes = frame.notes;
    const fit = items.filter((item) => !item.extra);
    const content = unionAll((fit.length ? fit : items).map((item) => item.fit ?? item.box)) ?? { x: 0, y: 0, width: 0, height: 0 };
    let view = grow(content, MARGIN);
    let scale = opts.scale ?? 1;
    if (!(scale > 0) || !Number.isFinite(scale)) scale = 1;
    const base = scale;
    const max = opts.maxSize && opts.maxSize > 0 ? opts.maxSize : undefined;
    const fitted = (candidate: Box): number => (max && Math.max(candidate.width, candidate.height) * base > max ? max / Math.max(candidate.width, candidate.height) : base);
    const focus = new Set(opts.focus ?? []);
    if (focus.size && fitted(view) < MIN_LABEL_SCALE && frame.located) {
      const near = Composer.nearFocus(frame.located, focus);
      const region = unionAll(items.filter((item) => item.id !== undefined && (focus.has(item.id) || (near.has(item.id) && !frame.located!.edges.has(item.id)))).map((item) => item.box));
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
      const bands = Math.max(...tiled.map((tile) => tile.band ?? 1));
      const parts = tiled.length > 1 ? `split into ${tiled.length} tiles${bands > 1 ? ` (${bands} bands)` : ''} at the diagram's columns (show --layout c<n>)` : 'one tile holds every shape and label';
      notes.push(`${parts}, each at scale ${scaleText(base)}${cut && 'views' in cut && cut.skipped ? '; parts with no shape or label (empty, or only connections passing through) are left out' : ''}`);
    } else if (scale < MIN_LABEL_SCALE) {
      if (cut && 'over' in cut) notes.push(`--tiles: the drawing needs more than ${MAX_TILES} tiles at scale ${scaleText(base)}: it is drawn as one image instead`);
      notes.push(`the labels are drawn at ${scaleText(scale)} of their size (below ${MIN_LABEL_SCALE}: hard to read); render a part instead: --around <id> [--depth n], --path <from> <to> or ${opts.tiles ? '--scope <id>' : '--tiles'}`);
    }
    const views = tiled ?? [{ view }];
    const problems = opts.problems ? this.badges(listed, views, scale) : [];
    const images = views.map((tile, index) => {
      const tileScale = tiled ? Math.min(base, max ? max / Math.max(tile.view.width, tile.view.height) : base) : scale;
      return { ...this.emit(tile.view, tileScale, tiled ? index + 1 : undefined), ...(tile.columns ? { columns: tile.columns } : {}), ...(tile.band ? { band: tile.band } : {}) };
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
    for (const edge of plane.edges.values()) {
      const ends = [edge.sourceId, edge.targetId].filter((nodeId): nodeId is string => !!nodeId);
      if (focus.has(edge.id) || ends.some((nodeId) => focus.has(nodeId))) for (const nodeId of ends) near.add(nodeId);
    }
    return near;
  }

  private emit(view: Box, scale: number, tile: number | undefined): { svg: string; width: number; height: number; tokens: number } {
    const width = Math.max(1, Math.round(view.width * scale));
    const height = Math.max(1, Math.round(view.height * scale));
    const visible = this.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => meets(item.box, view) && (item.tile === undefined || item.tile === (tile ?? 1)))
      .sort((first, second) => first.item.layer - second.item.layer || first.index - second.index)
      .map(({ item }) => item.svg);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${formatNumber(view.x)} ${formatNumber(view.y)} ${formatNumber(view.width)} ${formatNumber(view.height)}" font-family="${FONT}">\n` +
      `<rect x="${formatNumber(view.x)}" y="${formatNumber(view.y)}" width="${formatNumber(view.width)}" height="${formatNumber(view.height)}" fill="${FILL}"/>\n` +
      visible.join('\n') +
      (visible.length ? '\n' : '') +
      '</svg>\n';
    return { svg, width, height, tokens: Math.round((width * height) / 784) };
  }

  private static problemBox(plane: Plane, ids: string[]): Box | undefined {
    const boxes: Box[] = [];
    for (const id of ids) {
      const shape = plane.shapes.get(id);
      if (shape) boxes.push(shape.bounds, ...(shape.label ? [shape.label] : []));
      const edge = plane.edges.get(id);
      if (edge?.points.length) boxes.push(pointsBox(edge.points), ...(edge.label ? [edge.label] : []));
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
      return shown ? located.filter((problem) => problem.ids.some((id) => shown.has(id))) : located;
    }
    const pool = new Map<string, LayoutProblem[]>();
    for (const problem of located) pool.set(problemKey(problem), [...(pool.get(problemKey(problem)) ?? []), problem]);
    return asked.map((problem) => pool.get(problemKey(problem))?.shift() ?? problem);
  }

  private badges(listed: LayoutProblem[], views: Array<{ view: Box }>, scale: number): RenderProblem[] {
    const frame = this.frame;
    const plane = frame.located;
    const radius = BADGE_R / scale;
    const placed: Point[] = [];
    return listed.map((problem, index) => {
      const out: RenderProblem = { n: index + 1, kind: problem.kind, ids: problem.ids, ...(problem.detail !== undefined ? { detail: problem.detail } : {}), drawn: false };
      const at = problem.at;
      if (!plane || frame.fileProblems || !at || at.plane !== plane.rootId) return out;
      const tile = views.findIndex((candidate) => containsPoint(candidate.view, at));
      if (tile < 0) return out;
      const box = Composer.problemBox(plane, problem.ids) ?? { x: at.x, y: at.y, width: 0, height: 0 };
      const spot = Composer.freeSpot(at, placed, radius, box);
      placed.push(spot);
      const label = String(index + 1);
      const size = (label.length > 2 ? 9 : 11) / scale;
      this.items.push({
        box: grow({ x: spot.x, y: spot.y, width: 0, height: 0 }, radius),
        layer: LAYER.badge,
        extra: true,
        ...(views.length > 1 ? { tile: tile + 1 } : {}),
        svg: `<g data-problem="${index + 1}"><circle cx="${formatNumber(spot.x)}" cy="${formatNumber(spot.y)}" r="${formatNumber(radius)}" fill="${BADGE}" stroke="${FILL}" stroke-width="${formatNumber(1.5 / scale)}"/><text x="${formatNumber(spot.x)}" y="${formatNumber(spot.y + size * 0.36)}" font-size="${formatNumber(size)}" fill="${FILL}" text-anchor="middle">${label}</text></g>`,
      });
      return { ...out, drawn: true, ...(views.length > 1 ? { tile: tile + 1 } : {}) };
    });
  }

  /** Its point, else the nearest spot inside `box` that no earlier badge covers. */
  private static freeSpot(at: Point, placed: Point[], radius: number, box: Box): Point {
    const free = (point: Point): boolean => placed.every((other) => Math.hypot(point.x - other.x, point.y - other.y) >= 2 * radius - 0.01);
    if (free(at)) return at;
    for (const ring of [2, 4, 6]) {
      for (let step = 0; step < 8; step++) {
        const angle = (step * Math.PI) / 4;
        const point = { x: at.x + Math.cos(angle) * ring * radius, y: at.y + Math.sin(angle) * ring * radius };
        if (containsPoint(box, point) && free(point)) return { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
      }
    }
    return at;
  }
}
