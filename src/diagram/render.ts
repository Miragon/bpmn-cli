/**
 * The drawing as an image: one diagram plane (its DI) drawn as SVG without a
 * browser, close to how bpmn-js draws it (not pixel-identical), so an agent
 * can look at what it changed (`bpmn render`; the node layer rasterises the
 * SVG to PNG, src/node/render.ts).
 *
 * CONTRACT
 *  - renderSvg(xml, opts) parses the document (E_PARSE) and draws one plane:
 *    `plane` names the element the plane shows (a collapsed sub-process, the
 *    process or the collaboration); default the first BPMNDiagram. An
 *    unknown id is E_NOT_FOUND, an element without a plane of its own
 *    E_WRONG_KIND; both list the planes as candidates. A document without
 *    any diagram is laid out in memory first (the clean engine; nothing is
 *    written) and a note says so.
 *  - renderPlaneSvg(defs, opts) draws a parsed document (no layout).
 *  - The image: the drawn elements' bounding box (shapes, waypoints, the
 *    labels as drawn) plus a 20 px margin, on white. `scale` (default 1)
 *    zooms; with `maxSize` the long edge is capped at that many px (the
 *    scale shrinks). width / height are the image size in px, `tokens` the
 *    image-token estimate width * height / 784.
 *  - The result lists the plane drawn (`plane`, its element id), the other
 *    planes (`planes`: collapsed sub-processes and other diagrams, document
 *    order) and `notes`: labels drawn below MIN_LABEL_SCALE (hard to read;
 *    names the crop options), elements of the plane without a shape, the
 *    in-memory layout.
 *  - Deterministic: the same input and options give the same bytes;
 *    coordinates are rounded to 2 decimals.
 *  - What is drawn: events with their triggers (catching outlined,
 *    throwing filled; start, intermediate / boundary with a double ring,
 *    end with a thick ring; non-interrupting ones dashed; multiple and
 *    parallel multiple), gateways with their markers (the exclusive X only
 *    when the DI says isMarkerVisible, like bpmn-js), tasks with a type icon
 *    (user, manual, service, send, receive, script, business rule), call
 *    activities (thick border), the activity markers (loop, parallel /
 *    sequential multi-instance, compensation, ad-hoc, collapsed
 *    sub-process), expanded and collapsed sub-processes, event
 *    sub-processes (dotted), transactions (double border), pools (header
 *    band; black-box pools with the name centred; vertical pools), lanes,
 *    data objects (collection, input / output), data stores, text
 *    annotations, groups, sequence flows (default slash, conditional
 *    diamond from an activity), message flows (circle at the source, open
 *    arrow at the target), associations (directed ones with arrows), data
 *    associations, bpmn-js colours (color:background-color / bioc:fill,
 *    color:border-color / bioc:stroke, color:color of the label). Anything
 *    else with a shape is a plain box.
 *  - Labels like bpmn-js: external labels (events, gateways, data, flows,
 *    groups) centred on the DI label bounds with their top at its y, wrapped
 *    at 90 px in 11 px Arial (text.ts wrapLines), 13.2 px a line; without
 *    label bounds below the shape (a group: at its top), a flow's at the
 *    middle of its middle segment, 15 px above it (right of a vertical one).
 *    Embedded labels: 12 px, padding 7, centred in tasks and collapsed
 *    sub-processes, at the top of expanded ones, left-top in annotations;
 *    pool and lane names in their 30 px header band.
 *  - Off-viewport culling: shapes, connections and labels outside the view
 *    are left out of the SVG (a rasteriser never sees content far outside
 *    the image).
 *  - The glyphs are drawn here from the BPMN notation (no bpmn-js code or
 *    paths). Text uses Arial (Arimo, metric-compatible, is what the PNG
 *    rasteriser bundles).
 *  - Browser-safe and free of side effects at import (tree-shaken out of a
 *    host that does not render).
 */
import { Doc } from '../document.js';
import { modelError } from '../errors.js';
import { layoutModel } from '../layout.js';
import { is, parseXml, type El } from '../model.js';
import type { Box, Point } from './geom.js';
import { homePlane, raw, rawList, readPlanes, semantics, type DEdge, type DShape, type Plane, type Semantics } from './plane.js';
import { textWidth, wrapLines } from './text.js';

/** Options of renderSvg / renderPlaneSvg (renderPng adds nothing in this stage). */
export interface RenderOptions {
  /** the element whose plane to draw: a collapsed sub-process, the process or the collaboration (default: the first diagram) */
  plane?: string;
  /** zoom factor of the image (default 1) */
  scale?: number;
  /** longest edge of the image in px: a larger image is scaled down to it (default: no limit) */
  maxSize?: number;
}

export interface RenderResult {
  /** the SVG document */
  svg: string;
  /** image size in px (after scale / maxSize) */
  width: number;
  height: number;
  /** the zoom factor used (below `scale` when maxSize capped it) */
  scale: number;
  /** image-token estimate of the image: width * height / 784, rounded */
  tokens: number;
  /** the element whose plane was drawn */
  plane: string;
  /** the other planes (their element ids, document order): what `plane` can name */
  planes: string[];
  /** labels below MIN_LABEL_SCALE, elements without a shape, an in-memory layout */
  notes: string[];
}

/** The long edge `bpmn render` and renderPng cap an image at by default (what Claude Code displays). */
export const RENDER_MAX_SIZE = 2000;
/** Below this scale the 11-12 px labels drop under ~8 px and are hard to read: the result says so. */
export const MIN_LABEL_SCALE = 0.75;

