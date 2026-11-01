import { type BpmnDocument, type BpmnElement, ChangeEntries, type IdAllocator, type IdConventions, type IdState, type IdStyle, type Platform, type Rename } from '../../model/index.js';

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

export interface KeptIdState {
  before: IdState;
  wasLabel: string;
}

export interface DroppedContent {
  element: string;
  kind: string;
  removed: string[];
}


export class EditSession {
  batch: BatchContext | undefined;
  readonly allocator: IdAllocator;
  private renames: Rename[] = [];
  private readonly formerEnds = new Map<BpmnElement, FormerEnd[]>();
  private idStates = new Map<string, KeptIdState>();
  private readonly dropped: DroppedContent[] = [];

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

  begin(): void {
    this.idStates.clear();
    this.allocator.begin();
    this.formerEnds.clear();
  }

  recordRename(from: string, to: string, was?: string, el?: BpmnElement): void {
    this.renames.push(ChangeEntries.about({ from, to, ...(was ? { was } : {}) }, el));
  }

  recordRegenerated(from: string, to: string, was?: string, el?: BpmnElement): void {
    this.renames.push(ChangeEntries.about({ from, to, ...(was ? { was } : {}), regenerated: true as const }, el));
  }

  takeRenames(): Rename[] {
    const out = this.renames;
    this.renames = [];
    return out;
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

  recordIdState(id: string, before: IdState, wasLabel: string): void {
    if (!this.idStates.has(id)) {
      this.idStates.set(id, { before, wasLabel });
    }
  }

  takeIdStates(): Map<string, KeptIdState> {
    const out = this.idStates;
    this.idStates = new Map();
    return out;
  }

  recordDroppedContent(drop: DroppedContent): void {
    this.dropped.push(drop);
  }

  get droppedContent(): readonly DroppedContent[] {
    return this.dropped;
  }
}
