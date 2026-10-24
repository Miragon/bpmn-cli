/**
 * The drawing as an image: one diagram plane (its DI) drawn as SVG without a
 * browser, close to how bpmn-js draws it (not pixel-identical), so an agent
 * can look at what it changed (`bpmn render`; the node layer rasterises the
 * SVG to PNG, src/node/PngRenderer.ts).
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
 *                                 (query/AroundWindow.ts; a sequence flow:
 *                                 both its ends)
 *      path {from, to, via}       the nodes and flows of the shortest
 *                                 sequence-flow path (query/ElementSelector.ts path, the
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
 *    (diagram/ProblemLocator.ts) is on this plane and in the image gets a
 *    numbered badge there (`drawn`); a badge that would cover an earlier one
 *    moves aside within the bounding box of the problem's elements.
 *  - tiles: when the image would draw its labels below MIN_LABEL_SCALE, it is
 *    split into tiles at `scale` (default 1) within maxSize: cut between the
 *    plane's columns (query/DiagramColumns.ts, `show --layout`'s c<n>) and,
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
import { Doc } from '../model/Doc.js';
import { ioError, modelError } from '../shared/utils/errors.js';
import { FullLayout } from '../layout/FullLayout.js';
import type { Box } from '../diagram/utils/geom.js';
import { LayoutAnalysis } from '../diagram/LayoutAnalysis.js';
import type { LayoutProblem } from '../diagram/utils/problems.js';
import { DiagramReader } from '../diagram/DiagramReader.js';
import { Semantics } from '../diagram/Semantics.js';
import type { DEdge, DShape, Plane } from '../diagram/types.js';
import { is } from '../model/utils/moddle.js';
import { Composer } from './Composer.js';
import { Crop } from './Crop.js';
import { Scene } from './Scene.js';
import { COORD_LIMIT, HALO_COLORS, type RenderOptions, type RenderResult } from './types.js';
import { planeOfId } from './utils/planes.js';

export class DocRenderer {
  private readonly sem: Semantics;

  constructor(
    private readonly doc: Doc,
    private readonly opts: RenderOptions = {},
  ) {
    this.sem = Semantics.of(doc.definitions);
  }

  /** `bpmn render --format svg`: one plane of the document as SVG (see the module contract). */
  static async renderXml(xml: string, opts: RenderOptions = {}): Promise<RenderResult> {
    let doc = await Doc.fromXml(xml);
    if (new DiagramReader(doc.definitions).planes().length) return new DocRenderer(doc, opts).render();
    // nothing drawn: draw it in memory (layoutModel replaces the DI; its XML is the truth); the problems stay the file's
    const fileProblems = opts.problems ? LayoutAnalysis.of(doc.definitions).problems : [];
    const { xml: drawn } = await new FullLayout(doc.model).run();
    doc = await Doc.fromXml(drawn);
    const result = new DocRenderer(doc, opts).render(fileProblems);
    const notes = ['the file has no diagram: it is drawn by the layout engine in memory (nothing is written; `bpmn layout <file>` saves a drawing)'];
    if (opts.problems) notes.push("the problems are the file's (`bpmn metrics <file>`), not the in-memory drawing's: none is in the image");
    return { ...result, notes: [...notes, ...result.notes] };
  }

  /** One plane of the parsed document as SVG (no layout); `fileProblems`: the layout problems of a file drawn in memory (listed instead of the drawing's). */
  render(fileProblems?: LayoutProblem[]): RenderResult {
    const { doc, opts, sem } = this;
    const defs = doc.definitions;
    const read = new DiagramReader(defs, sem).planes();
    const checked = read.map((p) => DocRenderer.saneOf(p));
    const planes = checked.map((c) => c.plane);
    const want = Crop.of(doc, sem, planes, opts);
    const plane = this.pickPlane(planes, opts.plane ?? want.plane ?? DocRenderer.focusPlane(planes, opts.focus));
    const others = planes.filter((p) => p !== plane).map((p) => p.rootId);
    const highlight = this.halos();
    if (!plane) return new Composer([], { plane: 'none', planes: others, notes: ['the document has no diagram plane'] }, opts).result();
    const notes: string[] = [];
    const index = planes.indexOf(plane);
    const unchecked = read[index]!;
    const undrawn = this.undrawnOn(read, unchecked);
    if (undrawn.length) notes.push(`${undrawn.length} element${undrawn.length > 1 ? 's have' : ' has'} no shape and ${undrawn.length > 1 ? 'are' : 'is'} not drawn: ${DocRenderer.idList(undrawn)} (\`bpmn layout <file>\` draws ${undrawn.length > 1 ? 'them' : 'it'})`);
    const { broken, labels } = checked[index]!;
    if (broken.length) notes.push(`${broken.length} element${broken.length > 1 ? 's have' : ' has'} broken coordinates (not a number, beyond ±${DocRenderer.thousands(COORD_LIMIT)} px, or a negative size) and ${broken.length > 1 ? 'are' : 'is'} not drawn: ${DocRenderer.idList(broken)} (\`bpmn layout <file>\` draws ${broken.length > 1 ? 'them' : 'it'} again)`);
    if (labels.length) notes.push(`${labels.length} label${labels.length > 1 ? 's have' : ' has'} broken bounds and ${labels.length > 1 ? 'are' : 'is'} not drawn: ${DocRenderer.idList(labels)} (\`bpmn label <file> <id> --side below\` places ${labels.length > 1 ? 'each' : 'it'} again)`);
    if (!plane.shapes.size && !plane.edges.size) {
      if (unchecked.shapes.size || unchecked.edges.size) {
        throw ioError('E_RENDER', `Nothing on the plane of ${plane.rootId} can be drawn: every shape and connection has broken coordinates`, {
          element: plane.rootId,
          hint: `Broken: ${DocRenderer.idList(broken)}. \`bpmn show <file> --layout\` lists the drawing; \`bpmn layout <file>\` draws it again.`,
        });
      }
      if (want.scope) throw modelError('E_NO_MATCH', `Nothing of --scope ${want.scope} is drawn: the plane of ${plane.rootId} is empty`, { element: want.scope, hint: '`bpmn layout <file>` draws the elements without a shape; `bpmn render <file>` lists the planes.' });
      notes.push(`the plane of ${plane.rootId} is empty`);
    }
    const drawn = want.crop ? want.crop.drawnOn(plane, planes, notes) : undefined;
    const scene = new Scene(plane, drawn, highlight);
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
    return new Composer(scene.items, { plane: plane.rootId, planes: others, notes, located: plane, defs, ...(fileProblems ? { fileProblems } : {}), ...(drawn ? { drawn } : {}), ...(nodes ? { nodes } : {}) }, opts).result();
  }

  /** At most five ids, then how many more. */
  private static idList(ids: string[]): string {
    return ids.slice(0, 5).join(', ') + (ids.length > 5 ? `, ... (${ids.length - 5} more)` : '');
  }

  /** Thousands with commas (1,000,000). */
  private static thousands(v: number): string {
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** A coordinate the renderer draws: a finite number within ±COORD_LIMIT. */
  private static saneNumber(v: unknown): boolean {
    return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_LIMIT;
  }

  private static saneBox(b: Box): boolean {
    return [b.x, b.y, b.width, b.height, b.x + b.width, b.y + b.height].every((v) => DocRenderer.saneNumber(v)) && b.width >= 0 && b.height >= 0;
  }

  /**
   * The plane without broken geometry (see contract): shapes and connections
   * with a coordinate that is not a finite number within ±COORD_LIMIT (or a
   * negative size) are left out, broken label bounds dropped; the plane itself
   * when nothing is broken, else a copy.
   */
  private static saneOf(plane: Plane): { plane: Plane; broken: string[]; labels: string[] } {
    const broken: string[] = [];
    const labels: string[] = [];
    const shapes = new Map<string, DShape>();
    for (const [id, s] of plane.shapes) {
      if (!DocRenderer.saneBox(s.bounds)) broken.push(id);
      else if (s.label && !DocRenderer.saneBox(s.label)) {
        labels.push(id);
        const copy = { ...s };
        delete copy.label;
        shapes.set(id, copy);
      } else shapes.set(id, s);
    }
    const edges = new Map<string, DEdge>();
    for (const [id, e] of plane.edges) {
      if (!e.points.every((p) => DocRenderer.saneNumber(p.x) && DocRenderer.saneNumber(p.y))) broken.push(id);
      else if (e.label && !DocRenderer.saneBox(e.label)) {
        labels.push(id);
        const copy = { ...e };
        delete copy.label;
        edges.set(id, copy);
      } else edges.set(id, e);
    }
    if (!broken.length && !labels.length) return { plane, broken, labels };
    return { plane: { ...plane, shapes, edges }, broken, labels };
  }

  private pickPlane(planes: Plane[], id: string | undefined): Plane | undefined {
    if (id === undefined) return planes[0];
    const found = planes.find((p) => p.rootId === id);
    if (found) return found;
    const candidates = planes.map((p) => p.rootId);
    const hint = candidates.length ? `The planes of this file: ${candidates.join(', ')}.` : 'The file has no diagram.';
    if (!this.sem.byId.has(id)) throw modelError('E_NOT_FOUND', `No element with id "${id}"`, { element: id, candidates, hint });
    throw modelError('E_WRONG_KIND', `${id} has no diagram plane of its own (only collapsed sub-processes, processes and collaborations have one)`, { element: id, candidates, hint: `${hint} An expanded sub-process is drawn on the plane of its parent.` });
  }

  /** The plane of the first focus element that is drawn. */
  private static focusPlane(planes: Plane[], focus: string[] | undefined): string | undefined {
    for (const id of focus ?? []) {
      const p = planeOfId(planes, id);
      if (p) return p.rootId;
    }
    return undefined;
  }

  /** Flow elements, artifacts, lanes, pools and message flows whose DI belongs on `plane` but which have none. */
  private undrawnOn(planes: Plane[], plane: Plane): string[] {
    const sem = this.sem;
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
      if (sem.homePlane(planes, id) === plane) out.push(id);
    }
    return out;
  }

  /** The halo colour of each highlighted element (see contract); a list's unknown ids are E_NOT_FOUND. */
  private halos(): (id: string) => string | undefined {
    const h = this.opts.highlight;
    const colors = new Map<string, string>();
    if (Array.isArray(h)) {
      for (const id of h) {
        this.doc.require(id);
        colors.set(id, HALO_COLORS.changed);
      }
    } else if (h) {
      for (const k of ['created', 'changed', 'moved'] as const) for (const id of h[k] ?? []) if (!colors.has(id)) colors.set(id, HALO_COLORS[k]);
    }
    return (id) => colors.get(id);
  }
}
