/**
 * The drawing as an image: one diagram plane (its DI) drawn as SVG without a
 * browser, close to how bpmn-js draws it (not pixel-identical), so an agent
 * can look at what it changed (`bpmn render`; the node layer rasterises the
 * SVG to PNG, src/node/render.ts).
 *
 * CONTRACT
 *  - renderSvg(xml, opts) parses the document (E_PARSE) and draws one plane:
 *    `plane` names the element the plane shows (a collapsed sub-process, the
 *    process or the collaboration); default the first BPMNDiagram, or with a
 *    crop or `focus` the plane of its first element. An unknown id is
 *    E_NOT_FOUND, an element without a plane of its own E_WRONG_KIND; both
 *    list the planes as candidates. A document without any diagram is laid
 *    out in memory first (the clean engine; nothing is written) and a note
 *    says so; its `problems` are still the file's (what `bpmn metrics`
 *    reports for it: its elements are `missing`), none with a badge.
 *  - Broken geometry: a shape or connection with a coordinate that is not a
 *    finite number within ±COORD_LIMIT (1,000,000 px), or a negative size,
 *    is not drawn, nor are such label bounds; a note names them. A plane
 *    on which everything is broken is E_RENDER.
 *  - renderDocSvg(doc, opts) draws a parsed document (no layout).
 *  - The image: the drawn elements' bounding box (shapes, waypoints, the
 *    labels as drawn) plus a 20 px margin, on white. `scale` (default 1)
 *    zooms; with `maxSize` the long edge is capped at that many px (the
 *    scale shrinks). width / height are the image size in px, `tokens` the
 *    image-token estimate width * height / 784.
 *  - Crops (at most one of them, E_USAGE otherwise; elements by id only):
 *      around {id, depth, inner}  exactly the flow nodes of `show --around`
 *                                 (query/context.ts aroundView; a sequence flow:
 *                                 both its ends)
 *      path {from, to, via}       the nodes and flows of the shortest
 *                                 sequence-flow path (query/select.ts pathOf, the
 *                                 --path selector)
 *      scope                      a pool, lane or expanded sub-process and
 *                                 every shape whose centre lies inside it; a
 *                                 collapsed sub-process: its own plane; a
 *                                 process: its pool, else its plane
 *      ids                        exactly these elements
 *    A crop draws its elements in full (`<g data-id>`) with the connections
 *    between them, and for around / path the data and annotations attached
 *    to them; a connection to an element left out is drawn faded, with its
 *    label (`<g data-faded>`; the view fits only its first 40 px from the
 *    drawn end), so a crossing or label clash with it stays visible; the
 *    pools, lanes, groups and the
 *    expanded sub-processes around drawn elements are context (`<g
 *    data-context>`), clipped by the view. The view is the crop's content
 *    plus the margin. Elements of the crop on other planes are named in a
 *    note; a crop with nothing drawn on the plane is E_NO_MATCH (a scope
 *    that is a plane: an empty plane). `nodes` of the result: the crop's
 *    flow nodes drawn, in its order (around: the order of show --around; a
 *    scope that is a plane: its flow nodes).
 *  - focus (what `--render` of a mutating command uses): the plane of the
 *    first focus element that is drawn; when the whole plane would be drawn
 *    below MIN_LABEL_SCALE, the image shows only the region around them
 *    (their boxes and the shapes next to them, plus 40 px; everything in
 *    it) and a note says so.
 *  - highlight: a halo around each element (under it; labels get a tint): a
 *    list (orange; an unknown id is E_NOT_FOUND, one not in the image (not
 *    on the plane, outside the crop) is named in a note) or {created: green, changed: orange, moved: blue,
 *    lighter} (created wins over changed, changed over moved; ids that are
 *    not drawn are skipped; a pool, lane or expanded sub-process that only
 *    moved or grew gets none).
 *  - problems: `true` lists every problem of layoutProblems (with a crop:
 *    those naming an element drawn in full) in metrics order with the same
 *    ids, a list exactly these problems (matched by problemKey) in its order;
 *    each numbered 1.. in that order. A problem whose location
 *    (diagram/metrics.ts locateProblems) is on this plane and in the image gets a
 *    numbered badge there (`drawn`); a badge that would cover an earlier one
 *    moves aside within the bounding box of the problem's elements.
 *  - tiles: when the image would draw its labels below MIN_LABEL_SCALE, it is
 *    split into tiles at `scale` (default 1) within maxSize: cut between the
 *    plane's columns (query/layout-view.ts planeColumns, `show --layout`'s c<n>) and,
 *    when too tall, between rows of shapes. Only tiles holding a shape, a
 *    label (or a frame's name) or a numbered problem are kept: stretches of
 *    half a tile and more with nothing but empty space or connections
 *    passing through are left out (a note says so). `tiles` lists them left
 *    to right, band by band (bands numbered 1.. among the kept ones; svg /
 *    width / height / tokens of the result are the first tile's); each
 *    problem's badge is in one tile (`tile`). More than MAX_TILES (40)
 *    tiles: one image instead, with a note (render a part). When the image
 *    is readable, it stays one image and a note says so.
 *  - The result lists the plane drawn (`plane`, its element id), the other
 *    planes (`planes`: collapsed sub-processes and other diagrams, document
 *    order) and `notes`: labels drawn below MIN_LABEL_SCALE (hard to read;
 *    names the crop options), elements of the plane without a shape or with
 *    broken geometry, the in-memory layout, crop elements on other planes,
 *    the focus region, the tiles. A scale in a note has two decimals,
 *    rounded down (scaleText: 0.7458 is 0.74, below 0.75).
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
 *    associations, a message flow's message (messageRef: an envelope
 *    halfway along it, outlined, filled when the DI says
 *    messageVisibleKind="non_initiating"; its name in 12 px wrapped at 150
 *    px, its left edge at the middle, 10 px below it: where bpmn-js 18 puts
 *    it when it opens a file),
 *    bpmn-js colours (color:background-color / bioc:fill,
 *    color:border-color / bioc:stroke, color:color of the label). Anything
 *    else with a shape is a plain box.
 *  - Labels like bpmn-js 18: external labels (events, gateways, data, flows,
 *    groups) centred on the DI label bounds with their top at its y, in 11
 *    px Arial (diagram/utils/text.ts wrapLines), 13.2 px a line, laid out twice like
 *    bpmn-js: wrapped at max(90, the label bounds' width), then again at the
 *    width of the widest line of that (rounded up), which may break it
 *    differently; without label bounds (90 px) below the shape (a group: at
 *    its top), a flow's at the middle of its middle segment, 15 px above it
 *    (right of a vertical one).
 *    Embedded labels: 12 px, padding 7, centred in tasks and collapsed
 *    sub-processes, at the top of expanded ones (their title, diagram/utils/text.ts
 *    titleBox), left-top in annotations; pool and lane names in their 30 px
 *    header band.
 *  - Off-viewport culling: shapes, connections and labels outside the view
 *    are left out of the SVG (a rasteriser never sees content far outside
 *    the image).
 *  - The glyphs are drawn here from the BPMN notation (no bpmn-js code or
 *    paths). Text uses Arial (Arimo, metric-compatible, is what the PNG
 *    rasteriser bundles).
 *  - Browser-safe and free of side effects at import (tree-shaken out of a
 *    host that does not render).
 */