const MARGIN = 20;
const STROKE = '#22242a';
const FILL = '#ffffff';
const FONT = 'Arial, Arimo, sans-serif';
/** external labels (bpmn-js: 11 px, 90 px wide, line height 1.2) */
const EXT_SIZE = 11;
const EXT_WIDTH = 90;
const EXT_LINE = EXT_SIZE * 1.2;
const SIZE = 12;

/* ------------------------------------------------------------------ */
/* entry points                                                         */
/* ------------------------------------------------------------------ */

/** `bpmn render --format svg`: one plane of the document as SVG (see the module contract). */
export async function renderSvg(xml: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const doc = await Doc.fromXml(xml);
  let defs = doc.definitions;
  const notes: string[] = [];
  if (!readPlanes(defs).length) {
    // nothing drawn: draw it in memory (layoutModel replaces the DI; its XML is the truth)
    const { xml: drawn } = await layoutModel(doc.model);
    defs = (await parseXml(drawn)).definitions;
    notes.push('the file has no diagram: it is drawn by the layout engine in memory (nothing is written; `bpmn layout <file>` saves a drawing)');
  }
  const result = renderPlaneSvg(defs, opts);
  return { ...result, notes: [...notes, ...result.notes] };
}

/** One plane of a parsed document as SVG (no layout; see the module contract). */
export function renderPlaneSvg(defs: El, opts: RenderOptions = {}): RenderResult {
  const sem = semantics(defs);
  const planes = readPlanes(defs, sem);
  const plane = pickPlane(planes, sem, opts.plane);
  const others = planes.filter((p) => p !== plane).map((p) => p.rootId);
  const notes: string[] = [];
  if (!plane) return finish(emptyScene(), 'none', others, ['the document has no diagram plane'], opts);
  const scene = drawPlane(plane);
  const undrawn = undrawnOn(planes, plane, sem);
  if (undrawn.length) {
    const shown = undrawn.slice(0, 5).join(', ') + (undrawn.length > 5 ? `, ... (${undrawn.length - 5} more)` : '');
    notes.push(`${undrawn.length} element${undrawn.length > 1 ? 's have' : ' has'} no shape and ${undrawn.length > 1 ? 'are' : 'is'} not drawn: ${shown} (\`bpmn layout <file>\` draws ${undrawn.length > 1 ? 'them' : 'it'})`);
  }
  if (!plane.shapes.size && !plane.edges.size) notes.push(`the plane of ${plane.rootId} is empty`);
  return finish(scene, plane.rootId, others, notes, opts);
}

function pickPlane(planes: Plane[], sem: Semantics, id: string | undefined): Plane | undefined {
  if (id === undefined) return planes[0];
  const found = planes.find((p) => p.rootId === id);
  if (found) return found;
  const candidates = planes.map((p) => p.rootId);
  const hint = candidates.length ? `The planes of this file: ${candidates.join(', ')}.` : 'The file has no diagram.';
  if (!sem.byId.has(id)) throw modelError('E_NOT_FOUND', `No element with id "${id}"`, { element: id, candidates, hint });
  throw modelError('E_WRONG_KIND', `${id} has no diagram plane of its own (only collapsed sub-processes, processes and collaborations have one)`, { element: id, candidates, hint: `${hint} An expanded sub-process is drawn on the plane of its parent.` });
}

/** Flow elements, artifacts, lanes, pools and message flows whose DI belongs on `plane` but which have none. */
function undrawnOn(planes: Plane[], plane: Plane, sem: Semantics): string[] {
  const out: string[] = [];
  for (const [id, el] of sem.byId) {
    if (plane.shapes.has(id) || plane.edges.has(id)) continue;
    const drawable =
      is(el, 'bpmn:FlowNode') ||
      is(el, 'bpmn:SequenceFlow') ||
      is(el, 'bpmn:MessageFlow') ||
      is(el, 'bpmn:Lane') ||
      is(el, 'bpmn:Participant') ||
      is(el, 'bpmn:DataObjectReference') ||
      is(el, 'bpmn:DataStoreReference') ||
      is(el, 'bpmn:TextAnnotation');
    if (!drawable || planes.some((p) => p.shapes.has(id) || p.edges.has(id))) continue;
    if (homePlane(planes, sem, id) === plane) out.push(id);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* the scene: drawable items with their boxes, then the view            */
/* ------------------------------------------------------------------ */

interface Item {
  /** what it covers (culling and the view) */
  box: Box;
  /** paint order: lower first */
  layer: number;
  svg: string;
}

interface Scene {
  items: Item[];
}

const emptyScene = (): Scene => ({ items: [] });

function finish(scene: Scene, planeId: string, planes: string[], notes: string[], opts: RenderOptions): RenderResult {
  const content = unionOf(scene.items.map((i) => i.box)) ?? { x: 0, y: 0, width: 0, height: 0 };
  const view = { x: content.x - MARGIN, y: content.y - MARGIN, width: content.width + 2 * MARGIN, height: content.height + 2 * MARGIN };
  let scale = opts.scale ?? 1;
  if (!(scale > 0) || !Number.isFinite(scale)) scale = 1;
  const long = Math.max(view.width, view.height);
  if (opts.maxSize && opts.maxSize > 0 && long * scale > opts.maxSize) scale = opts.maxSize / long;
  const width = Math.max(1, Math.round(view.width * scale));
  const height = Math.max(1, Math.round(view.height * scale));
  if (scale < MIN_LABEL_SCALE) {
    notes.push(
      `the labels are drawn at ${scale.toFixed(2)} of their size (below ${MIN_LABEL_SCALE}: hard to read); render a part instead: --around <id> [--depth n], --path <from> <to> or --tiles`,
    );
  }
  const visible = scene.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => meets(item.box, view))
    .sort((a, b) => a.item.layer - b.item.layer || a.index - b.index)
    .map(({ item }) => item.svg);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(view.x)} ${n(view.y)} ${n(view.width)} ${n(view.height)}" font-family="${FONT}">\n` +
    `<rect x="${n(view.x)}" y="${n(view.y)}" width="${n(view.width)}" height="${n(view.height)}" fill="${FILL}"/>\n` +
    visible.join('\n') +
    (visible.length ? '\n' : '') +
    '</svg>\n';
  return { svg, width, height, scale: Math.round(scale * 10000) / 10000, tokens: Math.round((width * height) / 784), plane: planeId, planes, notes };
}

