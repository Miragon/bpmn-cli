/**
 * The state of one edit of a Doc: the settings of the call (declared id
 * conventions, an explicit platform, whether flow ids are kept) and what the
 * running batch or op on its own recorded so far (generated, suffixed and
 * declared ids, renames, kept flows, former flow ends, kept ids of retyped
 * elements, dropped content). The edit transaction
 * (pipeline/EditTransaction.ts) makes one per call, OpRunner one per runOp /
 * runOps of its own; while ops run it is the document's (Doc.edit), between
 * runs the document keeps one of its own for ops called directly.
 */
import type { IdConventions } from '../ids/conventions.js';
import { withSuffix } from '../ids/slugs.js';
import { IdStyle, type IdRequest, type IdState } from '../ids/style.js';
import { ChangeSet, type Rename } from './ChangeSet.js';
import type { Doc } from './Doc.js';
import type { El } from './utils/moddle.js';

/** What a running `apply` batch did so far (OpRunner.runBatch): E_NOT_FOUND points to it. */
export interface BatchContext {
  /** ids the ops before created, in order */
  created: string[];
  /** old id -> new id of the flows the ops before renamed (ops/flows.ts followEnds), and of the elements they created and retyped (ops/set.ts recordIdState) */
  renamed: Map<string, string>;
  /** the old ids in `renamed` of elements a retype or a trigger change gave a new prefix (Rename.regenerated) */
  retyped?: Set<string>;
  /** the batch aliases defined so far -> current ids */
  aliases: () => Record<string, string>;
}

/** A sequence flow's ends (sourceRef, targetRef) when a batch or an op on its own began (EditContext.flowsBefore). */
export type FlowEnds = readonly [El | undefined, El | undefined];

/**
 * A flow that kept its id (EditContext.recordKeptFlow): the ends `A -> B`
 * that id named, and the id; `preferred`: the id an op wanted for it while
 * it ends at `target` (`add --flow-id` on a splice, EditContext.preferFlowId),
 * which W_FLOW_ID_STALE suggests.
 */
export interface KeptFlow {
  was: string;
  id: string;
  preferred?: { id: string; target: El };
}

/**
 * What a node was called as the end of sequence flows before `set` gave it
 * another id or name in the running batch or op on its own
 * (EditContext.recordFormerEnd): its id and its labels (ops/flows.ts endLabels).
 */
export interface FormerEnd {
  id: string;
  labels: readonly string[];
}

/** What an element was when a retype or a trigger change first kept its id (EditContext.recordIdState): its type and trigger, and its kind label. */
export interface KeptIdState {
  before: IdState;
  wasLabel: string;
}

/** Content a retype removed because the new kind cannot hold it. */
export interface DroppedContent {
  /** the retyped element */
  element: string;
  /** its new kind */
  kind: string;
  /** ids of every removed element (children, nested content, their flows) */
  removed: string[];
}

/** The settings of one call (MutationOptions); undefined ones are the document's. */
export interface EditSettings {
  /** the declared id conventions of the call (MutationOptions.conventions), over Doc.conventions */
  conventions?: IdConventions;
  /** an explicit platform (MutationOptions.platform other than auto), so the ops follow the same engine as the profile that reports on them */
  platformChoice?: 'c7' | 'c8' | 'none';
  /** MutationOptions.keepFlowIds, over Doc.followFlowEnds */
  keepFlowIds?: boolean;
}