import { aroundView } from '../query/context.js';
import { Doc } from '../model/document.js';
import { ioError, modelError, usageError } from '../shared/utils/errors.js';
import { layoutModel } from '../layout/index.js';
import { groupName, is, type El } from '../model/utils/moddle.js';
import type { MutationReport } from '../report/command-report.js';
import type { Box, Point } from '../diagram/utils/geom.js';
import { layoutProblems, locateProblems, problemKey, type LayoutProblem, type MetricKey } from '../diagram/metrics.js';
import { homePlane, readPlanes, semantics } from '../diagram/plane.js';
import { raw, rawList } from '../diagram/utils/plane.js';
import type { DEdge, DShape, Plane, Semantics } from '../diagram/types.js';
import { pathOf } from '../query/select.js';
import { textWidth, titleBox, wrapLines } from '../diagram/utils/text.js';
import { planeColumns } from '../query/layout-view.js';

/** What a halo marks: the CLI's `--render` colours created, changed and moved elements apart. */
export interface RenderHighlight {
  /** elements the change created: green */
  created?: string[];
  /** elements whose model (or colour) changed: orange */
  changed?: string[];
  /** elements the layout placed, moved or rerouted: blue */
  moved?: string[];
}

/** Options of renderSvg / renderDocSvg / renderPng (see the module contract). */
export interface RenderOptions {
  /** the element whose plane to draw: a collapsed sub-process, the process or the collaboration (default: the first diagram, or the crop's) */
  plane?: string;
  /** zoom factor of the image (default 1) */
  scale?: number;
  /** longest edge of the image in px: a larger image is scaled down to it (default: no limit; renderPng: RENDER_MAX_SIZE) */
  maxSize?: number;
  /** crop: exactly the flow nodes of `show --around <id> --depth <n> [--inner]` */
  around?: { id: string; depth?: number; inner?: boolean };
  /** crop: the nodes and flows of the shortest sequence-flow path (`--path <from> <to> [--via <flow...>]`) */
  path?: { from: string; to: string; via?: string[] };
  /** crop: a pool, lane or sub-process with what is drawn inside it */
  scope?: string;
  /** crop: exactly these elements */
  ids?: string[];
  /** keep these readable: their plane, and only the region around them when the whole plane would be drawn below MIN_LABEL_SCALE */
  focus?: string[];
  /** a halo around these elements (a list: one colour) */
  highlight?: string[] | RenderHighlight;
  /** numbered badges: true = every layout problem (`bpmn metrics`), or exactly these problems */
  problems?: boolean | readonly LayoutProblem[];
  /** split an image that would be unreadable into tiles at the diagram's columns */
  tiles?: boolean;
}

/** A layout problem as listed by a render: numbered like its badge. */
export interface RenderProblem {
  /** the number of its badge (1..) */
  n: number;
  kind: MetricKey;
  ids: string[];
  detail?: string;
  /** its badge is in the image (false: on another plane, outside the crop, or nowhere to draw: missing, failed) */
  drawn: boolean;
  /** with tiles: the tile (1..) its badge is in */
  tile?: number;
}

/** One image of a render split into tiles. */
export interface RenderTile {
  svg: string;
  width: number;
  height: number;
  tokens: number;
  /** the plane's columns the tile spans (`show --layout` c<first>..c<last>); absent when it holds no flow node */
  columns?: [number, number];
  /** the band (1..) when the drawing is also split top to bottom */
  band?: number;
}

export interface RenderResult {
  /** the SVG document (with tiles: the first tile) */
  svg: string;
  /** image size in px (after scale / maxSize; with tiles: the first tile's) */
  width: number;
  height: number;
  /** the zoom factor used (below `scale` when maxSize capped it) */
  scale: number;
  /** image-token estimate of the image: width * height / 784, rounded (with tiles: the first tile's) */
  tokens: number;
  /** the element whose plane was drawn */
  plane: string;
  /** the other planes (their element ids, document order): what `plane` can name */
  planes: string[];
  /** labels below MIN_LABEL_SCALE, elements without a shape, an in-memory layout, crop elements on other planes, the focus region, tiles */
  notes: string[];
  /** with `problems`: the problems listed, numbered like their badges */
  problems: RenderProblem[];
  /** with a crop: its flow nodes drawn (around: exactly show --around's nodes on this plane) */
  nodes?: string[];
  /** with `tiles`, when the image needed them: every tile */
  tiles?: RenderTile[];
}

/** The long edge `bpmn render` and renderPng cap an image at by default (what Claude Code displays). */
export const RENDER_MAX_SIZE = 2000;
/** Below this scale the 11-12 px labels drop under ~8 px and are hard to read: the result says so. */
export const MIN_LABEL_SCALE = 0.75;
/** The halo colours: a plain highlight list uses `changed`. */
export const HALO_COLORS = { created: '#2f9e44', changed: '#f76707', moved: '#1c7ed6' } as const;
/** --tiles makes at most this many tiles: a drawing that needs more stays one image, with a note (render a part instead). */
export const MAX_TILES = 40;
/** Coordinates beyond ±COORD_LIMIT px (or not a number) are broken DI: such a shape, connection or label is not drawn, a note names it. */
export const COORD_LIMIT = 1_000_000;

const MARGIN = 20;
/** the margin of the region drawn around focus elements and their neighbours */
const FOCUS_MARGIN = 40;
/** a crop's connection to an element it leaves out: drawn faded, the view fits its first STUB px */
const STUB = 40;
const FADED = 0.4;
const STROKE = '#22242a';
const FILL = '#ffffff';
const BADGE = '#e03131';
/** badge radius in image px (a badge keeps its size when the drawing is scaled) */
const BADGE_R = 9;
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
  let doc = await Doc.fromXml(xml);
  if (readPlanes(doc.definitions).length) return renderDocSvg(doc, opts);
  // nothing drawn: draw it in memory (layoutModel replaces the DI; its XML is the truth); the problems stay the file's
  const fileProblems = opts.problems ? layoutProblems(doc.definitions).problems : [];
  const { xml: drawn } = await layoutModel(doc.model);
  doc = await Doc.fromXml(drawn);
  const result = drawDoc(doc, opts, fileProblems);
  const notes = ['the file has no diagram: it is drawn by the layout engine in memory (nothing is written; `bpmn layout <file>` saves a drawing)'];
  if (opts.problems) notes.push("the problems are the file's (`bpmn metrics <file>`), not the in-memory drawing's: none is in the image");
  return { ...result, notes: [...notes, ...result.notes] };
}

