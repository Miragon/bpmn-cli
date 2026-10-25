import { Doc } from '../model/Doc.js';
import { ioError, modelError } from '../shared/utils/errors.js';
import { FullLayout } from '../layout/FullLayout.js';
import type { Box } from '../drawing/utils/geom.js';
import { LayoutAnalysis } from '../drawing/LayoutAnalysis.js';
import type { LayoutProblem } from '../drawing/utils/problems.js';
import { DiagramReader } from '../drawing/DiagramReader.js';
import { Semantics } from '../drawing/Semantics.js';
import type { DEdge, DShape, Plane } from '../drawing/types.js';
import { is } from '../model/utils/moddle.js';
import { Composer } from './Composer.js';
import { Crop } from './Crop.js';
import { Scene } from './Scene.js';
import { COORD_LIMIT, HALO_COLORS, type RenderOptions, type RenderResult } from './types.js';
import { planeOfId } from './utils/planes.js';

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
      const inImage = new Set(scene.items.filter((i) => i.id !== undefined && /^<g data-(id|context)=/.test(i.svg)).map((i) => i.id!));
      const missing = opts.highlight.filter((id) => !inImage.has(id));
      if (missing.length) notes.push(`highlighted but not in the image (${drawn ? 'outside the crop or ' : ''}not drawn on this plane): ${missing.join(', ')}`);
    }
    const nodes = want.crop?.frame
      ? [...plane.shapes.values()].filter((s) => s.id !== want.crop!.frame && drawn!.has(s.id) && is(s.el, 'bpmn:FlowNode')).map((s) => s.id)
      : want.crop
        ? want.crop.nodes.filter((id) => drawn!.has(id))
        : want.scope
          ? [...plane.shapes.values()].filter((s) => is(s.el, 'bpmn:FlowNode')).map((s) => s.id)
          : undefined;
    return new Composer(scene.items, { plane: plane.rootId, planes: others, notes, located: plane, defs, ...(fileProblems ? { fileProblems } : {}), ...(drawn ? { drawn } : {}), ...(nodes ? { nodes } : {}) }, opts).result();
  }

  private static idList(ids: string[]): string {
    return ids.slice(0, 5).join(', ') + (ids.length > 5 ? `, ... (${ids.length - 5} more)` : '');
  }

  private static thousands(v: number): string {
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  private static saneNumber(v: unknown): boolean {
    return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_LIMIT;
  }

  private static saneBox(b: Box): boolean {
    return [b.x, b.y, b.width, b.height, b.x + b.width, b.y + b.height].every((v) => DocRenderer.saneNumber(v)) && b.width >= 0 && b.height >= 0;
  }

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

  private static focusPlane(planes: Plane[], focus: string[] | undefined): string | undefined {
    for (const id of focus ?? []) {
      const p = planeOfId(planes, id);
      if (p) return p.rootId;
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
      if (!drawable || planes.some((p) => p.shapes.has(id) || p.edges.has(id))) continue;
      if (sem.homePlane(planes, id) === plane) out.push(id);
    }
    return out;
  }

  /** Created wins over changed, changed over moved. */
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
