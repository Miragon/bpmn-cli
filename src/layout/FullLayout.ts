/**
 * DI generation. The AI never sees this: every mutation ends here.
 *
 * bpmn-auto-layout discards all existing DI and re-derives it from the
 * semantic model. The single piece of information it harvests from old DI is
 * `isExpanded="true"` on sub-process shapes located on the plane of the layout
 * root. We therefore carry "expanded" as a convention:
 *
 *   - a sub-process is expanded by default (that is what modellers want),
 *   - it is collapsed only if the existing DI says so (a BPMNShape exists for it
 *     without isExpanded=true), or if the caller explicitly asks for it.
 *
 * Before calling the layouter we replace the DI with a minimal "hint" diagram
 * that lists the expanded sub-processes.
 *
 * Both engines write new DI; the ids the file's DI had are given back to it
 * afterwards (diagram/DiIdMemo.ts restore: same DI, plane and diagram ids,
 * new DI in the file's DI id style, a long element id cut so that every DI
 * id stays within 64 characters), so a redraw only changes geometry.
 * Neither engine knows where a group's box goes: every drawn group is drawn
 * again around the elements its box held (diagram/Groups.ts; one without
 * any of them drawn keeps its box, or its size below the drawing when the
 * redraw put shapes on it; LayoutResult.notes says so). The clean engine
 * keeps the unconnected parts of a group together.
 * Before they run, every element they draw that has no id gets one in the
 * file's id style (diagram/DrawnElementIds.ts; LayoutResult.givenIds), since DI
 * refers to elements by id.
 *
 * Two things the alpha layouter does not handle are patched around here:
 *
 *   - a process with lanes and a node in none of them (a lint state, W_NOT_IN_LANE)
 *     crashes the layouter as soon as a data object is shared between a lane
 *     member and the laneless node. Such nodes are put into a lane for the
 *     duration of the layout only (the written model is untouched).
 *   - associations whose non-annotation end is not a flow node (a sequence /
 *     message flow, a pool) and compensation associations (compensate boundary
 *     event -> handler) get no BPMNEdge. The edge is synthesised afterwards; a
 *     compensation handler is moved right below its boundary event (bpmn.io
 *     convention) when that spot is free.
 */
import type { LayoutWarning } from 'bpmn-auto-layout';
import { DrawnElementIds, type GivenId } from '../diagram/DrawnElementIds.js';
import { Groups, type RedrawnGroups } from '../diagram/Groups.js';
import { diIdsFit } from '../diagram/utils/di-ids.js';
import { DiIdMemo } from '../diagram/DiIdMemo.js';
import type { IdRequest } from '../ids/utils/requests.js';
import { CleanEngine } from './clean/CleanEngine.js';
import { addTo, layoutRoot, parseXml, serialize, type El, type Model, idOf } from '../model/utils/moddle.js';
import { resolveExpanded, subProcesses } from '../diagram/utils/expansion.js';
import { AssociationEdges } from './AssociationEdges.js';
import { TemporaryLaneMembers } from './TemporaryLaneMembers.js';
import { ModelError } from '../model/ModelError.js';

export interface LayoutWarningInfo {
  code: string;
  elementId: string;
  message: string;
  relatedElementIds: string[];
}

export type LayoutEngine = 'clean' | 'auto';

export interface LayoutOptions {
  /** sub-process ids that must be expanded (in addition to what the DI says) */
  expand?: Iterable<string>;
  /** sub-process ids that must be collapsed */
  collapse?: Iterable<string>;
  /** 'clean' (built-in engine, default) or 'auto' (bpmn-auto-layout) */
  engine?: LayoutEngine;
  /** allocates (and claims) the id of a drawn element that has none, in the document's registry (default: the file's id style on a registry of the model's ids) */
  allocateId?: (req: IdRequest) => string;
}

export interface LayoutResult {
  xml: string;
  warnings: LayoutWarningInfo[];
  expanded: string[];
  /** elements without id that got one so that the diagram can refer to them (diagram/DrawnElementIds.ts) */
  givenIds?: GivenId[];
  /** what the caller should know about the drawing (a group around nothing kept or moved) */
  notes?: string[];
}

export class FullLayout {
  constructor(
    private readonly model: Model,
    private readonly opts: LayoutOptions = {},
  ) {}