/** One plane of a parsed document as SVG (no layout; see the module contract). */
export function renderDocSvg(doc: Doc, opts: RenderOptions = {}): RenderResult {
  return drawDoc(doc, opts);
}

/** renderDocSvg; `fileProblems`: the layout problems of a file drawn in memory (listed instead of the drawing's). */
function drawDoc(doc: Doc, opts: RenderOptions, fileProblems?: LayoutProblem[]): RenderResult {
  const defs = doc.definitions;
  const sem = semantics(defs);
  const read = readPlanes(defs, sem);
  const checked = read.map(saneOf);
  const planes = checked.map((c) => c.plane);
  const want = cropOf(doc, sem, planes, opts);
  const plane = pickPlane(planes, sem, opts.plane ?? want.plane ?? focusPlane(planes, opts.focus));
  const others = planes.filter((p) => p !== plane).map((p) => p.rootId);
  const highlight = halosOf(doc, opts.highlight);
  if (!plane) return compose({ items: [] }, { plane: 'none', planes: others, notes: ['the document has no diagram plane'] }, opts);
  const notes: string[] = [];
  const index = planes.indexOf(plane);
  const unchecked = read[index]!;
  const undrawn = undrawnOn(read, unchecked, sem);
  if (undrawn.length) notes.push(`${undrawn.length} element${undrawn.length > 1 ? 's have' : ' has'} no shape and ${undrawn.length > 1 ? 'are' : 'is'} not drawn: ${idList(undrawn)} (\`bpmn layout <file>\` draws ${undrawn.length > 1 ? 'them' : 'it'})`);
  const { broken, labels } = checked[index]!;
  if (broken.length) notes.push(`${broken.length} element${broken.length > 1 ? 's have' : ' has'} broken coordinates (not a number, beyond ±${thousands(COORD_LIMIT)} px, or a negative size) and ${broken.length > 1 ? 'are' : 'is'} not drawn: ${idList(broken)} (\`bpmn layout <file>\` draws ${broken.length > 1 ? 'them' : 'it'} again)`);
  if (labels.length) notes.push(`${labels.length} label${labels.length > 1 ? 's have' : ' has'} broken bounds and ${labels.length > 1 ? 'are' : 'is'} not drawn: ${idList(labels)} (\`bpmn label <file> <id> --side below\` places ${labels.length > 1 ? 'each' : 'it'} again)`);
  if (!plane.shapes.size && !plane.edges.size) {
    if (unchecked.shapes.size || unchecked.edges.size) {
      throw ioError('E_RENDER', `Nothing on the plane of ${plane.rootId} can be drawn: every shape and connection has broken coordinates`, {
        element: plane.rootId,
        hint: `Broken: ${idList(broken)}. \`bpmn show <file> --layout\` lists the drawing; \`bpmn layout <file>\` draws it again.`,
      });
    }
    if (want.scope) throw modelError('E_NO_MATCH', `Nothing of --scope ${want.scope} is drawn: the plane of ${plane.rootId} is empty`, { element: want.scope, hint: '`bpmn layout <file>` draws the elements without a shape; `bpmn render <file>` lists the planes.' });
    notes.push(`the plane of ${plane.rootId} is empty`);
  }
  const drawn = want.crop ? drawnOf(plane, planes, want.crop, notes) : undefined;
  const scene = drawPlane(plane, drawn, highlight);
  if (Array.isArray(opts.highlight)) {
    // drawn in full or as context (a crop leaves the rest out)
    const inImage = new Set(scene.items.filter((i) => i.id !== undefined && /^<g data-(id|context)=/.test(i.svg)).map((i) => i.id!));
    const missing = opts.highlight.filter((id) => !inImage.has(id));
    if (missing.length) notes.push(`highlighted but not in the image (${drawn ? 'outside the crop or ' : ''}not drawn on this plane): ${missing.join(', ')}`);
  }
  // a crop's flow nodes drawn (a scope: those inside it, in drawing order; a scope that is a plane: its flow nodes)
  const nodes = want.crop?.frame
    ? [...plane.shapes.values()].filter((s) => s.id !== want.crop!.frame && drawn!.has(s.id) && is(s.el, 'bpmn:FlowNode')).map((s) => s.id)
    : want.crop
      ? want.crop.nodes.filter((id) => drawn!.has(id))
      : want.scope
        ? [...plane.shapes.values()].filter((s) => is(s.el, 'bpmn:FlowNode')).map((s) => s.id)
        : undefined;
  return compose(scene, { plane: plane.rootId, planes: others, notes, located: plane, defs, ...(fileProblems ? { fileProblems } : {}), ...(drawn ? { drawn } : {}), ...(nodes ? { nodes } : {}) }, opts);
}

/** At most five ids, then how many more. */
const idList = (ids: string[]): string => ids.slice(0, 5).join(', ') + (ids.length > 5 ? `, ... (${ids.length - 5} more)` : '');

/** Thousands with commas (1,000,000). */
const thousands = (v: number): string => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A coordinate the renderer draws: a finite number within ±COORD_LIMIT. */
const saneNumber = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_LIMIT;

const saneBox = (b: Box): boolean => [b.x, b.y, b.width, b.height, b.x + b.width, b.y + b.height].every(saneNumber) && b.width >= 0 && b.height >= 0;

/**
 * The plane without broken geometry (see contract): shapes and connections
 * with a coordinate that is not a finite number within ±COORD_LIMIT (or a
 * negative size) are left out, broken label bounds dropped; the plane itself
 * when nothing is broken, else a copy.
 */