export class EditContext {
  /** set while an `apply` batch runs (OpRunner.runBatch): E_NOT_FOUND names what it created and renamed */
  batch: BatchContext | undefined;
  private flows: ReadonlyMap<El, FlowEnds> | undefined;
  /** generated ids that took a collision suffix since the last reportSuffixed() (W_ID_SUFFIXED) */
  private suffixed: Array<{ id: string; base: string }> = [];
  /** ids renamed since the last takeRenames() (a flow whose id named its old ends, ops/flows.ts followEnds) */
  private renames: Rename[] = [];
  /** flows that kept an id naming their old ends since the last takeKeptFlows() -> those ends (`A -> B`) and that id, for W_FLOW_ID_STALE */
  private keptFlows = new Map<El, KeptFlow>();
  /** nodes `set` gave another id or name since the batch or the op on its own began -> what they were called before, as flow ends */
  private readonly formerEnds = new Map<El, FormerEnd[]>();
  /** generated ids under a declared prefix that the file's own style would give otherwise */
  private readonly declared: string[] = [];
  /** elements a retype or a trigger change kept the id of since the last takeIdStates() -> their type and trigger before the first, for W_ID_PREFIX_STALE */
  private idStates = new Map<string, KeptIdState>();
  /** the ids allocateId generated since the batch or the op on its own began -> the id each wanted: nobody's API yet */
  private readonly generatedIds = new Map<string, string>();
  private readonly dropped: DroppedContent[] = [];
  /** the id style of the running batch or op on its own (begin), or the one learned for conventions of the call's own (see idStyle) */
  private style: IdStyle | undefined;

  constructor(
    private readonly doc: Doc,
    private readonly settings: EditSettings = {},
  ) {}

  /** The declared id conventions new ids follow: the call's, else the document's (Doc.conventions). */
  get conventions(): IdConventions | undefined {
    return this.settings.conventions ?? this.doc.conventions;
  }

  /** The explicit platform of the call (Doc.platform answers it), undefined to detect it. */
  get platformChoice(): EditSettings['platformChoice'] {
    return this.settings.platformChoice;
  }

  /**
   * Whether a flow whose id names its ends is renamed when an op changes
   * them (ops/flows.ts followEnds): MutationOptions.keepFlowIds decides for
   * the call, else Doc.followFlowEnds.
   */
  get followFlowEnds(): boolean {
    return this.settings.keepFlowIds === undefined ? this.doc.followFlowEnds : !this.settings.keepFlowIds;
  }

  /**
   * The id style new ids follow (src/ids/style.ts): the document's own
   * (Doc.ownIdStyle), or, for declared conventions of the call other than
   * the document's, one learned for them on first use.
   */
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
   * A batch or an op on its own begins: what an earlier one recorded is
   * forgotten, the id style is learned now (before an op removes the elements
   * it learns from: otherwise a batch whose first op removes flows could read
   * another style from what is left, name new elements in it and miss a flow
   * whose id names its old ends), and with flow ids kept the sequence flows
   * the document has now are the only ones that keep their id (a flow the
   * batch or op creates follows its ends), with their ends now.
   */
  begin(): void {
    this.keptFlows.clear();
    this.idStates.clear();
    this.generatedIds.clear();
    this.formerEnds.clear();
    this.style = this.idStyle;
    this.flows = this.followFlowEnds ? undefined : new Map(this.doc.allSequenceFlows().map((f) => [f, [f.get<El | undefined>('sourceRef'), f.get<El | undefined>('targetRef')]] as const));
  }

  /**
   * The call ends: one with declared conventions of its own leaves the
   * document to learn its own id style again on its next use, like setting
   * other conventions does (Doc.conventions).
   */
  close(): void {
    if (this.ownConventions) this.doc.forgetIdStyle();
  }

  /**
   * With ids kept (followFlowEnds false): the sequence flows the document
   * had when the running batch or op began (begin), the only ones that keep
   * their id (keepsFlowId), with the ends they had then (a flow that ends
   * there again is not stale: ops/flows.ts staleFlowWarning).
   */
  get flowsBefore(): ReadonlyMap<El, FlowEnds> | undefined {
    return this.flows;
  }

  /**
   * A new id in the style (idStyle) for a kindRequest / typeRequest /
   * connectionRequest / flowRequest; claims it. `base` is the id the
   * request wanted: when it was taken the id carries a suffix, which is
   * recorded for W_ID_SUFFIXED (reportSuffixed). An id under a prefix the
   * declared conventions name for the request (IdStyle.explain: `lint`;
   * not one they only shaped, nor a message flow that borrows the sequence
   * flows' prefix) that the file's own style would give otherwise is
   * recorded for the result's `conventions:` line (declaredIds), in a file
   * that has a style of its own there (IdStyle.ownStyleDiffers: ids the
   * conventions check that do not follow them; not a new file, nor one
   * whose checked ids all follow them).
   */
  allocateId(req: IdRequest): { id: string; base: string } {
    const style = this.idStyle;
    const ids = this.doc.ids;
    const out = style.next(req, ids);
    if (style.ownStyleDiffers && style.explain(req).source === 'lint' && out.base !== style.learnedOnly().next(req, ids).base) this.declared.push(out.id);
    ids.claim(out.id);
    this.generatedIds.set(out.id, out.base);
    if (out.id !== out.base) this.suffixed.push(out);
    return out;
  }