/* layers: frames from outside in, then leaves, groups, boundary events, connections, labels */
const LAYER = { participant: 0, lane: 1, subProcess: 2, leaf: 3, group: 4, boundary: 5, edge: 6, label: 7 } as const;

function drawPlane(plane: Plane): Scene {
  const items: Item[] = [];
  for (const s of plane.shapes.values()) {
    const style = stylesOf(s.di);
    const label = shapeLabel(s, style);
    const layer =
      s.kind === 'participant'
        ? LAYER.participant
        : s.kind === 'lane'
          ? LAYER.lane + depth(plane, s, (x) => x.laneId) / 100
          : s.kind === 'subProcess' && s.expanded
            ? LAYER.subProcess + depth(plane, s, (x) => x.parentId) / 100
            : s.kind === 'group'
              ? LAYER.group
              : s.kind === 'boundary'
                ? LAYER.boundary
                : LAYER.leaf;
    items.push({ box: s.bounds, layer, svg: `<g data-id="${attr(s.id)}">${shapeSvg(s, style)}</g>` });
    if (label) items.push(label);
  }
  for (const e of plane.edges.values()) {
    if (e.points.length < 2) continue;
    const style = stylesOf(e.di);
    items.push({ box: pointsBox(e.points), layer: LAYER.edge, svg: `<g data-id="${attr(e.id)}">${edgeSvg(e, style)}</g>` });
    const label = edgeLabel(e, style);
    if (label) items.push(label);
  }
  return { items };
}

/** Nesting depth along a parent link (lanes: parent lane; sub-processes: parent sub-process). */
function depth(plane: Plane, s: DShape, parent: (s: DShape) => string | undefined): number {
  let d = 0;
  for (let p = parent(s); p && d < 50; d++) p = plane.shapes.get(p) ? parent(plane.shapes.get(p)!) : undefined;
  return d;
}

/* ------------------------------------------------------------------ */
/* small helpers                                                        */
/* ------------------------------------------------------------------ */

/** A coordinate rounded to 2 decimals (deterministic text, no -0). */
function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(r === 0 ? 0 : r);
}

function text(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(s: string): string {
  return text(s).replace(/"/g, '&quot;');
}

function meets(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

function unionOf(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function pointsBox(points: readonly Point[]): Box {
  return unionOf(points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })))!;
}

/* ------------------------------------------------------------------ */
/* colours                                                              */
/* ------------------------------------------------------------------ */

interface Style {
  fill: string;
  stroke: string;
  label: string;
  /** an explicit fill (lanes show only that) */
  filled: boolean;
}

/** A colour value safe to put into the SVG: hex, rgb()/rgba()/hsl()/hsla() or a colour keyword. */
function safeColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const c = v.trim();
  return /^#[0-9a-f]{3,8}$/i.test(c) || /^(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)$/i.test(c) || /^[a-z]{3,30}$/i.test(c) ? c : undefined;
}

function colorAttr(el: El | undefined, key: string): string | undefined {
  if (!el) return undefined;
  const get = (el as { get?: (k: string) => unknown }).get;
  return safeColor(typeof get === 'function' ? get.call(el, key) : undefined);
}

/** bpmn-js's reading of the colour attributes: the color: namespace first, then bioc:. */
function stylesOf(di: El | undefined): Style {
  const fill = colorAttr(di, 'color:background-color') ?? colorAttr(di, 'bioc:fill');
  const stroke = colorAttr(di, 'color:border-color') ?? colorAttr(di, 'bioc:stroke') ?? STROKE;
  const label = colorAttr(raw<El>(di, 'label'), 'color:color') ?? stroke;
  return { fill: fill ?? FILL, stroke, label, filled: !!fill };
}

/* ------------------------------------------------------------------ */
/* text                                                                 */
/* ------------------------------------------------------------------ */

/** Lines as one <text>: `x` and the first baseline `y`, each next line `size * 1.2` lower. */
function lines(ls: string[], x: number, y: number, size: number, color: string, anchor: 'middle' | 'start', extra = ''): string {
  const step = size * 1.2;
  const spans = ls.map((l, i) => `<tspan x="${n(x)}" y="${n(y + i * step)}">${text(l.trim())}</tspan>`).join('');
  return `<text${extra} font-size="${size}" fill="${color}" text-anchor="${anchor}">${spans}</text>`;
}

/**
 * diagram-js Text in a box: wrapped at the box width minus the padding,
 * horizontally centred or left, vertically at the top (padding) or centred
 * (no padding), the first baseline 3/4 of a line below the text's top.
 */