function saneOf(plane: Plane): { plane: Plane; broken: string[]; labels: string[] } {
  const broken: string[] = [];
  const labels: string[] = [];
  const shapes = new Map<string, DShape>();
  for (const [id, s] of plane.shapes) {
    if (!saneBox(s.bounds)) broken.push(id);
    else if (s.label && !saneBox(s.label)) {
      labels.push(id);
      const copy = { ...s };
      delete copy.label;
      shapes.set(id, copy);
    } else shapes.set(id, s);
  }
  const edges = new Map<string, DEdge>();
  for (const [id, e] of plane.edges) {
    if (!e.points.every((p) => saneNumber(p.x) && saneNumber(p.y))) broken.push(id);
    else if (e.label && !saneBox(e.label)) {
      labels.push(id);
      const copy = { ...e };
      delete copy.label;
      edges.set(id, copy);
    } else edges.set(id, e);
  }
  if (!broken.length && !labels.length) return { plane, broken, labels };
  return { plane: { ...plane, shapes, edges }, broken, labels };
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

/** The plane a shape or connection is drawn on. */
const planeOfId = (planes: Plane[], id: string): Plane | undefined => planes.find((p) => p.shapes.has(id) || p.edges.has(id));

/** The plane of the first focus element that is drawn. */
function focusPlane(planes: Plane[], focus: string[] | undefined): string | undefined {
  for (const id of focus ?? []) {
    const p = planeOfId(planes, id);
    if (p) return p.rootId;
  }
  return undefined;
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
/* crops                                                                */
/* ------------------------------------------------------------------ */

interface Crop {
  /** the elements (shapes and connections), in the crop's order */
  ids: string[];
  /** the flow nodes among them (around: show --around's order) */
  nodes: string[];
  /** scope: the frame whose content is drawn */
  frame?: string;
  /** draw the data and annotations attached to the elements */
  artifacts: boolean;
}

/** The crop the options ask for, and the plane it implies (a scope on a collapsed sub-process / a process without pool: that plane, `scope` names it). */
function cropOf(doc: Doc, sem: Semantics, planes: Plane[], opts: RenderOptions): { crop?: Crop; plane?: string; scope?: string } {
  const asked = (['around', 'path', 'scope', 'ids'] as const).filter((k) => (k === 'ids' ? !!opts.ids?.length : opts[k] !== undefined));
  if (asked.length > 1) {
    throw usageError(`${asked.map((k) => (k === 'ids' ? 'element ids' : `--${k}`)).join(' and ')} crop the image in different ways; use one`, { hint: 'Render one part per call: `bpmn render <file> --around <id>`, `--path <from> <to>`, `--scope <id>` or ids.' });
  }
  if (asked.length && opts.focus?.length) throw usageError('focus does not go with a crop', { hint: 'Use one: a crop (around, path, scope, ids) or focus.' });
  const kind = asked[0];
  if (!kind) return {};
  const first = (ids: string[]): string | undefined => ids.find((id) => planeOfId(planes, id));
  let crop: Crop;
  if (kind === 'around') {
    const view = aroundView(doc, opts.around!.id, { ...(opts.around!.depth !== undefined ? { depth: opts.around!.depth } : {}), inner: !!opts.around!.inner });
    const nodes = view.nodes.map((n) => n.id);
    crop = { ids: nodes, nodes, artifacts: true };
    const seed = planeOfId(planes, opts.around!.id) ? opts.around!.id : first(nodes);
    return { crop, ...planeHint(planes, seed, nodes, `--around ${opts.around!.id}`) };
  }
  if (kind === 'path') {
    const els = pathOf(doc, opts.path!.from, opts.path!.to, opts.path!.via ?? []);
    const ids = els.map((el) => el.get<string>('id'));
    crop = { ids, nodes: els.filter((el) => is(el, 'bpmn:FlowNode')).map((el) => el.get<string>('id')), artifacts: true };
    return { crop, ...planeHint(planes, first(ids), ids, `--path ${opts.path!.from} ${opts.path!.to}`) };
  }
  if (kind === 'ids') {
    const ids = opts.ids!.filter((id, i) => opts.ids!.indexOf(id) === i);
    for (const id of ids) doc.require(id);
    const isNode = (id: string): boolean => {
      const el = sem.byId.get(id);
      return !!el && is(el, 'bpmn:FlowNode');
    };
    crop = { ids, nodes: ids.filter(isNode), artifacts: false };
    return { crop, ...planeHint(planes, first(ids), ids, ids.join(', ')) };
  }
  // scope
  const id = opts.scope!;
  const el = doc.require(id);
  const expandedOn = planes.find((p) => p.shapes.get(id)?.container);
  const frameCrop = (frame: string): { crop: Crop; plane?: string } => ({ crop: { ids: [frame], nodes: [], frame, artifacts: false }, ...planeHint(planes, frame, [frame], `--scope ${id}`) });
  if (is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane')) return frameCrop(id);
  if (is(el, 'bpmn:SubProcess')) {
    if (expandedOn) return frameCrop(id);
    if (planes.some((p) => p.rootId === id)) return { plane: id, scope: id };
    throw modelError('E_NO_MATCH', `${id} is not drawn (no shape, no plane of its own)`, { element: id, hint: '`bpmn layout <file>` draws it; `bpmn render <file>` lists the planes.' });
  }
  if (is(el, 'bpmn:Process')) {
    const pool = sem.poolOfProcess.get(id);
    if (pool && planeOfId(planes, pool)) return frameCrop(pool);
    if (planes.some((p) => p.rootId === id)) return { plane: id, scope: id };
  }
  throw modelError('E_WRONG_KIND', `--scope takes a pool, lane, sub-process or process; "${id}" is a ${el.$type.replace(/^bpmn:/, '')}`, {
    element: id,
    hint: 'Use --around <id> for the neighbourhood of a node, or ids to crop to elements.',
  });
}

/** The plane of the crop's seed (else of any of its elements); E_NO_MATCH when none of it is drawn. */
function planeHint(planes: Plane[], seed: string | undefined, ids: string[], what: string): { plane?: string } {
  const p = seed ? planeOfId(planes, seed) : undefined;
  if (p) return { plane: p.rootId };
  throw modelError('E_NO_MATCH', `Nothing of ${what} is drawn (no shape on any plane)`, {
    ...(ids[0] ? { element: ids[0] } : {}),
    hint: '`bpmn layout <file>` draws the elements without a shape; `bpmn show <file> --layout` lists what is drawn.',
  });
}

/** The ids drawn in full on `plane` for a crop; elements on other planes go into a note, nothing on the plane is E_NO_MATCH. */
function drawnOf(plane: Plane, planes: Plane[], crop: Crop, notes: string[]): Set<string> {
  const drawn = new Set<string>();
  if (crop.frame) {
    const f = plane.shapes.get(crop.frame);
    if (!f) throw modelError('E_NO_MATCH', `${crop.frame} is not drawn on the plane of ${plane.rootId}`, { element: crop.frame, hint: 'Drop --plane, or name the plane the scope is drawn on.' });
    drawn.add(f.id);
    const b = f.bounds;
    for (const s of plane.shapes.values()) {
      const x = s.bounds.x + s.bounds.width / 2;
      const y = s.bounds.y + s.bounds.height / 2;
      if (s !== f && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) drawn.add(s.id);
    }
  } else {
    const elsewhere = new Map<string, number>();
    for (const id of crop.ids) {
      if (plane.shapes.has(id) || plane.edges.has(id)) drawn.add(id);
      else {
        const other = planeOfId(planes, id);
        if (other) elsewhere.set(other.rootId, (elsewhere.get(other.rootId) ?? 0) + 1);
      }
    }
    if (!drawn.size) {
      throw modelError('E_NO_MATCH', `Nothing of the crop is drawn on the plane of ${plane.rootId}`, {
        hint: `${[...elsewhere.keys()].length ? `It is on the plane of ${[...elsewhere.keys()].join(', ')} (--plane <id>).` : 'It has no shape: `bpmn layout <file>` draws it.'}`,
      });
    }
    for (const [p, count] of elsewhere) notes.push(`${count} element${count > 1 ? 's' : ''} of the crop ${count > 1 ? 'are' : 'is'} on the plane of ${p} (--plane ${p})`);
    if (crop.artifacts) {
      for (const e of plane.edges.values()) {
        if (e.kind !== 'association' && e.kind !== 'dataAssociation') continue;
        for (const [here, there] of [
          [e.sourceId, e.targetId],
          [e.targetId, e.sourceId],
        ]) {
          const s = there ? plane.shapes.get(there) : undefined;
          if (here && drawn.has(here) && s && (s.kind === 'data' || s.kind === 'annotation')) drawn.add(s.id);
        }
      }
    }
  }
  // connections between drawn shapes
  for (const e of plane.edges.values()) if (e.sourceId && e.targetId && drawn.has(e.sourceId) && drawn.has(e.targetId)) drawn.add(e.id);
  return drawn;
}

/* ------------------------------------------------------------------ */
/* halos                                                                */
/* ------------------------------------------------------------------ */

/** The halo colour of each highlighted element (see contract); a list's unknown ids are E_NOT_FOUND. */
function halosOf(doc: Doc, h: RenderOptions['highlight']): (id: string) => string | undefined {
  const colors = new Map<string, string>();
  if (Array.isArray(h)) {
    for (const id of h) {
      doc.require(id);
      colors.set(id, HALO_COLORS.changed);
    }
  } else if (h) {
    for (const k of ['created', 'changed', 'moved'] as const) for (const id of h[k] ?? []) if (!colors.has(id)) colors.set(id, HALO_COLORS[k]);
  }
  return (id) => colors.get(id);
}

/**
 * What a mutation touched, as halos (`--render` of a mutating command):
 * created, changed (the model or a colour) and moved (placed, moved,
 * rerouted, reshaped, a label placed) elements; each id in its first
 * category only.
 */
export function changeHighlight(report: Pick<MutationReport, 'created' | 'changed' | 'layout'>): Required<RenderHighlight> {
  const created = unique(report.created.map((c) => c.id));
  const format = report.layout.format ?? [];
  const changed = unique([...report.changed.map((c) => c.id), ...format.flatMap((f) => f.colored ?? [])]).filter((id) => !created.includes(id));
  const l = report.layout;
  const moved = unique([...(l.placed ?? []), ...(l.moved ?? []), ...(l.rerouted ?? []), ...(l.reshaped ?? []), ...format.flatMap((f) => [...f.moved, ...f.rerouted, ...(f.reshaped ?? []), ...(f.labels ?? [])])]).filter(
    (id) => !created.includes(id) && !changed.includes(id),
  );
  return { created, changed, moved };
}

const unique = (ids: string[]): string[] => ids.filter((id, i) => ids.indexOf(id) === i);

/* ------------------------------------------------------------------ */
/* the scene: drawable items with their boxes, then the view            */
/* ------------------------------------------------------------------ */

interface Item {
  /** what it covers (culling and the view) */
  box: Box;
  /** paint order: lower first */
  layer: number;
  svg: string;
  /** the element it draws (shapes, connections, labels, halos) */
  id?: string;
  /** context (a crop's frames) and overlays: drawn when in view, but the view is not made to fit them */
  extra?: boolean;
  /** what the view fits instead of `box` (a faded connection: its first 40 px) */
  fit?: Box;
  /** a badge: only in this tile */
  tile?: number;
  /** what makes a tile worth keeping: a shape's box, a label's, a frame's name; absent for connections, context and overlays */
  content?: Box;
}

interface Scene {
  items: Item[];
}

/* layers: frames from outside in, then leaves, groups, boundary events, connections, labels, badges */
const LAYER = { participant: 0, lane: 1, subProcess: 2, leaf: 3, group: 4, boundary: 5, edge: 6, label: 7, badge: 8 } as const;

/**
 * The items of a plane. `drawn` (a crop): the ids drawn in full; frames and
 * groups around them are context, connections with one drawn end stubs, the
 * rest is left out.
 */
function drawPlane(plane: Plane, drawn: Set<string> | undefined, halo: (id: string) => string | undefined): Scene {
  const items: Item[] = [];
  // a crop's context: the expanded sub-processes around drawn shapes
  const around = new Set<string>();
  if (drawn) {
    for (const id of drawn) {
      let s = plane.shapes.get(id);
      for (let i = 0; s && i < 50; i++) {
        const up = s.parentId ?? (s.hostId ? plane.shapes.get(s.hostId)?.parentId : undefined);
        if (!up) break;
        around.add(up);
        s = plane.shapes.get(up);
      }
    }
  }
  for (const s of plane.shapes.values()) {
    const full = !drawn || drawn.has(s.id);
    const context = !full && (s.kind === 'participant' || s.kind === 'lane' || s.kind === 'group' || around.has(s.id));
    if (!full && !context) continue;
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
    // a frame that only moved or grew gets no halo (its content says what moved)
    const color = s.container && halo(s.id) === HALO_COLORS.moved ? undefined : halo(s.id);
    if (color) items.push({ box: grow(s.bounds, 9), layer, svg: shapeHalo(s, color), id: s.id, extra: true });
    const content = !full ? undefined : s.container || s.kind === 'group' ? frameNameBox(s) : s.bounds;
    items.push({ box: s.bounds, layer, svg: `<g ${full ? 'data-id' : 'data-context'}="${attr(s.id)}">${shapeSvg(s, style)}</g>`, id: s.id, ...(full ? {} : { extra: true }), ...(content ? { content } : {}) });
    if (label) {
      if (color) items.push(labelTint(label, color, s.id));
      items.push({ ...label, id: s.id, ...(full ? { content: label.box } : { extra: true }) });
    }
  }
  for (const e of plane.edges.values()) {
    if (e.points.length < 2) continue;
    const style = stylesOf(e.di);
    if (drawn && !drawn.has(e.id)) {
      const from = !!e.sourceId && drawn.has(e.sourceId);
      const to = !!e.targetId && drawn.has(e.targetId);
      if (from === to) continue;
      // faded: the connection goes on to something the crop leaves out (the view fits its first 40 px)
      const stub = from ? cut(e.points, STUB) : cut([...e.points].reverse(), STUB).reverse();
      items.push({ box: edgeBox(e), fit: pointsBox(stub), layer: LAYER.edge, svg: `<g data-faded="${attr(e.id)}" opacity="${FADED}">${edgeSvg(e, style)}</g>`, id: e.id });
      for (const label of [edgeLabel(e, style), messageLabel(e, style)]) if (label) items.push({ ...label, svg: `<g opacity="${FADED}">${label.svg}</g>`, id: e.id, extra: true });
      continue;
    }
    const color = halo(e.id);
    if (color) {
      const light = color === HALO_COLORS.moved;
      items.push({ box: grow(pointsBox(e.points), 5), layer: LAYER.edge, svg: `<path d="${roundedPath(e.points)}" fill="none" stroke="${color}" stroke-opacity="${light ? 0.3 : 0.45}" stroke-width="${light ? 7 : 9}" stroke-linejoin="round" stroke-linecap="round"/>`, id: e.id, extra: true });
    }
    items.push({ box: edgeBox(e), layer: LAYER.edge, svg: `<g data-id="${attr(e.id)}">${edgeSvg(e, style)}</g>`, id: e.id });
    const label = edgeLabel(e, style);
    if (label) {
      if (color) items.push(labelTint(label, color, e.id));
      items.push({ ...label, id: e.id, content: label.box });
    }
    const message = messageLabel(e, style);
    if (message) items.push({ ...message, id: e.id, content: message.box });
  }
  return { items };
}

/** Nesting depth along a parent link (lanes: parent lane; sub-processes: parent sub-process). */
function depth(plane: Plane, s: DShape, parent: (s: DShape) => string | undefined): number {
  let d = 0;
  for (let p = parent(s); p && d < 50; d++) p = plane.shapes.get(p) ? parent(plane.shapes.get(p)!) : undefined;
  return d;
}

/** The first `length` px of a polyline. */
function cut(points: readonly Point[], length: number): Point[] {
  const out: Point[] = [points[0]!];
  let rest = length;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d >= rest && d > 0) {
      out.push({ x: a.x + ((b.x - a.x) * rest) / d, y: a.y + ((b.y - a.y) * rest) / d });
      return out;
    }
    out.push(b);
    rest -= d;
  }
  return out;
}

const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by });

