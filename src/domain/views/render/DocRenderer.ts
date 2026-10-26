import { Doc } from '../../document/Doc.js';
import { ioError, modelError } from '../../document/utils/errors.js';
import { FullLayout } from '../../diagram/layout/FullLayout.js';
import type { Box } from '../../diagram/utils/geom.js';
import { LayoutAnalysis } from '../../diagram/di/LayoutAnalysis.js';
import type { LayoutProblem } from '../../diagram/utils/problems.js';
import { DiagramReader } from '../../diagram/di/DiagramReader.js';
import { Semantics } from '../../diagram/di/Semantics.js';
import type { DEdge, DShape, Plane } from '../../diagram/di/types.js';
import { is } from '../../document/utils/moddle.js';
import { Composer } from './Composer.js';
import { Crop } from './Crop.js';
import { Scene } from './Scene.js';
import { COORD_LIMIT, HALO_COLORS, type RenderOptions, type RenderResult } from './types.js';
import { planeOfId } from '../utils/planes.js';

/**
 * Draws one diagram plane as SVG without a browser, close to bpmn-js (not pixel-identical), so
 * an agent can look at what it changed. Glyphs come from the BPMN notation, not bpmn-js code.
 * Deterministic and browser-safe; content outside the view is culled.
 */
export class DocRenderer {
  private readonly sem: Semantics;

  constructor(
    private readonly doc: Doc,
    private readonly opts: RenderOptions = {},
  ) {
    this.sem = Semantics.of(doc.definitions);
  }

  /** A document without any diagram is laid out in memory first; its problems stay the file's. */
  static async renderXml(xml: string, opts: RenderOptions = {}): Promise<RenderResult> {
    let doc = await Doc.fromXml(xml);
    if (new DiagramReader(doc.definitions).planes().length) return new DocRenderer(doc, opts).render();
    const fileProblems = opts.problems ? LayoutAnalysis.of(doc.definitions).problems : [];
    const { xml: drawn } = await new FullLayout(doc.model).run();
    doc = await Doc.fromXml(drawn);
    const result = new DocRenderer(doc, opts).render(fileProblems);
    const notes = ['the file has no diagram: it is drawn by the layout engine in memory (nothing is written; `bpmn layout <file>` saves a drawing)'];
    if (opts.problems) notes.push("the problems are the file's (`bpmn metrics <file>`), not the in-memory drawing's: none is in the image");
    return { ...result, notes: [...notes, ...result.notes] };
  }

