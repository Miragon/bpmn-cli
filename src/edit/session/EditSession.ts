import { type BpmnDocument, type BpmnElement, ChangeEntries, ElementWalk, type IdAllocator, type IdConventions, type IdStyle, type LayoutRequests, type Platform } from '../../model/index.js';
import { EditJournal } from './EditJournal.js';

export interface BatchContext {
  created: string[];
  renamed: Map<string, string>;
  retyped?: Set<string>;
  aliases: () => Record<string, string>;
}

export interface FormerEnd {
  id: string;
  labels: readonly string[];
}

export class EditSession {
  batch: BatchContext | undefined;
  readonly allocator: IdAllocator;
  readonly journal = new EditJournal();
  private readonly formerEnds = new Map<BpmnElement, FormerEnd[]>();
  private readonly requestedExpansions = new Map<BpmnElement, boolean>();

  constructor(
    readonly document: BpmnDocument,
    private readonly platformChoice?: Platform,
  ) {
    this.allocator = document.ids;
  }

  get conventions(): IdConventions | undefined {
    return this.document.conventions;
  }

  get idStyle(): IdStyle {
    return this.document.idStyle;
  }

  platform(): Platform {
    return this.platformChoice ?? this.document.platform();
  }

  require(id: string, expect?: string | string[], what = 'element'): BpmnElement {
    return this.document.tree.require(id, expect, what, this.batch);
  }

  requireScope(id: string | undefined): BpmnElement {
    return this.document.scopes.requireScope(id, this.batch);
  }

  releaseIdsBelow(root: BpmnElement): void {
    for (const element of new ElementWalk(root).depthFirst({ bpmnOnly: true })) {
      const id = element.get<string | undefined>('id');
      if (id) {
        this.allocator.registry.release(id);
      }
    }
  }

  begin(): void {
    this.journal.clearIdStates();
    this.allocator.begin();
    this.formerEnds.clear();
    this.requestedExpansions.clear();
  }

  requestExpansion(subProcess: BpmnElement, expanded: boolean, layout: LayoutRequests): void {
    this.requestedExpansions.set(subProcess, expanded);
    layout.expand(subProcess.id, expanded);
  }

  isCollapsed(subProcess: BpmnElement): boolean {
    const expanded = this.requestedExpansions.get(subProcess) ?? this.document.diagram.expansionState().get(subProcess.id) ?? true;
    return !expanded;
  }

  recordFormerEnd(node: BpmnElement, end: FormerEnd): void {
    const list = this.formerEnds.get(node) ?? [];
    if (!list.some((existing) => existing.id === end.id && existing.labels.join('\n') === end.labels.join('\n'))) {
      list.push(end);
    }
    this.formerEnds.set(node, list);
  }

  formerEndsOf(node: BpmnElement): readonly FormerEnd[] {
    return this.formerEnds.get(node) ?? [];
  }

  replaceElement(old: BpmnElement, next: BpmnElement): void {
    ChangeEntries.recordReplacement(old, next);
    const former = this.formerEnds.get(old);
    if (!former) {
      return;
    }
    this.formerEnds.delete(old);
    for (const end of former) {
      this.recordFormerEnd(next, end);
    }
  }
}