/** A halo under a shape: its outline 6 px out, thick and translucent. */
function shapeHalo(s: DShape, color: string): string {
  const b = s.bounds;
  // moved elements: lighter than created / changed ones
  const paint = `fill="none" stroke="${color}" stroke-opacity="${color === HALO_COLORS.moved ? 0.4 : 0.55}" stroke-width="${color === HALO_COLORS.moved ? 4 : 6}"`;
  if (s.kind === 'event' || s.kind === 'boundary') return `<circle cx="${n(b.x + b.width / 2)}" cy="${n(b.y + b.height / 2)}" r="${n(Math.min(b.width, b.height) / 2 + 6)}" ${paint}/>`;
  if (s.kind === 'gateway') {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const k = 8.5;
    return `<path d="M${n(cx)} ${n(b.y - k)}L${n(b.x + b.width + k)} ${n(cy)}L${n(cx)} ${n(b.y + b.height + k)}L${n(b.x - k)} ${n(cy)}Z" ${paint} stroke-linejoin="round"/>`;
  }
  const g = grow(b, 6);
  return `<rect x="${n(g.x)}" y="${n(g.y)}" width="${n(g.width)}" height="${n(g.height)}" rx="12" ${paint}/>`;
}

/** A tint behind a highlighted element's label. */
function labelTint(label: Item, color: string, id: string): Item {
  const g = grow(label.box, 2);
  return { box: g, layer: LAYER.label, svg: `<rect x="${n(g.x)}" y="${n(g.y)}" width="${n(g.width)}" height="${n(g.height)}" rx="3" fill="${color}" fill-opacity="0.22"/>`, id, extra: true };
}

