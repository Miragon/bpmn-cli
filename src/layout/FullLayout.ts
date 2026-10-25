import type { LayoutWarning } from 'bpmn-auto-layout';
import { DrawnElementIds, type GivenId } from '../drawing/DrawnElementIds.js';
import { Groups, type RedrawnGroups } from '../drawing/Groups.js';
import { diIdsFit } from '../drawing/utils/di-ids.js';
import { DiIdMemo } from '../drawing/DiIdMemo.js';
import type { IdRequest } from '../ids/utils/requests.js';
import { CleanEngine } from './clean/CleanEngine.js';
import { addTo, layoutRoot, parseXml, serialize, type El, type Model, idOf } from '../model/utils/moddle.js';
import { resolveExpanded, subProcesses } from '../drawing/utils/expansion.js';
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
  /** claims an id for a drawn element that has none (default: the file's id style) */
  allocateId?: (req: IdRequest) => string;
}

export interface LayoutResult {
  xml: string;
  warnings: LayoutWarningInfo[];
  expanded: string[];
  /** elements without id that got one so that the diagram can refer to them */
  givenIds?: GivenId[];
  /** what the caller should know about the drawing (a group around nothing kept or moved) */
  notes?: string[];
}

/**
 * Replaces a model's DI with a fresh drawing from the clean or the auto engine.
 * Sub-processes stay expanded unless the old DI collapsed them; DI ids and group boxes survive.
 * Works around bpmn-auto-layout crashing on laneless nodes and skipping some association edges.
 */
export class FullLayout {
  constructor(
    private readonly model: Model,
    private readonly opts: LayoutOptions = {},
  ) {}

  /** bpmn-auto-layout only reads `isExpanded` from old DI, so the hint diagram holds just that. */
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

  /** Clobbers the model's in-memory DI; treat the returned XML as the truth. */
  async run(): Promise<LayoutResult> {
    // never bpmnElement="undefined"
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
    // without old DI the layouter's ids stand unless a DI id would exceed 64 characters
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

  private groupNotes({ kept, moved }: RedrawnGroups): { notes?: string[] } {
    const stay = kept.filter((id) => !moved.includes(id));
    const notes: string[] = [];
    if (stay.length) notes.push(stay.length === 1 ? `group ${stay[0]} kept its box: no element inside it is drawn` : `groups ${stay.join(', ')} kept their boxes: no element inside them is drawn`);
    if (moved.length) notes.push(moved.length === 1 ? `group ${moved[0]} moved below the drawing: no element inside it is drawn and the redraw put shapes on its box` : `groups ${moved.join(', ')} moved below the drawing: no element inside them is drawn and the redraw put shapes on their boxes`);
    return notes.length ? { notes } : {};
  }

  /** Imported on first use so a browser bundle loads bpmn-auto-layout only for `engine: 'auto'`. */
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
