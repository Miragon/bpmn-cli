import { BpmnError, DrawingIds, ModelError, type BpmnDocument, type ChangeSet } from '../model/index.js';
import { DiagramColors } from './diagram/DiagramColors.js';
import { Stickies, type MovedSticky } from './diagram/Stickies.js';
import type { DrawingSnapshot } from './DrawingSnapshot.js';
import type { LayoutWarning } from './full/FullLayout.js';
import { Groups } from './groups/Groups.js';
import { IncrementalLayout, type IncrementalReport } from './incremental/IncrementalLayout.js';
import { DrawingOperationRunner, type DrawnOperation, type FormatResult } from './runners/DrawingOperationRunner.js';

export type DrawingMode = 'full' | 'incremental' | 'kept';

export interface DrawingReport extends IncrementalReport {
  mode: DrawingMode;
  warnings: LayoutWarning[];
  expanded: string[];
  format: FormatResult[];
  stickies: MovedSticky[];
}

type Layout = Omit<DrawingReport, 'format' | 'stickies'>;

export class DiagramDrawing {
  private static readonly RETRY_HINT = 'End the batch with a `layout` operation, which redraws the whole diagram, and report the operations and the file.';

  constructor(private readonly document: BpmnDocument) {}

  private static untouched(mode: DrawingMode): Layout {
    return { mode, warnings: [], expanded: [], placed: [], moved: [], rerouted: [], reshaped: [], pruned: [], notes: [] };
  }

  async update(before: DrawingSnapshot, changes: ChangeSet, operations: readonly DrawnOperation[]): Promise<DrawingReport> {
    const layout = await this.draw(before, changes, operations);
    const redrawn = this.layoutResults(before, operations);
    const format = [...redrawn, ...new DrawingOperationRunner(this.document).run(operations, layout.mode === 'kept')].sort((first, second) => first.index - second.index);
    const stickies = new Stickies(this.document.tree.definitions).follow(before.resolvedAnchors(this.document));
    return { ...layout, format, stickies };
  }

  private layoutResults(before: DrawingSnapshot, operations: readonly DrawnOperation[]): FormatResult[] {
    const index = operations.findIndex(({ op }) => op === 'layout');
    return index === -1 ? [] : [{ op: 'layout', index, ...before.redrawnIn(this.document) }];
  }

  private draw(before: DrawingSnapshot, changes: ChangeSet, operations: readonly DrawnOperation[]): Promise<Layout> {
    if (before.isEmpty() || operations.some(({ op }) => op === 'layout')) {
      return this.drawInFull(changes);
    }
    const onlyDrawingOperations = operations.length > 0 && changes.isEmpty && !changes.relocated.length && !this.hasExpansions(changes);
    return onlyDrawingOperations ? Promise.resolve(DiagramDrawing.untouched('kept')) : this.placeChanges(before, changes);
  }

  private hasExpansions({ expansions }: ChangeSet): boolean {
    const { expand, collapse } = expansions.expansion();
    return expand.length + collapse.length > 0;
  }

  private async drawInFull(changes: ChangeSet): Promise<Layout> {
    const { FullLayout } = await import('./full/FullLayout.js');
    const colors = new DiagramColors(this.document.tree);
    const remembered = colors.read();
    const { warnings, expanded, givenIds, notes } = new FullLayout(this.document, changes.expansions).draw();
    this.document.tree.invalidate();
    colors.apply(remembered);
    for (const { id, kind, name } of givenIds) {
      changes.change({ id, kind, ...(name ? { name } : {}), detail: 'id added (it had none; the diagram refers to elements by id)' });
    }
    if (givenIds.length) {
      changes.note(`${givenIds.length} element(s) without id got one in the id conventions so that the redrawn diagram can show them: ${givenIds.map(({ id }) => id).join(', ')}`);
    }
    return { ...DiagramDrawing.untouched('full'), warnings, expanded, notes };
  }

  private async placeChanges(before: DrawingSnapshot, changes: ChangeSet): Promise<Layout> {
    const report = await this.placeOrRefuse(before, changes);
    const { tree } = this.document;
    const groups = new Groups(tree);
    const ids = new DrawingIds(tree.definitions);
    const { drawn } = groups.redraw(groups.undrawn(), (id) => ids.shape(id));
    this.relabelRenamedGroups(before, groups);
    return { ...DiagramDrawing.untouched('incremental'), ...report, placed: [...report.placed, ...drawn] };
  }

  private async placeOrRefuse(before: DrawingSnapshot, changes: ChangeSet): Promise<IncrementalReport> {
    try {
      return await new IncrementalLayout(this.document, before).place(changes);
    } catch (error) {
      if (error instanceof BpmnError) {
        throw error;
      }
      throw BpmnError.from(new ModelError(`Incremental layout failed: ${BpmnError.firstLine(error)}`, 'LAYOUT_INCREMENTAL', { hint: DiagramDrawing.RETRY_HINT }));
    }
  }

  private relabelRenamedGroups(before: DrawingSnapshot, groups: Groups): void {
    for (const [group, name] of before.groupNames) {
      if ((group.name ?? '') !== name) {
        groups.relabel(group, group.name ?? '');
      }
    }
  }
}