  /** Replaces the DI of `model` with a hint diagram for the layouter. */
  private injectLayoutHints(expanded: Set<string>): void {
    const { moddle, definitions } = this.model;
    const root = layoutRoot(definitions);
    definitions.set('diagrams', []);
    if (!root) return;
    const byId = new Map<string, El>();
    for (const sub of subProcesses(definitions)) byId.set(idOf(sub), sub);
    const plane = moddle.create('bpmndi:BPMNPlane', { id: `BPMNPlane_${idOf(root)}`, bpmnElement: root });
    const diagram = moddle.create('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${idOf(root)}`, plane });
    plane.$parent = diagram;
    for (const id of expanded) {
      const sub = byId.get(id);
      if (!sub) continue;
      const shape = moddle.create('bpmndi:BPMNShape', { id: `BPMNShape_${id}`, bpmnElement: sub, isExpanded: true });
      addTo(plane, 'planeElement', shape);
    }
    addTo(definitions, 'diagrams', diagram);
  }

  private toWarningInfo(w: LayoutWarning): LayoutWarningInfo {
    return { code: w.code, elementId: w.elementId, message: w.message, relatedElementIds: w.relatedElementIds ?? [] };
  }

  /**
   * Lays out the model. The model's in-memory DI is replaced by the hint diagram
   * as a side effect; callers should treat the returned XML as the truth and
   * re-parse it if they need DI.
   */
  async run(): Promise<LayoutResult> {
    // the DI refers to elements by id: an element without one gets one first (never bpmnElement="undefined")
    const givenIds = new DrawnElementIds(this.model.definitions).give(this.opts.allocateId);
    const given = givenIds.length ? { givenIds } : {};
    const expanded = resolveExpanded(this.model, this.opts);
    const diIds = DiIdMemo.remember(this.model.definitions);
    const groups = [...new Groups(this.model.definitions).remembered(), ...new Groups(this.model.definitions).undrawn()];
    if ((this.opts.engine ?? 'clean') === 'clean') {
      const { warnings } = new CleanEngine(this.model, expanded, Groups.membersOf(groups)).run();
      const redrawn = new Groups(this.model.definitions).redraw(this.model.moddle, groups);
      diIds.restore(this.model.definitions);
      const { xml } = await this.model.moddle.toXML(this.model.definitions, { format: true });
      return { xml, warnings: warnings.map((w) => ({ code: w.code, elementId: w.elementId, message: w.message, relatedElementIds: [] })), expanded: [...expanded], ...given, ...this.groupNotes(redrawn) };
    }
    // without old DI the layouter's ids stand unless an element id is long enough to need a cut (DiIdMemo restore)
    const cut = !diIds.diagrams.length && !diIdsFit(this.model.definitions);
    this.injectLayoutHints(expanded);
    const temporary = TemporaryLaneMembers.add(this.model.definitions);
    let result: LayoutResult;
    try {
      const { xml: input } = await this.model.moddle.toXML(this.model.definitions, { format: true });
      result = await this.autoLayout(input, expanded);
    } finally {
      temporary.withdraw(this.model.definitions);
    }
    const missingDi = result.warnings.some((w) => w.code === 'DI_NOT_CREATED');
    if (!temporary.count && !missingDi && !diIds.diagrams.length && !cut) return { ...result, ...given };

    // second pass over the layouter's output: strip the temporary lane members, draw missing association edges and the groups, give the DI its ids back (DI ids within 64 characters)
    const laidOut = await parseXml(result.xml);
    temporary.withdraw(laidOut.definitions);
    const fixed = new Set(missingDi ? new AssociationEdges(laidOut).synthesise() : []);
    const redrawn = new Groups(laidOut.definitions).redraw(laidOut.moddle, groups);
    const placed = new Set([...redrawn.drawn, ...redrawn.kept]);
    diIds.restore(laidOut.definitions);
    return {
      xml: await serialize(laidOut),
      warnings: result.warnings.filter((w) => !(w.code === 'DI_NOT_CREATED' && fixed.has(w.elementId)) && !(w.code === 'GROUP_MEMBERS_NOT_FOUND' && placed.has(w.elementId))),
      expanded: result.expanded,
      ...given,
      ...this.groupNotes(redrawn),
    };
  }

  /** The notes of the groups around nothing a redraw kept at their old place or moved below the drawing (diagram/Groups.ts). */
  private groupNotes({ kept, moved }: RedrawnGroups): { notes?: string[] } {
    const stay = kept.filter((id) => !moved.includes(id));
    const notes: string[] = [];
    if (stay.length) notes.push(stay.length === 1 ? `group ${stay[0]} kept its box: no element inside it is drawn` : `groups ${stay.join(', ')} kept their boxes: no element inside them is drawn`);
    if (moved.length) notes.push(moved.length === 1 ? `group ${moved[0]} moved below the drawing: no element inside it is drawn and the redraw put shapes on its box` : `groups ${moved.join(', ')} moved below the drawing: no element inside them is drawn and the redraw put shapes on their boxes`);
    return notes.length ? { notes } : {};
  }

  /**
   * bpmn-auto-layout on raw XML that already carries the right expansion hints
   * (layoutModel with engine auto). The package is imported on first use, so a
   * browser bundle can load it as a separate chunk only for `engine: 'auto'`.
   */
  private async autoLayout(xml: string, expanded: Set<string> = new Set()): Promise<LayoutResult> {
    const { layoutProcess, LayoutError } = await import('bpmn-auto-layout');
    try {
      const { xml: out, warnings } = await layoutProcess(xml);
      return { xml: out, warnings: warnings.map(this.toWarningInfo), expanded: [...expanded] };
    } catch (err) {
      if (err instanceof LayoutError) {
        throw new ModelError(`Layout failed: ${err.message}`, `LAYOUT_${err.code}`, {
          elementId: err.elementId,
          element: err.elementId,
          relatedElementIds: err.relatedElementIds ?? [],
          related: err.relatedElementIds ?? [],
        });
      }
      throw new ModelError(`Layout failed: ${(err as Error).message}`, 'LAYOUT_ERROR', {
        hint: 'bpmn-auto-layout (alpha) crashed on this model. Write without DI using --no-layout and run `bpmn layout` later, check `bpmn validate` for unusual structure (nodes outside lanes, unreachable nodes), and report the command and file.',
      });
    }
  }
}