function boxText(value: string, box: Box, h: 'center' | 'left', v: 'top' | 'middle', padding: number, color: string, transform = ''): string {
  const ls = wrapLines(value, box.width - 2 * padding);
  const step = SIZE * 1.2;
  const pad = v === 'middle' ? 0 : padding;
  const top = pad + (v === 'middle' ? (box.height - ls.length * step) / 2 : 0);
  const x = h === 'left' ? box.x + padding : box.x + box.width / 2;
  return lines(ls, x, box.y + top + step * 0.75, SIZE, color, h === 'left' ? 'start' : 'middle', transform);
}

/** An external label like bpmn-js: centred on `cx`, its top at `top`, wrapped at 90 px in 11 px (data-label: the element's id). */
function externalLabel(id: string, value: string, cx: number, top: number, color: string): Item {
  const ls = wrapLines(value, (EXT_WIDTH * SIZE) / EXT_SIZE);
  const width = Math.max(...ls.map((l) => (textWidth(l) * EXT_SIZE) / SIZE), 1);
  return {
    box: { x: cx - width / 2, y: top, width, height: ls.length * EXT_LINE },
    layer: LAYER.label,
    svg: lines(ls, cx, top + EXT_LINE * 0.75, EXT_SIZE, color, 'middle', ` data-label="${attr(id)}"`),
  };
}

/** The label of a shape drawn outside it (events, gateways, data, groups). */
function shapeLabel(s: DShape, style: Style): Item | undefined {
  const external = s.kind === 'event' || s.kind === 'boundary' || s.kind === 'gateway' || s.kind === 'data' || s.kind === 'group';
  if (!external) return undefined;
  const value = s.kind === 'group' ? raw<string>(raw(s.el, 'categoryValueRef'), 'value') : raw<string>(s.el, 'name');
  if (!value || !value.trim()) return undefined;
  if (s.label) return externalLabel(s.id, value, s.label.x + s.label.width / 2, Math.round(s.label.y), style.label);
  const b = s.bounds;
  // no label bounds: bpmn-js puts a 90 x 20 label below the shape (a group's at its top)
  return externalLabel(s.id, value, b.x + b.width / 2, Math.round(s.kind === 'group' ? b.y : b.y + b.height), style.label);
}

function edgeLabel(e: DEdge, style: Style): Item | undefined {
  if (e.kind !== 'sequenceFlow' && e.kind !== 'messageFlow') return undefined;
  const value = raw<string>(e.el, 'name');
  if (!value || !value.trim()) return undefined;
  if (e.label) return externalLabel(e.id, value, e.label.x + e.label.width / 2, Math.round(e.label.y), style.label);
  const mid = flowLabelMid(e.points);
  return externalLabel(e.id, value, mid.x, Math.round(mid.y - 10), style.label);
}

/** bpmn-js's default flow label position: the middle of the middle segment, 15 px above it (right of a vertical one). */
function flowLabelMid(points: readonly Point[]): Point {
  const m = points.length / 2 - 1;
  const a = points[Math.max(0, Math.floor(m))]!;
  const b = points[Math.min(points.length - 1, Math.ceil(m + 0.01))]!;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const angle = Math.atan((b.y - a.y) / (b.x - a.x));
  return Math.abs(angle) < Math.PI / 2 ? { x: mid.x, y: mid.y - 15 } : { x: mid.x + 15, y: mid.y };
}

/* ------------------------------------------------------------------ */
/* shapes                                                               */
/* ------------------------------------------------------------------ */

function shapeSvg(s: DShape, st: Style): string {
  switch (s.kind) {
    case 'event':
    case 'boundary':
      return eventSvg(s, st);
    case 'gateway':
      return gatewaySvg(s, st);
    case 'task':
      return activitySvg(s, st, false);
    case 'subProcess':
      return activitySvg(s, st, !!s.expanded);
    case 'participant':
      return poolSvg(s, st);
    case 'lane':
      return laneSvg(s, st);
    case 'data':
      return dataSvg(s, st);
    case 'annotation':
      return annotationSvg(s, st);
    case 'group': {
      const b = s.bounds;
      return `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.width)}" height="${n(b.height)}" rx="10" fill="none" stroke="${st.stroke}" stroke-width="1.5" stroke-dasharray="10 4 2 4"/>`;
    }
    default: {
      const b = s.bounds;
      const name = raw<string>(s.el, 'name') ?? raw<string>(s.el, 'text');
      return `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.width)}" height="${n(b.height)}" fill="${st.filled ? st.fill : 'none'}" stroke="${st.stroke}" stroke-width="1"/>` + (name ? boxText(name, b, 'center', 'middle', 7, st.label) : '');
    }
  }
}

/** A glyph in its own coordinates (centred on 0,0 for events and gateways), placed and scaled. */
function at(x: number, y: number, k: number, body: string): string {
  return `<g transform="translate(${n(x)} ${n(y)})${k !== 1 ? ` scale(${n(k)})` : ''}">${body}</g>`;
}

/* --- events --- */

const TIMER_TICKS = 'M0 -7.6L0 -9.8M3.8 -6.6L4.9 -8.5M6.6 -3.8L8.5 -4.9M7.6 0L9.8 0M6.6 3.8L8.5 4.9M3.8 6.6L4.9 8.5M0 7.6L0 9.8M-3.8 6.6L-4.9 8.5M-6.6 3.8L-8.5 4.9M-7.6 0L-9.8 0M-6.6 -3.8L-8.5 -4.9M-3.8 -6.6L-4.9 -8.5';
const PENTAGON = 'M0 -8L7.6 -2.5L4.7 6.5L-4.7 6.5L-7.6 -2.5Z';
const PLUS = 'M-2 -9H2V-2H9V2H2V9H-2V2H-9V-2H-2Z';