/* ------------------------------------------------------------------ */
/* composing: view, scale, badges, tiles                                */
/* ------------------------------------------------------------------ */

interface Frame {
  plane: string;
  planes: string[];
  notes: string[];
  /** the plane drawn (badges are placed on it) */
  located?: Plane;
  defs?: El;
  /** a file drawn in memory: its own layout problems (listed instead of the drawing's; no badges) */
  fileProblems?: LayoutProblem[];
  /** a crop's ids drawn in full */
  drawn?: Set<string>;
  nodes?: string[];
}

/** A scale as the notes and the `wrote` line print it: two decimals rounded down (0.7458: 0.74, never above the scale), two significant digits below 0.01. */
export function scaleText(scale: number): string {
  if (scale >= 0.01) return (Math.floor(scale * 100 + 1e-9) / 100).toFixed(2);
  return scale > 0 ? String(Number(scale.toPrecision(2))) : '0';
}

function compose(scene: Scene, frame: Frame, opts: RenderOptions): RenderResult {
  const notes = frame.notes;
  const items = scene.items;
  const fit = items.filter((i) => !i.extra);
  const content = unionOf((fit.length ? fit : items).map((i) => i.fit ?? i.box)) ?? { x: 0, y: 0, width: 0, height: 0 };
  let view = grow(content, MARGIN);
  let scale = opts.scale ?? 1;
  if (!(scale > 0) || !Number.isFinite(scale)) scale = 1;
  const base = scale;
  const max = opts.maxSize && opts.maxSize > 0 ? opts.maxSize : undefined;
  const fitted = (v: Box): number => (max && Math.max(v.width, v.height) * base > max ? max / Math.max(v.width, v.height) : base);
  // focus: only the region around the focus elements when the whole would be unreadable
  const focus = new Set(opts.focus ?? []);
  if (focus.size && fitted(view) < MIN_LABEL_SCALE && frame.located) {
    const near = nearFocus(frame.located, focus);
    const region = unionOf(items.filter((i) => i.id !== undefined && (focus.has(i.id) || (near.has(i.id) && !frame.located!.edges.has(i.id)))).map((i) => i.box));
    if (region) {
      notes.push(`the whole plane would be drawn at ${scaleText(fitted(view))} of its size: the image shows the region around the ${focus.size} element${focus.size > 1 ? 's' : ''} in focus (\`bpmn render <file>\` draws all of it)`);
      view = grow(region, FOCUS_MARGIN);
    }
  }
  scale = fitted(view);
  const listed = opts.problems ? problemList(frame, opts.problems) : [];
  const cut = opts.tiles && scale < MIN_LABEL_SCALE && max ? tileViews(items, view, frame, base, max, listed) : undefined;
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
  const problems = opts.problems ? badges(items, frame, listed, views, scale) : [];
  const images = views.map((t, i) => {
    const s = tiled ? Math.min(base, max ? max / Math.max(t.view.width, t.view.height) : base) : scale;
    return { ...emit(items, t.view, s, tiled ? i + 1 : undefined), ...(t.columns ? { columns: t.columns } : {}), ...(t.band ? { band: t.band } : {}) };
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

/** The shapes next to the focus: the ends of focus connections and the shapes connected to focus shapes (drawn whole in the focus region). */
function nearFocus(plane: Plane, focus: Set<string>): Set<string> {
  const near = new Set<string>();
  for (const e of plane.edges.values()) {
    const ends = [e.sourceId, e.targetId].filter((x): x is string => !!x);
    if (focus.has(e.id) || ends.some((x) => focus.has(x))) for (const x of ends) near.add(x);
  }
  return near;
}

/** One image: the items meeting `view` (badges: of this tile), painted by layer. */
function emit(items: Item[], view: Box, scale: number, tile: number | undefined): { svg: string; width: number; height: number; tokens: number } {
  const width = Math.max(1, Math.round(view.width * scale));
  const height = Math.max(1, Math.round(view.height * scale));
  const visible = items
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

/* --- numbered problems --- */

/** The bounding box of a problem's elements on the plane: shapes, waypoints, labels. */
function problemBox(plane: Plane, ids: string[]): Box | undefined {
  const boxes: Box[] = [];
  for (const id of ids) {
    const s = plane.shapes.get(id);
    if (s) boxes.push(s.bounds, ...(s.label ? [s.label] : []));
    const e = plane.edges.get(id);
    if (e?.points.length) boxes.push(pointsBox(e.points), ...(e.label ? [e.label] : []));
  }
  return unionOf(boxes);
}

/** The problems listed (see contract), located (diagram/metrics.ts locateProblems). */
function problemList(frame: Frame, asked: true | readonly LayoutProblem[]): LayoutProblem[] {
  const defs = frame.defs;
  if (!defs || !frame.located) return [];
  const located = frame.fileProblems ?? locateProblems(defs, layoutProblems(defs).problems);
  if (asked === true) {
    const shown = frame.drawn;
    return shown ? located.filter((p) => p.ids.some((id) => shown.has(id))) : located;
  }
  // the given problems in their order, each matched to a located one (one to one)
  const pool = new Map<string, LayoutProblem[]>();
  for (const p of located) pool.set(problemKey(p), [...(pool.get(problemKey(p)) ?? []), p]);
  return asked.map((p) => pool.get(problemKey(p))?.shift() ?? p);
}

/** The problems listed, numbered; their badges added to `items` (a problem of the file drawn in memory has none). */
function badges(items: Item[], frame: Frame, listed: LayoutProblem[], views: Array<{ view: Box }>, scale: number): RenderProblem[] {
  const plane = frame.located;
  const r = BADGE_R / scale;
  const placed: Point[] = [];
  return listed.map((p, i) => {
    const out: RenderProblem = { n: i + 1, kind: p.kind, ids: p.ids, ...(p.detail !== undefined ? { detail: p.detail } : {}), drawn: false };
    const at = p.at;
    if (!plane || frame.fileProblems || !at || at.plane !== plane.rootId) return out;
    const tile = views.findIndex((v) => contains(v.view, at));
    if (tile < 0) return out;
    const box = problemBox(plane, p.ids) ?? { x: at.x, y: at.y, width: 0, height: 0 };
    const spot = freeSpot(at, placed, r, box);
    placed.push(spot);
    const label = String(i + 1);
    const size = (label.length > 2 ? 9 : 11) / scale;
    items.push({
      box: grow({ x: spot.x, y: spot.y, width: 0, height: 0 }, r),
      layer: LAYER.badge,
      extra: true,
      ...(views.length > 1 ? { tile: tile + 1 } : {}),
      svg: `<g data-problem="${i + 1}"><circle cx="${n(spot.x)}" cy="${n(spot.y)}" r="${n(r)}" fill="${BADGE}" stroke="${FILL}" stroke-width="${n(1.5 / scale)}"/><text x="${n(spot.x)}" y="${n(spot.y + size * 0.36)}" font-size="${n(size)}" fill="${FILL}" text-anchor="middle">${label}</text></g>`,
    });
    return { ...out, drawn: true, ...(views.length > 1 ? { tile: tile + 1 } : {}) };
  });
}

/** Where a badge goes: its point, else the nearest spot around it (inside `box`) that no earlier badge covers. */
function freeSpot(at: Point, placed: Point[], r: number, box: Box): Point {
  const free = (p: Point): boolean => placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= 2 * r - 0.01);
  if (free(at)) return at;
  for (const ring of [2, 4, 6]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const p = { x: at.x + Math.cos(a) * ring * r, y: at.y + Math.sin(a) * ring * r };
      if (contains(box, p) && free(p)) return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
    }
  }
  return at;
}

/* --- tiles --- */

interface TileView {
  view: Box;
  columns?: [number, number];
  band?: number;
}

interface Span {
  a: number;
  b: number;
}

/** Spans sorted and merged where they overlap or lie less than `gap` apart. */
function mergeSpans(spans: Span[], gap: number): Span[] {
  const merged: Span[] = [];
  for (const s of [...spans].sort((x, y) => x.a - y.a)) {
    const last = merged[merged.length - 1];
    if (last && s.a - last.b < gap) last.b = Math.max(last.b, s.b);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * Pieces of [lo, hi] of at most `budget`, cut in the middle of the gaps
 * between `spans` where one is in reach, as even as the gaps allow;
 * undefined when it takes more than `room` pieces.
 */
function cutAxis(lo: number, hi: number, spans: Span[], budget: number, room: number): Span[] | undefined {
  const merged = mergeSpans(spans, 0);
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

/**
 * The pieces of one axis: the content's stretches (gaps of half a tile and
 * more between them are left out), each cut by cutAxis; undefined when it
 * takes more than `room` pieces.
 */
function axisPieces(lo: number, hi: number, content: Span[], cuts: Span[], budget: number, room: number): { pieces: Span[]; skipped: boolean } | undefined {
  const stretches = mergeSpans(
    content.map((c) => ({ a: Math.max(lo, c.a - MARGIN), b: Math.min(hi, c.b + MARGIN) })),
    budget / 2,
  );
  if (stretches.length > room) return undefined;
  const pieces: Span[] = [];
  for (const s of stretches) {
    const part = cutAxis(s.a, s.b, cuts, budget, room - pieces.length);
    if (!part) return undefined;
    pieces.push(...part);
  }
  const skipped = stretches.length > 1 || (stretches[0] !== undefined && (stretches[0].a > lo + 0.5 || stretches[0].b < hi - 0.5));
  return { pieces, skipped };
}

/** The index range of the pieces a span meets. */
function piecesMet(pieces: Span[], a: number, b: number): [number, number] {
  let first = 0;
  while (first < pieces.length && pieces[first]!.b < a) first++;
  let last = first - 1;
  while (last + 1 < pieces.length && pieces[last + 1]!.a <= b) last++;
  return [first, last];
}

/**
 * The tiles of an unreadable image (see contract): cut between the plane's
 * columns, and between rows when too tall; only tiles with a shape, a label
 * or a numbered problem in them. `over` when that takes more than MAX_TILES
 * tiles; undefined when nothing is to be tiled.
 */
function tileViews(items: Item[], view: Box, frame: Frame, base: number, max: number, problems: LayoutProblem[]): { views: TileView[]; skipped: boolean } | { over: true } | undefined {
  const plane = frame.located;
  if (!plane) return undefined;
  const budget = max / base;
  // what a tile must hold to be kept
  const marks: Box[] = items.filter((i) => !i.extra && i.content && meets(i.content, view)).map((i) => i.content!);
  for (const p of problems) if (p.at && p.at.plane === plane.rootId && !frame.fileProblems && contains(view, p.at)) marks.push({ x: p.at.x, y: p.at.y, width: 0, height: 0 });
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
  const xs = axisPieces(view.x, view.x + view.width, marks.map((b) => ({ a: b.x, b: b.x + b.width })), [...columns, ...others], budget, MAX_TILES);
  const ys = xs && axisPieces(view.y, view.y + view.height, marks.map((b) => ({ a: b.y, b: b.y + b.height })), leaves.map((s) => ({ a: s.bounds.y, b: s.bounds.y + s.bounds.height })), budget, MAX_TILES);
  if (!xs || !ys) return { over: true };
  // the cells holding a mark (every piece holds one: the tiles are at least as many as the pieces of either axis)
  const kept = new Set<number>();
  for (const m of marks) {
    const [x0, x1] = piecesMet(xs.pieces, m.x, m.x + m.width);
    const [y0, y1] = piecesMet(ys.pieces, m.y, m.y + m.height);
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

function contains(b: Box, p: Point): boolean {
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
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

/**
 * An external label like bpmn-js 18 (BpmnImporter.addLabel, then
 * renderExternalLabel): the text laid out at max(90, the DI label width) in
 * 11 px, then again at the width of its widest line (rounded up), which can
 * break it differently; centred on `cx`, its top at `top` (data-label: the
 * element's id).
 */
function externalLabel(id: string, value: string, cx: number, top: number, color: string, labelWidth = EXT_WIDTH): Item {
  const k = SIZE / EXT_SIZE;
  const first = wrapLines(value, Math.max(EXT_WIDTH, labelWidth) * k);
  const widest = Math.ceil(Math.max(...first.map((l) => textWidth(l) / k)) - 1e-9);
  // (a hair of slack: the widest line fits its own width despite rounding)
  const ls = wrapLines(value, widest * k + 1e-6);
  const width = Math.max(...ls.map((l) => textWidth(l) / k), 1);
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
  const value = s.kind === 'group' ? groupName(s.el) : raw<string>(s.el, 'name');
  if (!value || !value.trim()) return undefined;
  if (s.label) return externalLabel(s.id, value, s.label.x + s.label.width / 2, Math.round(s.label.y), style.label, s.label.width);
  const b = s.bounds;
  // no label bounds: bpmn-js puts a 90 x 20 label below the shape (a group's at its top)
  return externalLabel(s.id, value, b.x + b.width / 2, Math.round(s.kind === 'group' ? b.y : b.y + b.height), style.label);
}

function edgeLabel(e: DEdge, style: Style): Item | undefined {
  if (e.kind !== 'sequenceFlow' && e.kind !== 'messageFlow') return undefined;
  const value = raw<string>(e.el, 'name');
  if (!value || !value.trim()) return undefined;
  if (e.label) return externalLabel(e.id, value, e.label.x + e.label.width / 2, Math.round(e.label.y), style.label, e.label.width);
  const mid = flowLabelMid(e.points);
  return externalLabel(e.id, value, mid.x, Math.round(mid.y - 10), style.label);
}

/** The point halfway along a polyline. */
function halfway(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let rest = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    const d = lengths[i]!;
    if (rest <= d && d > 0) {
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + ((b.x - a.x) * rest) / d, y: a.y + ((b.y - a.y) * rest) / d };
    }
    rest -= d;
  }
  return points[points.length - 1]!;
}

/** The message a message flow carries (messageRef): bpmn-js draws an envelope halfway along it, its name below. */
const carriesMessage = (e: DEdge): boolean => e.kind === 'messageFlow' && !!raw(e.el, 'messageRef') && e.points.length >= 2;

/** The envelope of a message flow's message, 21 x 14 centred halfway (bpmn-js MESSAGE_FLOW_MARKER): outlined for messageVisibleKind "initiating" (the DI default), filled for "non_initiating". */
function envelopeSvg(e: DEdge, st: Style): string {
  const m = halfway(e.points);
  const initiating = raw(e.di, 'messageVisibleKind') === 'initiating';
  const x = m.x - 10.5;
  const y = m.y - 7;
  return `<path data-message="${attr(e.id)}" d="M${n(x)} ${n(y)}v14h21v-14ZL${n(m.x)} ${n(y + 6)}L${n(x + 21)} ${n(y)}" fill="${initiating ? st.fill : st.stroke}" stroke="${initiating ? st.stroke : st.fill}" stroke-width="1" stroke-linejoin="round"/>`;
}

/**
 * The name of a message flow's message: 12 px, wrapped at 150 px, in the
 * flow's colour (data-message: the flow's id), where bpmn-js 18 puts it when
 * it opens a file: its left edge at the middle of the flow, its top 10 px
 * below it, the lines centred on the widest (on import bpmn-js measures the
 * envelope and the text as 0 x 0; it centres the name below the envelope
 * only when it redraws the flow after an edit).
 */
function messageLabel(e: DEdge, st: Style): Item | undefined {
  if (!carriesMessage(e)) return undefined;
  const value = raw<string>(raw(e.el, 'messageRef'), 'name');
  if (!value || !value.trim()) return undefined;
  const m = halfway(e.points);
  const ls = wrapLines(value, 150);
  const width = Math.max(...ls.map((l) => textWidth(l)), 1);
  const top = m.y + 10;
  return {
    box: { x: m.x, y: top, width, height: ls.length * SIZE * 1.2 },
    layer: LAYER.label,
    svg: lines(ls, m.x + width / 2, top + SIZE * 1.2 * 0.75, SIZE, st.stroke, 'middle', ` data-message="${attr(e.id)}"`),
  };
}

/** What a connection covers: its waypoints, and the envelope of a message flow's message. */
function edgeBox(e: DEdge): Box {
  const box = pointsBox(e.points);
  if (!carriesMessage(e)) return box;
  const m = halfway(e.points);
  return unionOf([box, { x: m.x - 10.5, y: m.y - 7, width: 21, height: 14 }])!;
}

/** About where a frame's name is drawn (in a pool's or lane's header band, centred along it; a black-box pool's name; an expanded sub-process's title, diagram/utils/text.ts titleBox); undefined without one. */
function frameNameBox(s: DShape): Box | undefined {
  const name = s.kind === 'group' ? undefined : raw<string>(s.el, 'name');
  if (!name || !name.trim()) return undefined;
  const b = s.bounds;
  if (s.kind === 'subProcess') return titleBox(b, name);
  const blackBox = s.kind === 'participant' && !raw(s.el, 'processRef');
  if ((s.kind === 'participant' || s.kind === 'lane') && !blackBox) {
    if (horizontal(s)) {
      const h = Math.min(b.height, textWidth(name));
      return { x: b.x, y: b.y + (b.height - h) / 2, width: Math.min(30, b.width), height: h };
    }
    const w = Math.min(b.width, textWidth(name));
    return { x: b.x + (b.width - w) / 2, y: b.y, width: w, height: Math.min(30, b.height) };
  }
  const w = Math.min(b.width, textWidth(name) + 14);
  return { x: b.x + (b.width - w) / 2, y: b.y, width: w, height: blackBox ? b.height : Math.min(30, b.height) };
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
    if (carriesMessage(e)) out += envelopeSvg(e, st);
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