  /**
   * The id `id` wanted (before a collision suffix) where allocateId (or
   * markGenerated) generated it since the batch or the op on its own began
   * and no explicit claim took it since (Doc.claimId): nobody's API yet
   * (ops/set.ts recordIdState renames it where a retype leaves its prefix
   * stale); undefined for every other id.
   */
  generatedBase(id: string): string | undefined {
    return this.generatedIds.get(id);
  }

  /** Records `id` as generated from `base` outside allocateId (a split's join, an id recordIdState gave): generatedBase. */
  markGenerated(id: string, base: string): void {
    this.generatedIds.set(id, base);
  }

  /** An explicit claim took `id` (Doc.claimId): the caller's, so no longer generated (generatedBase). */
  forgetGenerated(id: string): void {
    this.generatedIds.delete(id);
  }

  /**
   * A free id from `base` for an element whose generated id `old` a retype
   * or a trigger change gave a stale prefix (ops/set.ts recordIdState): a
   * taken one gets a collision suffix after `sep` (cut to stay within
   * MAX_ID; W_ID_SUFFIXED); on the result's `conventions:` line where
   * `old` was. Claims nothing (renameId does; markGenerated after it).
   */
  regeneratedId(old: string, base: string, sep: string): string {
    let id = base;
    for (let n = 2; this.doc.has(id) || this.doc.ids.has(id); n++) id = withSuffix(base, sep, n);
    if (id !== base) this.suffixed.push({ id, base });
    if (this.declared.includes(old)) this.declared.push(id);
    return id;
  }

  /** Records an id under a declared prefix that the file's own style would give otherwise, outside allocateId (a split's join), where the file has a style of its own there (IdStyle.ownStyleDiffers). */
  recordDeclaredId(id: string): void {
    if (this.idStyle.ownStyleDiffers) this.declared.push(id);
  }

  /** The ids under a declared prefix recorded so far (allocateId; the edit transaction reports those still in the document). */
  get declaredIds(): readonly string[] {
    return this.declared;
  }

  /** W_ID_SUFFIXED on `cs` for every generated id that took a collision suffix since the last call (the id it wanted was taken). */
  reportSuffixed(cs: ChangeSet): void {
    const suffixed = this.suffixed;
    this.suffixed = [];
    for (const { id, base } of suffixed) {
      if (cs.warnings.some((w) => w.code === 'W_ID_SUFFIXED' && w.element === id)) continue;
      cs.warn({
        code: 'W_ID_SUFFIXED',
        message: `Id ${base} is already taken; using ${id}`,
        element: id,
        hint: 'Pass an explicit id to choose it yourself (--id, "id"; --flow-id / "flowId" for the flow into a new node, "joinId" for a join), or give the element a distinct name.',
      });
    }
  }

  /**
   * Records that an op renamed an element (OpRunner rewrites the op's
   * change entries; `el`: only those of that element, ChangeSet.rename);
   * `was`: what the old id named (a flow's old ends).
   */
  recordRename(from: string, to: string, was?: string, el?: El): void {
    this.renames.push(ChangeSet.about({ from, to, ...(was ? { was } : {}) }, el));
  }

  /**
   * Records that an element the batch created took another id
   * (regeneratedId), or a flow the batch named after it followed (`was`:
   * the flow's ends before): the entries, their details, notes and
   * warnings name it by the new one (Rename.regenerated).
   */
  recordRegenerated(from: string, to: string, was?: string, el?: El): void {
    this.renames.push(ChangeSet.about({ from, to, ...(was ? { was } : {}), regenerated: true as const }, el));
  }

  /** The renames since the last call. */
  takeRenames(): Rename[] {
    const out = this.renames;
    this.renames = [];
    return out;
  }