/** The trigger glyph of an event, centred on 0,0 (an 18 px radius event); `full` for throwing events. */
function triggerGlyph(el: El, full: boolean, st: Style): string {
  const defs = rawList(el, 'eventDefinitions');
  if (!defs.length) return '';
  const ink = st.stroke;
  const paper = st.fill;
  const fill = full ? ink : paper;
  const shape = (d: string, extra = ''): string => `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"${extra}/>`;
  if (defs.length > 1) return raw(el, 'parallelMultiple') ? shape(PLUS) : shape(PENTAGON);
  const d = defs[0]!;
  if (is(d, 'bpmn:MessageEventDefinition')) {
    return `<rect x="-8.5" y="-6" width="17" height="12" fill="${fill}" stroke="${ink}" stroke-width="1.2"/><path d="M-8.5 -6L0 0.8L8.5 -6" fill="none" stroke="${full ? paper : ink}" stroke-width="1.2"/>`;
  }
  if (is(d, 'bpmn:TimerEventDefinition')) {
    return `<circle r="10.5" fill="${paper}" stroke="${ink}" stroke-width="1.5"/><path d="${TIMER_TICKS}" stroke="${ink}" stroke-width="1"/><path d="M0 -7L0 0L5 2.5" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`;
  }
  if (is(d, 'bpmn:ConditionalEventDefinition')) {
    return `<rect x="-7" y="-9" width="14" height="18" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><path d="M-4.5 -5H4.5M-4.5 -1.5H4.5M-4.5 2H4.5M-4.5 5.5H4.5" stroke="${ink}" stroke-width="1"/>`;
  }
  if (is(d, 'bpmn:SignalEventDefinition')) return shape('M0 -9.5L8.5 6H-8.5Z');
  if (is(d, 'bpmn:EscalationEventDefinition')) return shape('M0 -9L7 8L0 2L-7 8Z');
  if (is(d, 'bpmn:ErrorEventDefinition')) return shape('M-8 8L-3.5 -7.5L1.5 1.5L7.5 -8.5L3 7.5L-1.5 -1Z');
  if (is(d, 'bpmn:LinkEventDefinition')) return shape('M-8 -3.5H1V-8L9 0L1 8V3.5H-8Z');
  if (is(d, 'bpmn:CompensateEventDefinition')) return shape('M-8 0L0 -6V6ZM0 0L8 -6V6Z');
  if (is(d, 'bpmn:CancelEventDefinition')) return shape('M-7 -9L0 -2L7 -9L9 -7L2 0L9 7L7 9L0 2L-7 9L-9 7L-2 0L-9 -7Z');
  if (is(d, 'bpmn:TerminateEventDefinition')) return `<circle r="10.5" fill="${ink}"/>`;
  return '';
}

function eventSvg(s: DShape, st: Style): string {
  const b = s.bounds;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const r = Math.min(b.width, b.height) / 2;
  const el = s.el;
  const start = is(el, 'bpmn:StartEvent');
  const end = is(el, 'bpmn:EndEvent');
  const nonInterrupting = (s.kind === 'boundary' && raw(el, 'cancelActivity') === false) || (start && raw(el, 'isInterrupting') === false);
  const dash = nonInterrupting ? ' stroke-dasharray="5.5 3"' : '';
  let out = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${end ? 4 : start ? 2 : 1.5}"${dash}/>`;
  if (!start && !end) out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(Math.max(1, r - 3))}" fill="none" stroke="${st.stroke}" stroke-width="1.5"${dash}/>`;
  const glyph = triggerGlyph(el, end || is(el, 'bpmn:IntermediateThrowEvent'), st);
  return glyph ? out + at(cx, cy, r / 18, glyph) : out;
}

/* --- gateways --- */