  /** `fileProblems`: those of a file drawn in memory, listed instead of the drawing's. */
  render(fileProblems?: LayoutProblem[]): RenderResult {
    const { doc, opts, sem } = this;
    const defs = doc.definitions;
    const read = new DiagramReader(defs, sem).planes();
    const checked = read.map((readPlane) => DocRenderer.saneOf(readPlane));
    const planes = checked.map((sane) => sane.plane);
    const want = Crop.of(doc, sem, planes, opts);
    const plane = this.pickPlane(planes, opts.plane ?? want.plane ?? DocRenderer.focusPlane(planes, opts.focus));
    const others = planes.filter((candidate) => candidate !== plane).map((candidate) => candidate.rootId);
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
      const inImage = new Set(scene.items.filter((item) => item.id !== undefined && /^<g data-(id|context)=/.test(item.svg)).map((item) => item.id!));
      const missing = opts.highlight.filter((id) => !inImage.has(id));
      if (missing.length) notes.push(`highlighted but not in the image (${drawn ? 'outside the crop or ' : ''}not drawn on this plane): ${missing.join(', ')}`);
    }
    const nodes = want.crop?.frame
      ? [...plane.shapes.values()].filter((shape) => shape.id !== want.crop!.frame && drawn!.has(shape.id) && is(shape.el, 'bpmn:FlowNode')).map((shape) => shape.id)
      : want.crop
        ? want.crop.nodes.filter((id) => drawn!.has(id))
        : want.scope
          ? [...plane.shapes.values()].filter((shape) => is(shape.el, 'bpmn:FlowNode')).map((shape) => shape.id)
          : undefined;
    return new Composer(scene.items, { plane: plane.rootId, planes: others, notes, located: plane, defs, ...(fileProblems ? { fileProblems } : {}), ...(drawn ? { drawn } : {}), ...(nodes ? { nodes } : {}) }, opts).result();
  }

  private static idList(ids: string[]): string {
    return ids.slice(0, 5).join(', ') + (ids.length > 5 ? `, ... (${ids.length - 5} more)` : '');
  }

  private static thousands(count: number): string {
    return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  private static saneNumber(candidate: unknown): boolean {
    return typeof candidate === 'number' && Number.isFinite(candidate) && Math.abs(candidate) <= COORD_LIMIT;
  }

  private static saneBox(box: Box): boolean {
    return [box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height].every((coordinate) => DocRenderer.saneNumber(coordinate)) && box.width >= 0 && box.height >= 0;
  }

  private static saneOf(plane: Plane): { plane: Plane; broken: string[]; labels: string[] } {
    const broken: string[] = [];
    const labels: string[] = [];
    const shapes = new Map<string, DShape>();
    for (const [id, shape] of plane.shapes) {
      if (!DocRenderer.saneBox(shape.bounds)) broken.push(id);
      else if (shape.label && !DocRenderer.saneBox(shape.label)) {
        labels.push(id);
        const copy = { ...shape };
        delete copy.label;
        shapes.set(id, copy);
      } else shapes.set(id, shape);
    }
    const edges = new Map<string, DEdge>();
    for (const [id, edge] of plane.edges) {
      if (!edge.points.every((point) => DocRenderer.saneNumber(point.x) && DocRenderer.saneNumber(point.y))) broken.push(id);
      else if (edge.label && !DocRenderer.saneBox(edge.label)) {
        labels.push(id);
        const copy = { ...edge };
        delete copy.label;
        edges.set(id, copy);
      } else edges.set(id, edge);
    }
    if (!broken.length && !labels.length) return { plane, broken, labels };
    return { plane: { ...plane, shapes, edges }, broken, labels };
  }

  private pickPlane(planes: Plane[], id: string | undefined): Plane | undefined {
    if (id === undefined) return planes[0];
    const found = planes.find((candidate) => candidate.rootId === id);
    if (found) return found;
    const candidates = planes.map((candidate) => candidate.rootId);
    const hint = candidates.length ? `The planes of this file: ${candidates.join(', ')}.` : 'The file has no diagram.';
    if (!this.sem.byId.has(id)) throw modelError('E_NOT_FOUND', `No element with id "${id}"`, { element: id, candidates, hint });
    throw modelError('E_WRONG_KIND', `${id} has no diagram plane of its own (only collapsed sub-processes, processes and collaborations have one)`, { element: id, candidates, hint: `${hint} An expanded sub-process is drawn on the plane of its parent.` });
  }

  private static focusPlane(planes: Plane[], focus: string[] | undefined): string | undefined {
    for (const id of focus ?? []) {
      const focused = planeOfId(planes, id);
      if (focused) return focused.rootId;
    }
    return undefined;
  }

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
      if (!drawable || planes.some((other) => other.shapes.has(id) || other.edges.has(id))) continue;
      if (sem.homePlane(planes, id) === plane) out.push(id);
    }
    return out;
  }

  /** Created wins over changed, changed over moved. */
  private halos(): (id: string) => string | undefined {
    const highlight = this.opts.highlight;
    const colors = new Map<string, string>();
    if (Array.isArray(highlight)) {
      for (const id of highlight) {
        this.doc.require(id);
        colors.set(id, HALO_COLORS.changed);
      }
    } else if (highlight) {
      for (const category of ['created', 'changed', 'moved'] as const) for (const id of highlight[category] ?? []) if (!colors.has(id)) colors.set(id, HALO_COLORS[category]);
    }
    return (id) => colors.get(id);
  }
}
