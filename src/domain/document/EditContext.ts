import type { IdConventions } from './ids/IdConventionsReader.js';
import { IdStyle, type IdState } from './ids/IdStyle.js';
import { ChangeSet, type Rename } from './ChangeSet.js';
import type { Doc } from './Doc.js';
import { IdAllocator } from './IdAllocator.js';
import type { El } from './utils/moddle.js';

/** What a running `apply` batch did so far: E_NOT_FOUND points to it. */
export interface BatchContext {
  created: string[];
  /** old id -> new id of renamed flows and of created elements that were retyped */
  renamed: Map<string, string>;
  /** old ids in `renamed` that a retype or a trigger change gave a new prefix */
  retyped?: Set<string>;
  aliases: () => Record<string, string>;
}

export type FlowEnds = readonly [El | undefined, El | undefined];

/**
 * `was`: the ends `A -> B` the kept id named; `preferred`: the id an op wanted while the flow
 * ends at `target` (`add --flow-id` on a splice), which W_FLOW_ID_STALE suggests.
 */
export interface KeptFlow {
  was: string;
  id: string;
  preferred?: { id: string; target: El };
}

/** What a node was called as a flow end before `set` gave it another id or name. */
export interface FormerEnd {
  id: string;
  labels: readonly string[];
}

export interface KeptIdState {
  before: IdState;
  wasLabel: string;
}

/** Content a retype removed because the new kind cannot hold it. */
export interface DroppedContent {
  element: string;
  kind: string;
  /** children, nested content and their flows */
  removed: string[];
}

/** Undefined settings fall back to the document's. */
export interface EditSettings {
  conventions?: IdConventions;
  /** so the ops follow the same engine as the profile that reports on them */
  platformChoice?: 'c7' | 'c8' | 'none';
  keepFlowIds?: boolean;
}

/**
 * The state of one edit of a Doc: the call's settings and what the running batch (or a single
 * op) recorded so far (ids given out, renames, kept flows, former flow ends, dropped content).
 */
export class EditContext {
  batch: BatchContext | undefined;
  private flows: ReadonlyMap<El, FlowEnds> | undefined;
  private renames: Rename[] = [];
  private keptFlows = new Map<El, KeptFlow>();
  private readonly formerEnds = new Map<El, FormerEnd[]>();
  private idStates = new Map<string, KeptIdState>();
  private readonly dropped: DroppedContent[] = [];
  private style: IdStyle | undefined;

  readonly allocator: IdAllocator;

  constructor(
    private readonly doc: Doc,
    private readonly settings: EditSettings = {},
  ) {
    this.allocator = new IdAllocator(doc, () => this.idStyle);
  }

  get conventions(): IdConventions | undefined {
    return this.settings.conventions ?? this.doc.conventions;
  }

  /** Undefined to detect the platform. */
  get platformChoice(): EditSettings['platformChoice'] {
    return this.settings.platformChoice;
  }

  get followFlowEnds(): boolean {
    return this.settings.keepFlowIds === undefined ? this.doc.followFlowEnds : !this.settings.keepFlowIds;
  }

  /** The document's own, or one learned on first use for conventions the call brings itself. */
  get idStyle(): IdStyle {
    if (this.style) return this.style;
    const own = this.ownConventions;
    return own ? (this.style = IdStyle.infer(this.doc.definitions, own)) : this.doc.ownIdStyle;
  }

  private get ownConventions(): IdConventions | undefined {
    const conventions = this.settings.conventions;
    return conventions !== undefined && conventions !== this.doc.conventions ? conventions : undefined;
  }

  /**
   * Learns the id style now, before an op removes the elements it learns from: a batch whose
   * first op removes flows could otherwise read another style from what is left.
   */
  begin(): void {
    this.keptFlows.clear();
    this.idStates.clear();
    this.allocator.begin();
    this.formerEnds.clear();
    this.style = this.idStyle;
    this.flows = this.followFlowEnds ? undefined : new Map(this.doc.allSequenceFlows().map((flow) => [flow, [flow.get<El | undefined>('sourceRef'), flow.get<El | undefined>('targetRef')]] as const));
  }

  /** Conventions the call brought itself must not stick: the document relearns its style. */
  close(): void {
    if (this.ownConventions) this.doc.forgetIdStyle();
  }

  /** With flow ids kept: the flows at begin(), the only ones keeping their id, with their ends. */
  get flowsBefore(): ReadonlyMap<El, FlowEnds> | undefined {
    return this.flows;
  }

  /** `was`: what the old id named (a flow's old ends); `el` limits the rewrite to its entries. */
  recordRename(from: string, to: string, was?: string, el?: El): void {
    this.renames.push(ChangeSet.about({ from, to, ...(was ? { was } : {}) }, el));
  }

  /** An element the batch created took another id: its entries, notes and warnings follow it. */
  recordRegenerated(from: string, to: string, was?: string, el?: El): void {
    this.renames.push(ChangeSet.about({ from, to, ...(was ? { was } : {}), regenerated: true as const }, el));
  }

  takeRenames(): Rename[] {
    const out = this.renames;
    this.renames = [];
    return out;
  }

  /** With flow ids kept, flows the document had before the batch keep their id. */
  keepsFlowId(flow: El): boolean {
    return !this.followFlowEnds && !!flow.get<string | undefined>('id') && (this.flows?.has(flow) ?? true);
  }

  /** The first ends stay while the flow has the id it kept; a flow renamed since keeps a new id. */
  recordKeptFlow(flow: El, was: string): void {
    const id = flow.get<string>('id');
    if (this.keptFlows.get(flow)?.id !== id) this.keptFlows.set(flow, { was, id });
  }

  /** So W_FLOW_ID_STALE suggests the id the op wanted; false for a flow that was not kept. */
  preferFlowId(flow: El, id: string, target: El): boolean {
    const kept = this.keptFlows.get(flow);
    if (!kept || kept.id !== flow.get<string>('id')) return false;
    kept.preferred = { id, target };
    return true;
  }

  takeKeptFlows(): Map<El, KeptFlow> {
    const out = this.keptFlows;
    this.keptFlows = new Map();
    return out;
  }

  /** A flow id naming the node by its former id or name still names its ends this batch. */
  recordFormerEnd(node: El, end: FormerEnd): void {
    const list = this.formerEnds.get(node) ?? [];
    if (!list.some((existing) => existing.id === end.id && existing.labels.join('\n') === end.labels.join('\n'))) list.push(end);
    this.formerEnds.set(node, list);
  }

  formerEndsOf(node: El): readonly FormerEnd[] {
    return this.formerEnds.get(node) ?? [];
  }

  /** A retype to another type builds a new element: what was recorded moves to `next`. */
  replaceElement(old: El, next: El): void {
    ChangeSet.recordReplacement(old, next);
    const former = this.formerEnds.get(old);
    if (!former) return;
    this.formerEnds.delete(old);
    for (const end of former) this.recordFormerEnd(next, end);
  }

  /** The first record stays, so a batch compares the state before it with the one after. */
  recordIdState(id: string, before: IdState, wasLabel: string): void {
    if (!this.idStates.has(id)) this.idStates.set(id, { before, wasLabel });
  }

  takeIdStates(): Map<string, KeptIdState> {
    const out = this.idStates;
    this.idStates = new Map();
    return out;
  }

  /** The batch (EditBatchService) refuses dropped content with E_WOULD_DROP_CONTENT. */
  recordDroppedContent(drop: DroppedContent): void {
    this.dropped.push(drop);
  }

  get droppedContent(): readonly DroppedContent[] {
    return this.dropped;
  }
}