function gatewayMarker(s: DShape, st: Style): string {
  const el = s.el;
  const ink = st.stroke;
  const bar = (d: string, w: number): string => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w}"/>`;
  if (is(el, 'bpmn:ParallelGateway')) return bar('M0 -12V12M-12 0H12', 4.5);
  if (is(el, 'bpmn:InclusiveGateway')) return `<circle r="10.5" fill="none" stroke="${ink}" stroke-width="3.5"/>`;
  if (is(el, 'bpmn:ComplexGateway')) return bar('M0 -12V12M-12 0H12M-8.5 -8.5L8.5 8.5M8.5 -8.5L-8.5 8.5', 4);
  if (is(el, 'bpmn:EventBasedGateway')) {
    const parallel = raw(el, 'eventGatewayType') === 'Parallel';
    const instantiate = raw(el, 'instantiate') === true;
    const ring = `<circle r="12" fill="none" stroke="${ink}" stroke-width="1.2"/>` + (parallel || instantiate ? '' : `<circle r="9.3" fill="none" stroke="${ink}" stroke-width="1.2"/>`);
    return ring + `<path d="${parallel ? 'M-1.5 -7H1.5V-1.5H7V1.5H1.5V7H-1.5V1.5H-7V-1.5H-1.5Z' : 'M0 -5.5L5.2 -1.7L3.2 4.4L-3.2 4.4L-5.2 -1.7Z'}" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
  }
  if (is(el, 'bpmn:ExclusiveGateway') && raw(s.di, 'isMarkerVisible') === true) return bar('M-7.5 -9.5L7.5 9.5M7.5 -9.5L-7.5 9.5', 4.5);
  return '';
}

function gatewaySvg(s: DShape, st: Style): string {
  const b = s.bounds;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const diamond = `<path d="M${n(cx)} ${n(b.y)}L${n(b.x + b.width)} ${n(cy)}L${n(cx)} ${n(b.y + b.height)}L${n(b.x)} ${n(cy)}Z" fill="${st.fill}" stroke="${st.stroke}" stroke-width="2" stroke-linejoin="round"/>`;
  const marker = gatewayMarker(s, st);
  return marker ? diamond + at(cx, cy, Math.min(b.width, b.height) / 50, marker) : diamond;
}

/* --- activities --- */

/** Task type icons, drawn in a 20 x 20 box at the activity's top-left corner. */
function taskIcon(el: El, st: Style): string {
  const ink = st.stroke;
  const paper = st.fill;
  const line = (d: string, w = 1.2): string => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (is(el, 'bpmn:UserTask')) {
    return `<path d="M2 18V15C2 11.5 5 10 10 10C15 10 18 11.5 18 15V18Z" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><circle cx="10" cy="6" r="3.8" fill="${paper}" stroke="${ink}" stroke-width="1.2"/>` + line('M6 18V15M14 18V15');
  }
  if (is(el, 'bpmn:ManualTask')) {
    return line('M2 11C2 7.5 4 6 7 6H17a1.2 1.2 0 0 1 0 2.4H11M11 8.4H18.5a1.2 1.2 0 0 1 0 2.4H11M11 10.8H18a1.2 1.2 0 0 1 0 2.4H11M11 13.2H16.5a1.2 1.2 0 0 1 0 2.4H7C4 15.6 2 14 2 11Z');
  }
  if (is(el, 'bpmn:ServiceTask')) {
    return `<circle cx="10" cy="10" r="6.6" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="2.59 2.59"/><circle cx="10" cy="10" r="5.2" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><circle cx="10" cy="10" r="2" fill="none" stroke="${ink}" stroke-width="1.2"/>`;
  }
  if (is(el, 'bpmn:SendTask')) {
    return `<rect x="2" y="5" width="16" height="11" fill="${ink}" stroke="${ink}" stroke-width="1.2"/><path d="M2 5L10 11L18 5" fill="none" stroke="${paper}" stroke-width="1.2"/>`;
  }
  if (is(el, 'bpmn:ReceiveTask')) {
    return `<rect x="2" y="5" width="16" height="11" fill="${paper}" stroke="${ink}" stroke-width="1.2"/>` + line('M2 5L10 11L18 5');
  }
  if (is(el, 'bpmn:ScriptTask')) {
    return `<path d="M6 2H17C14 5 14 8 16 10.5C18 13 18 16 15 18H4C7 15 7 12 5 9.5C3 7 3 4 6 2Z" fill="${paper}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>` + line('M7.5 6H13.5M8.5 9.5H14.5M8.5 13H14.5', 1);
  }
  if (is(el, 'bpmn:BusinessRuleTask')) {
    return `<rect x="2" y="4" width="16" height="12" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><rect x="2" y="4" width="16" height="3.5" fill="${ink}"/>` + line('M2 11.5H18M7 7.5V16', 1);
  }
  return '';
}

/** The activity markers at the bottom centre: each a 14 x 14 glyph. */
function activityMarkers(el: El, collapsedSub: boolean, st: Style): string[] {
  const ink = st.stroke;
  const line = (d: string, w = 1.5): string => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const out: string[] = [];
  const loop = raw<El>(el, 'loopCharacteristics');
  if (loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) out.push(raw(loop, 'isSequential') ? line('M2 3H12M2 7H12M2 11H12', 2) : line('M3 2V12M7 2V12M11 2V12', 2));
  else if (loop) out.push(line('M4.2 11.8A5.5 5.5 0 1 1 9.8 11.8') + line('M9.8 11.8L9.6 8.4M9.8 11.8L13 11'));
  if (collapsedSub) out.push(`<rect x="0.5" y="0.5" width="13" height="13" fill="none" stroke="${ink}" stroke-width="1.2"/>` + line('M3.5 7H10.5M7 3.5V10.5', 1.5));
  if (raw(el, 'isForCompensation')) out.push(`<path d="M1 7L7 2.5V11.5ZM7 7L13 2.5V11.5Z" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`);
  if (is(el, 'bpmn:AdHocSubProcess')) out.push(line('M1 8C3.5 4 5.5 4 7 7C8.5 10 10.5 10 13 6'));
  return out;
}

function activitySvg(s: DShape, st: Style, expanded: boolean): string {
  const b = s.bounds;
  const el = s.el;
  const rect = (inset: number, width: number, extra = ''): string =>
    `<rect x="${n(b.x + inset)}" y="${n(b.y + inset)}" width="${n(Math.max(0, b.width - 2 * inset))}" height="${n(Math.max(0, b.height - 2 * inset))}" rx="${10 - inset}" fill="${inset ? 'none' : st.fill}" stroke="${st.stroke}" stroke-width="${width}"${extra}/>`;
  let out: string;
  if (is(el, 'bpmn:Transaction')) out = rect(0, 1.5) + rect(3, 1.5);
  else if (raw(el, 'triggeredByEvent')) out = rect(0, 2, ' stroke-dasharray="1 4" stroke-linecap="round"');
  else out = rect(0, is(el, 'bpmn:CallActivity') ? 5 : 2);
  const icon = s.kind === 'task' ? taskIcon(el, st) : '';
  if (icon) out += at(b.x + 4, b.y + 4, 1, icon);
  const name = raw<string>(el, 'name');
  // a call activity is drawn like a collapsed sub-process (bpmn-js: the + marker)
  const collapsed = (s.kind === 'subProcess' && !expanded) || is(el, 'bpmn:CallActivity');
  if (name && name.trim()) out += boxText(name, b, 'center', expanded ? 'top' : 'middle', 7, st.label);
  const markers = activityMarkers(el, collapsed, st);
  const gap = 3;
  const total = markers.length * 14 + (markers.length - 1) * gap;
  markers.forEach((m, i) => {
    out += at(b.x + b.width / 2 - total / 2 + i * (14 + gap), b.y + b.height - 18, 1, m);
  });
  return out;
}