  /**
   * Whether `flow` keeps its id when an op gives it other ends: with ids kept
   * (followFlowEnds false) a flow the document had before the batch or the op
   * on its own (flowsBefore). ops/flows.ts followEnds keeps it instead of
   * renaming it; ops/move.ts puts a moved node's old out-flow back at the new
   * place instead of creating a new one. A flow without id has none to keep.
   */
  keepsFlowId(flow: El): boolean {
    return !this.followFlowEnds && !!flow.get<string | undefined>('id') && (this.flows?.has(flow) ?? true);
  }

  /**
   * Records that a flow kept an id that named its old ends `was` (ops/flows.ts
   * followEnds with followFlowEnds false). The first ends stay while the flow
   * has the id it kept; a flow renamed since (`set id=`) keeps a new id.
   */
  recordKeptFlow(flow: El, was: string): void {
    const id = flow.get<string>('id');
    if (this.keptFlows.get(flow)?.id !== id) this.keptFlows.set(flow, { was, id });
  }

  /**
   * Gives a flow kept since the last takeKeptFlows() (with the id it kept)
   * the id an op wanted for it while it ends at `target` (`add --flow-id` on
   * a splice: the flow into the new node is the kept one), so that its
   * W_FLOW_ID_STALE suggests that id and one command renames it. False for
   * a flow that was not kept.
   */
  preferFlowId(flow: El, id: string, target: El): boolean {
    const kept = this.keptFlows.get(flow);
    if (!kept || kept.id !== flow.get<string>('id')) return false;
    kept.preferred = { id, target };
    return true;
  }

  /** The flows kept since the last call, with the ends their id named and that id (reportStaleFlows turns them into W_FLOW_ID_STALE). */
  takeKeptFlows(): Map<El, KeptFlow> {
    const out = this.keptFlows;
    this.keptFlows = new Map();
    return out;
  }

  /**
   * Records what a node was called as a flow end (`end`: its id and labels)
   * before `set` gives it another id or name (ops/flows.ts recordFormerEnd):
   * a flow whose id named it so still names its ends (idNamesEnds) until
   * the batch or the op on its own ends.
   */
  recordFormerEnd(node: El, end: FormerEnd): void {
    const list = this.formerEnds.get(node) ?? [];
    if (!list.some((e) => e.id === end.id && e.labels.join('\n') === end.labels.join('\n'))) list.push(end);
    this.formerEnds.set(node, list);
  }

  /** What `node` was called as a flow end before `set` changed its id or name in the running batch or op on its own (recordFormerEnd). */
  formerEndsOf(node: El): readonly FormerEnd[] {
    return this.formerEnds.get(node) ?? [];
  }

  /**
   * `next` took the place of `old` (a retype that changes the type builds a
   * new element, ops/retype.ts swapType): what the running batch recorded
   * about `old` is about `next`, its former ends (recordFormerEnd) and the
   * change entries made for it (ChangeSet.recordReplacement).
   */
  replaceElement(old: El, next: El): void {
    ChangeSet.recordReplacement(old, next);
    const former = this.formerEnds.get(old);
    if (!former) return;
    this.formerEnds.delete(old);
    for (const end of former) this.recordFormerEnd(next, end);
  }

  /**
   * Records what an element was (`before`, `wasLabel`) when a retype or a
   * trigger change kept its id `id` (ops/set.ts recordIdState); the first
   * record of an id stays, so a batch compares its state before the batch
   * with the one after.
   */
  recordIdState(id: string, before: IdState, wasLabel: string): void {
    if (!this.idStates.has(id)) this.idStates.set(id, { before, wasLabel });
  }

  /** The ids recorded since the last call, with what their elements were (reportStaleIdPrefixes turns them into W_ID_PREFIX_STALE). */
  takeIdStates(): Map<string, KeptIdState> {
    const out = this.idStates;
    this.idStates = new Map();
    return out;
  }

  /** Records content a retype removed because the new kind cannot hold it (the edit transaction refuses it: E_WOULD_DROP_CONTENT). */
  recordDroppedContent(drop: DroppedContent): void {
    this.dropped.push(drop);
  }

  /** The content retypes removed so far. */
  get droppedContent(): readonly DroppedContent[] {
    return this.dropped;
  }
}