/* --- pools and lanes --- */

const horizontal = (s: DShape): boolean => raw(s.di, 'isHorizontal') !== false;

/** The name in the 30 px header band: rotated along a horizontal frame's left edge, on top of a vertical one. */
function bandLabel(s: DShape, st: Style): string {
  const name = raw<string>(s.el, 'name');
  if (!name || !name.trim()) return '';
  const b = s.bounds;
  if (!horizontal(s)) return boxText(name, { x: b.x, y: b.y, width: b.width, height: 30 }, 'center', 'middle', 0, st.label);
  // laid out in a box as wide as the frame is high, then turned by -90 degrees around the band's centre
  const cx = b.x + 15;
  const cy = b.y + b.height / 2;
  const box = { x: cx - b.height / 2, y: cy - 15, width: b.height, height: 30 };
  return boxText(name, box, 'center', 'middle', 0, st.label, ` transform="rotate(-90 ${n(cx)} ${n(cy)})"`);
}

function poolSvg(s: DShape, st: Style): string {
  const b = s.bounds;
  let out = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.width)}" height="${n(b.height)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"/>`;
  const blackBox = !raw(s.el, 'processRef');
  if (blackBox) {
    const name = raw<string>(s.el, 'name');
    if (name && name.trim()) out += boxText(name, b, 'center', 'middle', 0, st.label);
  } else {
    out += horizontal(s)
      ? `<path d="M${n(b.x + 30)} ${n(b.y)}V${n(b.y + b.height)}" stroke="${st.stroke}" stroke-width="1.5"/>`
      : `<path d="M${n(b.x)} ${n(b.y + 30)}H${n(b.x + b.width)}" stroke="${st.stroke}" stroke-width="1.5"/>`;
    out += bandLabel(s, st);
  }
  if (raw(s.el, 'participantMultiplicity')) {
    out += at(b.x + b.width / 2 - 7, b.y + b.height - 16, 1, `<path d="M3 2V12M7 2V12M11 2V12" fill="none" stroke="${st.stroke}" stroke-width="2"/>`);
  }
  return out;
}

function laneSvg(s: DShape, st: Style): string {
  const b = s.bounds;
  const fill = st.filled ? `fill="${st.fill}" fill-opacity="0.35"` : 'fill="none"';
  return `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.width)}" height="${n(b.height)}" ${fill} stroke="${st.stroke}" stroke-width="1.5"/>` + bandLabel(s, st);
}

/* --- data and artifacts --- */

function dataSvg(s: DShape, st: Style): string {
  const b = s.bounds;
  const el = s.el;
  const ink = st.stroke;
  if (is(el, 'bpmn:DataStoreReference')) {
    const rx = b.width / 2;
    const ry = Math.min(8, b.height / 6);
    const x0 = n(b.x);
    const x1 = n(b.x + b.width);
    const top = b.y + ry;
    const bottom = b.y + b.height - ry;
    return (
      `<path d="M${x0} ${n(top)}V${n(bottom)}A${n(rx)} ${n(ry)} 0 0 0 ${x1} ${n(bottom)}V${n(top)}" fill="${st.fill}" stroke="${ink}" stroke-width="2"/>` +
      `<ellipse cx="${n(b.x + rx)}" cy="${n(top)}" rx="${n(rx)}" ry="${n(ry)}" fill="${st.fill}" stroke="${ink}" stroke-width="2"/>` +
      `<path d="M${x0} ${n(top + 5)}A${n(rx)} ${n(ry)} 0 0 0 ${x1} ${n(top + 5)}M${x0} ${n(top + 10)}A${n(rx)} ${n(ry)} 0 0 0 ${x1} ${n(top + 10)}" fill="none" stroke="${ink}" stroke-width="1.2"/>`
    );
  }
  const fold = Math.min(12, b.width / 3, b.height / 3);
  let out =
    `<path d="M${n(b.x)} ${n(b.y)}H${n(b.x + b.width - fold)}L${n(b.x + b.width)} ${n(b.y + fold)}V${n(b.y + b.height)}H${n(b.x)}Z" fill="${st.fill}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M${n(b.x + b.width - fold)} ${n(b.y)}V${n(b.y + fold)}H${n(b.x + b.width)}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
  const object = is(el, 'bpmn:DataObjectReference') ? raw<El>(el, 'dataObjectRef') : el;
  if (raw(object, 'isCollection')) out += at(b.x + b.width / 2 - 7, b.y + b.height - 15, 1, `<path d="M3 2V12M7 2V12M11 2V12" fill="none" stroke="${ink}" stroke-width="2"/>`);
  const input = is(el, 'bpmn:DataInput');
  if (input || is(el, 'bpmn:DataOutput')) {
    out += at(b.x + 4, b.y + 4, 1, `<path d="M1 4H7V1L13 6L7 11V8H1Z" fill="${input ? 'none' : ink}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`);
  }
  return out;
}

function annotationSvg(s: DShape, st: Style): string {
  const b = s.bounds;
  const value = raw<string>(s.el, 'text');
  return (
    `<path d="M${n(b.x + 10)} ${n(b.y)}H${n(b.x)}V${n(b.y + b.height)}H${n(b.x + 10)}" fill="none" stroke="${st.stroke}" stroke-width="1.5"/>` +
    (value && value.trim() ? boxText(value, b, 'left', 'top', 7, st.label) : '')
  );
}

/* ------------------------------------------------------------------ */
/* connections                                                          */
/* ------------------------------------------------------------------ */

interface Dir {
  /** the end point */
  p: Point;
  /** unit vector along the line, pointing out of the end */
  ux: number;
  uy: number;
}

/** The direction at an end of a polyline (duplicate points skipped). */
function endDir(points: readonly Point[], atStart: boolean): Dir | undefined {
  const pts = atStart ? [...points].reverse() : points;
  const p = pts[pts.length - 1]!;
  for (let i = pts.length - 2; i >= 0; i--) {
    const q = pts[i]!;
    const len = Math.hypot(p.x - q.x, p.y - q.y);
    if (len > 0.01) return { p, ux: (p.x - q.x) / len, uy: (p.y - q.y) / len };
  }
  return undefined;
}

/** An arrow head at an end: filled (sequence flow), white (message flow) or open (associations). */
function arrow(d: Dir, kind: 'filled' | 'white' | 'open', ink: string): string {
  const len = kind === 'open' ? 10 : 11;
  const half = kind === 'open' ? 5 : 4;
  const bx = d.p.x - d.ux * len;
  const by = d.p.y - d.uy * len;
  const a = `${n(bx - d.uy * half)} ${n(by + d.ux * half)}`;
  const c = `${n(bx + d.uy * half)} ${n(by - d.ux * half)}`;
  const tip = `${n(d.p.x)} ${n(d.p.y)}`;
  if (kind === 'open') return `<path d="M${a}L${tip}L${c}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  return `<path d="M${a}L${tip}L${c}Z" fill="${kind === 'filled' ? ink : FILL}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>`;
}

/** The waypoints as a path with corners rounded by up to 5 px (like bpmn-js). */
function roundedPath(points: readonly Point[]): string {
  const first = points[0]!;
  let d = `M${n(first.x)} ${n(first.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const p = points[i]!;
    const next = points[i + 1]!;
    const lin = Math.hypot(p.x - prev.x, p.y - prev.y);
    const lout = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(5, lin / 2, lout / 2);
    if (r < 0.5) {
      d += `L${n(p.x)} ${n(p.y)}`;
      continue;
    }
    d += `L${n(p.x - ((p.x - prev.x) / lin) * r)} ${n(p.y - ((p.y - prev.y) / lin) * r)}Q${n(p.x)} ${n(p.y)} ${n(p.x + ((next.x - p.x) / lout) * r)} ${n(p.y + ((next.y - p.y) / lout) * r)}`;
  }
  const last = points[points.length - 1]!;
  return `${d}L${n(last.x)} ${n(last.y)}`;
}

function edgeSvg(e: DEdge, st: Style): string {
  const ink = st.stroke;
  const d = roundedPath(e.points);
  const end = endDir(e.points, false);
  const start = endDir(e.points, true);
  const path = (extra: string): string => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"${extra}/>`;
  if (e.kind === 'sequenceFlow') {
    let out = path('');
    if (end) out += arrow(end, 'filled', ink);
    const source = raw<El>(e.el, 'sourceRef');
    if (start && source && raw(source, 'default') === e.el) {
      // the default slash, 10 px from the source, at 45 degrees to the line
      const cx = start.p.x - start.ux * 10;
      const cy = start.p.y - start.uy * 10;
      const vx = (-start.ux - start.uy) * 4.5;
      const vy = (-start.uy + start.ux) * 4.5;
      out += `<path d="M${n(cx - vx)} ${n(cy - vy)}L${n(cx + vx)} ${n(cy + vy)}" stroke="${ink}" stroke-width="1.5"/>`;
    } else if (start && source && raw(e.el, 'conditionExpression') && is(source, 'bpmn:Activity')) {
      // the conditional diamond at the source
      const ux = -start.ux;
      const uy = -start.uy;
      const p = start.p;
      const pt = (k: number, side: number): string => `${n(p.x + ux * k - uy * side)} ${n(p.y + uy * k + ux * side)}`;
      out += `<path d="M${pt(0, 0)}L${pt(8, 5)}L${pt(16, 0)}L${pt(8, -5)}Z" fill="${FILL}" stroke="${ink}" stroke-width="1.2"/>`;
    }
    return out;
  }
  if (e.kind === 'messageFlow') {
    let out = path(' stroke-dasharray="10 6"');
    if (start) out += `<circle cx="${n(start.p.x)}" cy="${n(start.p.y)}" r="4" fill="${FILL}" stroke="${ink}" stroke-width="1.2"/>`;
    if (end) out += arrow(end, 'white', ink);
    return out;
  }
  const dotted = path(' stroke-dasharray="0.5 4.5" stroke-linecap="round"');
  if (e.kind === 'dataAssociation') return dotted + (end ? arrow(end, 'open', ink) : '');
  if (e.kind === 'association') {
    const direction = raw<string>(e.el, 'associationDirection');
    let out = dotted;
    if (end && (direction === 'One' || direction === 'Both')) out += arrow(end, 'open', ink);
    if (start && direction === 'Both') out += arrow(start, 'open', ink);
    return out;
  }
  return path('');
}

