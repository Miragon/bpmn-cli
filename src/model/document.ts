/**
 * A loaded BPMN document: the semantic model plus the indexes and invariants
 * every operation relies on (id registry, containment lookups, lane lookups).
 *
 * Ids: the registry and the lookups cover BPMN and DI elements only (DI ids
 * are reserved but not resolvable); ids of vendor extension elements are
 * vendor data (see moddle.ts) and never resolve: `require` answers E_NOT_FOUND
 * naming the vendor element and its BPMN owner instead.
 */
import type { ImportWarning } from 'bpmn-moddle';
import type { BpmnModdle } from 'bpmn-moddle';
import { modelError, ioError, usageError } from '../shared/utils/errors.js';
import { about, replaced, type ChangeSet, type Rename } from './change-set.js';
import { editDistance, typoTolerance } from '../shared/utils/fuzzy.js';
import { hasIdWords, IdRegistry, isValidId, transliterate, withSuffix } from '../ids/slugs.js';
import type { IdConventions } from '../ids/conventions.js';
import { IdStyle, speakingStem, typeRequest, type IdRequest, type IdState } from '../ids/style.js';
import { kindLabel, suggestKinds } from './kinds.js';
import { completeMirrorLists, takeMirrorSnapshot, type MirrorSnapshot } from './mirror.js';
import { createDefinitions, createModdle, indexById, is, isBpmnElement, many, parseXml, processes as rootProcesses, collaboration as rootCollaboration, layoutRoot as pickLayoutRoot, serialize, walk, type El, type Model } from './utils/moddle.js';
import { ModelError } from './ModelError.js';
import { C7_DEFAULT_TTL, C7_PLATFORM_VERSION } from '../platform/CamundaDescriptor.js';
import { C8_PLATFORM_VERSION } from '../platform/ZeebeDescriptor.js';
import { PlatformDetection } from '../platform/PlatformDetection.js';

export const KNOWN_NAMESPACES: Record<string, string> = {
  camunda: 'http://camunda.org/schema/1.0/bpmn',
  // Operaton's copy of the camunda namespace (only Operaton reads it)
  operaton: 'http://operaton.org/schema/1.0/bpmn',
  zeebe: 'http://camunda.org/schema/zeebe/1.0',
  modeler: 'http://camunda.org/schema/modeler/1.0',
  bioc: 'http://bpmn.io/schema/bpmn/biocolor/1.0',
  color: 'http://www.omg.org/spec/BPMN/non-normative/color/1.0',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
};

// `duplicate element`: moddle.ts parseXml (an element the schema allows once appears twice; the reader keeps the last)
const LOSSY_PATTERNS = [/unparsable content/i, /unrecognized element/i, /unresolved reference/i, /duplicate ID/i, /^duplicate element/i];

export interface NewDocOptions {
  processId?: string;
  processName?: string;
  executable?: boolean;
  /** declare vendor namespaces and the execution platform up front (and, for camunda7, the Modeler's process defaults) */
  target?: 'camunda8' | 'camunda7' | 'none';
  /**
   * the project's declared id conventions (src/ids/conventions.ts; the node
   * layer reads them from the .bpmnlintrc): the document keeps them
   * (Doc.conventions); the process and definitions ids follow them only
   * where they name bpmn:Process / bpmn:Definitions exactly
   */
  conventions?: IdConventions;
}

/** The values `new --target` (NewDocOptions.target) accepts. */
export const TARGETS = ['camunda8', 'camunda7', 'none'] as const;

/** E_USAGE for a target that is not one of TARGETS (Operaton and CIB seven files are camunda7). */
export function assertTarget(target: unknown): asserts target is NewDocOptions['target'] {
  if (target === undefined || (TARGETS as readonly unknown[]).includes(target)) return;
  throw usageError(`Unknown --target "${String(target)}": expected camunda8 or camunda7`, {
    hint: 'camunda7 also covers CIB seven and Operaton (they read the camunda: namespace); camunda8 is Zeebe. Omit --target for a plain BPMN file.',
  });
}

/** What a document was read from (see Doc.source). */
export interface DocSource {
  /** the XML text as read */
  text: string;
  /** the incoming / outgoing lists as read, before the in-memory repair */
  mirror: MirrorSnapshot;
}

/** An id or name folded for fuzzy matching: lower-case ASCII with ae / oe / ue / ss read as a / o / u / s (ä -> a). */
function foldUmlauts(text: string): string {
  return transliterate(text)
    .toLowerCase()
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/ss/g, 's')
    .replace(/[^a-z0-9]/g, '');
}

/** An id without its prefix (`Activity_CheckInvoice` -> `CheckInvoice`; an id without `_` is its own stem). */
/** The prefix of an id (`flow` of Flow_CheckToBook), lower case; undefined without one. */
function prefixOf(id: string): string | undefined {
  return /^([A-Za-z][A-Za-z0-9]*)_./.exec(id)?.[1]!.toLowerCase();
}

function stemOf(id: string): string {
  const i = id.indexOf('_');
  return i === -1 ? id : id.slice(i + 1);
}

/** What a running `apply` batch did so far (ops/index.ts runBatch): E_NOT_FOUND points to it. */
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

/** A sequence flow's ends (sourceRef, targetRef) when a batch or an op on its own began (Doc.flowsBefore). */
export type FlowEnds = readonly [El | undefined, El | undefined];

/**
 * A flow that kept its id (Doc.recordKeptFlow): the ends `A -> B` that id
 * named, and the id; `preferred`: the id an op wanted for it while it ends
 * at `target` (`add --flow-id` on a splice, Doc.preferFlowId), which
 * W_FLOW_ID_STALE suggests.
 */
export interface KeptFlow {
  was: string;
  id: string;
  preferred?: { id: string; target: El };
}

/**
 * What a node was called as the end of sequence flows before `set` gave it
 * another id or name in the running batch or op on its own
 * (Doc.recordFormerEnd): its id and its labels (ops/flows.ts endLabels).
 */
export interface FormerEnd {
  id: string;
  labels: readonly string[];
}

/** What an element was when a retype or a trigger change first kept its id (Doc.recordIdState): its type and trigger, and its kind label. */
export interface KeptIdState {
  before: IdState;
  wasLabel: string;
}

/** True for elements somewhere below a bpmn:extensionElements container. */
function insideExtension(el: El): boolean {
  for (let p = el.$parent as El | undefined; p; p = p.$parent as El | undefined) if (is(p, 'bpmn:ExtensionElements')) return true;
  return false;
}

/** Throws E_INVALID_ID unless `id` can be a new document's process id (NewDocOptions.processId; `bpmn new --id` checks it first). */
export function assertProcessId(id: string): void {
  if (!isValidId(id)) throw modelError('E_INVALID_ID', `"${id}" is not a valid id (XML NCName)`);
}

/**
 * The ids of a new document's process and definitions (claimed in `ids`):
 * the given process id, else from the name in `style`, else Process_1 (a
 * process prefix the declared conventions name exactly: from it); the
 * definitions speak like the process (Definitions_OrderToCash), a process
 * without name or speaking id gives the tool default Definitions_1.
 */
function rootIds(opts: NewDocOptions, style: IdStyle, ids: IdRegistry): { processId: string; definitionsId: string } {
  const declared = (type: string): boolean => style.explain(typeRequest(type)).source === 'lint';
  const processId = opts.processId ?? (opts.processName || declared('bpmn:Process') ? style.next(typeRequest('bpmn:Process', opts.processName ? { name: opts.processName } : {}), ids).id : 'Process_1');
  assertProcessId(processId);
  ids.claim(processId);
  const stem = speakingStem(processId);
  const definitionsId = hasIdWords(opts.processName)
    ? style.next(typeRequest('bpmn:Definitions', { name: opts.processName }), ids).id
    : stem || declared('bpmn:Definitions')
      ? style.next(typeRequest('bpmn:Definitions', stem ? { context: stem } : {}), ids).id
      : 'Definitions_1';
  ids.claim(definitionsId);
  return { processId, definitionsId };
}

export class Doc {
  private index: Map<string, El> | null = null;
  private style: IdStyle | undefined;
  /** set while an `apply` batch runs (ops/index.ts): E_NOT_FOUND names what it created and renamed */
  batch: BatchContext | undefined;
  /** generated ids that took a collision suffix since the last takeSuffixed() (W_ID_SUFFIXED) */
  private suffixed: Array<{ id: string; base: string }> = [];
  /** ids renamed since the last takeRenames() (a flow whose id named its old ends, ops/flows.ts followEnds) */
  private renamedIds: Rename[] = [];
  /** flows that kept an id naming their old ends since the last takeKeptFlows() -> those ends (`A -> B`) and that id, for W_FLOW_ID_STALE */
  private keptFlows = new Map<El, KeptFlow>();
  /** nodes `set` gave another id or name since the last forgetFormerEnds() -> what they were called before, as flow ends */
  private formerEnds = new Map<El, FormerEnd[]>();
  /** the declared id conventions (see the conventions accessor) */
  private declared: IdConventions | undefined;
  /** generated ids under a declared prefix that the file's own style would give otherwise, since the last takeDeclaredIds() */
  private declaredIds: string[] = [];
  /** elements a retype or a trigger change kept the id of since the last takeIdStates() -> their type and trigger before the first, for W_ID_PREFIX_STALE */
  private idStates = new Map<string, KeptIdState>();
  /** the ids allocateId generated since the last forgetGeneratedIds() (the start of a batch or of an op on its own) -> the id each wanted: nobody's API yet */
  private generatedIds = new Map<string, string>();
  /**
   * Whether a flow whose id names its ends is renamed when an op changes
   * them (ops/flows.ts followEnds). False keeps the id of every flow the
   * document had before the batch (flowsBefore); the batch reports each one
   * whose id no longer names its ends as W_FLOW_ID_STALE (ops/index.ts). The
   * pipeline sets it for one call from MutationOptions.keepFlowIds; its
   * engine-ownership check sets it on a copy to simulate a remove.
   */
  followFlowEnds = true;
  /**
   * with ids kept (followFlowEnds false): the sequence flows the document had
   * before the running batch or op (ops/index.ts runBatch / runOp), the only
   * ones that keep their id (keepsFlowId), with the ends they had then (a
   * flow that ends there again is not stale: ops/flows.ts staleFlowWarning)
   */
  flowsBefore: ReadonlyMap<El, FlowEnds> | undefined;

  private constructor(
    public readonly model: Model,
    public readonly ids: IdRegistry,
    public readonly file: string | undefined,
    /**
     * The text the document was read from and its incoming / outgoing lists
     * at that time (Doc.fromXml, also readDoc / loadDoc of the node layer;
     * undefined for Doc.create): the write pipeline keeps the file's
     * formatting and mirror-list style (xml/preserve.ts, mirror.ts) and reports
     * a result equal to it as `unchanged`.
     */
    public readonly source?: DocSource,
  ) {}

  /* ------------------------------------------------------------ */
  /* construction                                                   */
  /* ------------------------------------------------------------ */

  /**
   * Parses a document. `file` only names it in messages and results (the
   * core never touches the file system; src/node/files.ts readDoc reads one).
   */
  static async fromXml(xml: string, file?: string): Promise<Doc> {
    let model: Model;
    try {
      model = await parseXml(xml);
    } catch (err) {
      if (err instanceof ModelError) throw ioError('E_PARSE', err.message, { ...err.details, file });
      throw err;
    }
    const ids = new IdRegistry(indexById(model.definitions).keys());
    // the mirror lists as read decide what a write keeps (mirror.ts); in memory they are complete
    const mirror = takeMirrorSnapshot(model.definitions);
    completeMirrorLists(model.definitions);
    return new Doc(model, ids, file, { text: xml, mirror });
  }

  static create(opts: NewDocOptions = {}, file?: string): Doc {
    assertTarget(opts.target);
    const moddle = createModdle();
    const ids = new IdRegistry();
    const style = IdStyle.of(opts.conventions);
    const { processId, definitionsId } = rootIds(opts, style, ids);
    const definitions = createDefinitions(moddle, {
      definitionsId,
      processId,
      processName: opts.processName,
      executable: opts.executable ?? true,
    });
    const doc = new Doc({ moddle, definitions, importWarnings: [] }, ids, file);
    // a new file has no id style of its own for the declared conventions to differ from: no `conventions:` line
    // (IdStyle.ownStyleDiffers), also for a process or definitions id under a prefix they name exactly
    if (opts.conventions) doc.conventions = opts.conventions;
    if (opts.target === 'camunda8') {
      doc.declareNamespace('zeebe');
      doc.declareNamespace('modeler');
      definitions.$attrs['modeler:executionPlatform'] = 'Camunda Cloud';
      definitions.$attrs['modeler:executionPlatformVersion'] = C8_PLATFORM_VERSION;
    } else if (opts.target === 'camunda7') {
      doc.declareNamespace('camunda');
      doc.declareNamespace('modeler');
      definitions.$attrs['modeler:executionPlatform'] = 'Camunda Platform';
      definitions.$attrs['modeler:executionPlatformVersion'] = C7_PLATFORM_VERSION;
      doc.initProcess(rootProcesses(definitions)[0]!);
    }
    return doc;
  }

  /**
   * An explicit platform for the running mutation (MutationOptions.platform
   * other than auto; set by pipeline/index.ts mutateDoc around the ops), so the ops
   * follow the same engine as the profile that reports on them.
   */
  platformChoice?: 'c7' | 'c8' | 'none';

  /** The engine the file targets (an explicit platformChoice, else platform/PlatformDetection.ts target). */
  platform(): 'camunda7' | 'camunda8' | undefined {
    if (this.platformChoice) return this.platformChoice === 'c7' ? 'camunda7' : this.platformChoice === 'c8' ? 'camunda8' : undefined;
    return new PlatformDetection(this.definitions).target();
  }

  /**
   * Platform defaults for a process the CLI creates (`new`, a new participant):
   * in a Camunda 7 file camunda:historyTimeToLive="180" like Camunda Modeler,
   * since C7, CIB seven and Operaton refuse to deploy an executable process
   * without a TTL. A file written for Operaton (operaton content, no camunda
   * namespace) gets operaton:historyTimeToLive with its own prefix. An
   * existing value (in either namespace) is never touched.
   */
  initProcess(process: El): void {
    if (this.platform() !== 'camunda7') return;
    const camunda = KNOWN_NAMESPACES['camunda']!;
    const operaton = KNOWN_NAMESPACES['operaton']!;
    const uri = !this.prefixFor(camunda) && this.prefixFor(operaton) ? operaton : camunda;
    for (const u of [camunda, operaton]) {
      const p = this.prefixFor(u);
      if (p && process.$attrs[`${p}:historyTimeToLive`] !== undefined) return;
    }
    const prefix = this.prefixFor(uri) ?? (uri === operaton ? 'operaton' : 'camunda');
    this.declareNamespace(prefix, uri);
    process.$attrs[`${prefix}:historyTimeToLive`] = C7_DEFAULT_TTL;
  }

  /** The prefix bpmn:definitions binds to a namespace URI (undefined when it is not declared there). */
  prefixFor(uri: string): string | undefined {
    for (const [key, value] of Object.entries(this.definitions.$attrs ?? {})) {
      if (key.startsWith('xmlns:') && value === uri) return key.slice('xmlns:'.length);
    }
    return undefined;
  }

  /* ------------------------------------------------------------ */
  /* basics                                                         */
  /* ------------------------------------------------------------ */

  get moddle(): BpmnModdle {
    return this.model.moddle;
  }

  get definitions(): El {
    return this.model.definitions;
  }

  get importWarnings(): ImportWarning[] {
    return this.model.importWarnings;
  }

  /** Import warnings that mean bpmn-moddle dropped content (unsafe to write back). */
  get lossyImportWarnings(): ImportWarning[] {
    return this.importWarnings.filter((w) => LOSSY_PATTERNS.some((p) => p.test(w.message)));
  }

  /** Call after any structural mutation; lookups rebuild lazily. */
  invalidate(): void {
    this.index = null;
  }

  /** Semantic elements by id: diagram interchange is not addressable (the AI never sees DI). */
  byId(): Map<string, El> {
    if (!this.index) this.index = indexById(this.definitions, { semanticOnly: true });
    return this.index;
  }

  get(id: string): El | undefined {
    return this.byId().get(id);
  }

  has(id: string): boolean {
    return this.byId().has(id);
  }

  /**
   * Resolves an id or throws E_NOT_FOUND with "did you mean" candidates.
   * `expect` restricts the type (e.g. 'bpmn:FlowNode') -> E_WRONG_KIND.
   */
  require(id: string, expect?: string | string[], what = 'element'): El {
    const el = this.get(id);
    if (!el) {
      const vendor = this.vendorUses(id);
      if (vendor.length) {
        const owners = [...new Set(vendor.map((v) => v.owner))];
        throw modelError('E_NOT_FOUND', `"${id}" is not a BPMN element: it is the id of ${[...new Set(vendor.map((v) => v.type))].join(', ')} vendor extension data inside ${owners.join(', ')}`, {
          element: id,
          candidates: owners,
          hint: `Vendor extension elements are edited through their BPMN element: \`bpmn ext list <file> ${owners[0]}\`, then \`bpmn ext add|remove <file> ${owners[0]} ...\`.`,
        });
      }
      const renamed = this.batch?.renamed.get(id);
      const candidates = this.suggest(id);
      const alias = this.batch && Object.keys(this.batch.aliases()).find((a) => a.slice(1).toLowerCase() === id.toLowerCase());
      const recent = (this.batch?.created ?? []).filter((c) => this.has(c));
      const because = this.batch?.retyped?.has(id) ? 'a retype or a trigger change gave it the prefix of its new kind' : 'its id named its old ends';
      const why = renamed ? `: an op before this one renamed it to ${renamed} (${because})` : candidates.length ? ` (did you mean: ${candidates.join(', ')}?)` : '';
      throw modelError('E_NOT_FOUND', `No ${what} with id "${id}"${why}`, {
        element: id,
        candidates,
        hint: [
          alias ? `In this batch ${alias} is an alias: write "${alias}".` : '',
          recent.length ? `Created earlier in this batch: ${recent.slice(-8).join(', ')}${recent.length > 8 ? ` (and ${recent.length - 8} more)` : ''}; name them with "as": "$name" to refer to them.` : '',
          'Run `bpmn show <file>` or `bpmn find <file> <text>` to list ids.',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
    if (expect) {
      const types = Array.isArray(expect) ? expect : [expect];
      if (!types.some((t) => is(el, t))) {
        throw modelError('E_WRONG_KIND', `"${id}" is a ${kindLabel(el)}, expected ${types.map((t) => t.replace('bpmn:', '')).join(' or ')}`, {
          element: id,
        });
      }
    }
    return el;
  }

  /** Vendor extension elements carrying `id`, with the id of the BPMN element they belong to. */
  private vendorUses(id: string): Array<{ type: string; owner: string }> {
    const out: Array<{ type: string; owner: string }> = [];
    for (const el of walk(this.definitions)) {
      if ((el as unknown as { id?: unknown }).id !== id || (isBpmnElement(el) && !insideExtension(el))) continue;
      let owner = el.$parent as El | undefined;
      while (owner && (!isBpmnElement(owner) || is(owner, 'bpmn:ExtensionElements') || !owner.get<string | undefined>('id'))) owner = owner.$parent as El | undefined;
      out.push({ type: el.$type, owner: owner?.get<string>('id') ?? '?' });
    }
    return out;
  }

  /**
   * "Did you mean" ids for an id that does not exist, best first: the id
   * an op of the running batch renamed it to; the same id in another case,
   * umlaut spelling (Pruefung, Prufung, Prüfung) or with another or no
   * prefix (Task_CheckInvoice, CheckInvoice -> Activity_CheckInvoice); an id
   * containing it or contained in it; a typo (edit distance 1, 2 from 12
   * characters, on the whole id or without prefix); a name containing it.
   * Ids with the query's prefix come first (a mistyped `Flow_...` suggests
   * flows before the gateway its words contain), then the tiers; within a
   * tier the ids the running batch created come first.
   */
  suggest(query: string, max = 5): string[] {
    const q = query.toLowerCase();
    const fq = foldUmlauts(query);
    const fstem = foldUmlauts(stemOf(query));
    const recent = new Set(this.batch?.created ?? []);
    const renamed = this.batch?.renamed.get(query);
    const prefix = prefixOf(query);
    const hits: Array<{ id: string; score: number; dist: number }> = [];
    for (const [id, el] of this.byId()) {
      const name = String(el.get<string | undefined>('name') ?? '').toLowerCase();
      const lid = id.toLowerCase();
      const fid = foldUmlauts(id);
      const fidStem = foldUmlauts(stemOf(id));
      let score = Infinity;
      let dist = 0;
      if (id === renamed) score = -1;
      else if (lid === q) score = 0;
      else if ((fq && fid === fq) || (fstem.length >= 3 && fidStem === fstem)) score = 1;
      else if (fq && (fid.includes(fq) || (fid.length >= 3 && fq.includes(fid)))) score = 2;
      // the same prefix and one body inside the other (Flow_GatewayPurchaseApprovedToOrderGoods -> Flow_PurchaseApprovedToOrderGoods)
      else if (prefix && prefixOf(id) === prefix && fstem.length >= 3 && fidStem.length >= 6 && (fidStem.includes(fstem) || fstem.includes(fidStem))) score = 2;
      else {
        const whole = editDistance(fq, fid);
        const bare = editDistance(fstem, fidStem);
        if (fq && whole <= typoTolerance(fq.length)) [score, dist] = [3, whole];
        else if (fstem && bare <= typoTolerance(fstem.length)) [score, dist] = [3, bare];
        else if (name && (name === q || name.includes(q) || (!!fq && foldUmlauts(name).includes(fq)))) score = 4;
        else if (q.replace(/[^a-z0-9]/g, '') && lid.replace(/[^a-z0-9]/g, '').includes(q.replace(/[^a-z0-9]/g, ''))) score = 5;
      }
      if (score < Infinity) hits.push({ id, score, dist });
    }
    if (!hits.length) {
      // last resort: kind-alike suggestions are not ids; return nothing
      void suggestKinds;
    }
    const fresh = (id: string): number => (recent.has(id) ? 0 : 1);
    const own = (h: { id: string; score: number }): number => (h.score < 0 || (prefix && prefixOf(h.id) === prefix) ? 0 : 1);
    return hits
      .sort((a, b) => own(a) - own(b) || a.score - b.score || fresh(a.id) - fresh(b.id) || a.dist - b.dist || a.id.localeCompare(b.id))
      .slice(0, max)
      .map((h) => h.id);
  }

  /**
   * The project's declared id conventions (src/ids/conventions.ts; the pipeline
   * sets them for a call from MutationOptions.conventions): new ids follow
   * them where they declare a prefix, the file's own style elsewhere
   * (src/ids/style.ts). Setting other ones learns the style again.
   */
  get conventions(): IdConventions | undefined {
    return this.declared;
  }

  set conventions(c: IdConventions | undefined) {
    if (c === this.declared) return;
    this.declared = c;
    this.style = undefined;
  }

  /** The id conventions of this document, learned from its ids on first use (src/ids/style.ts), the declared ones over them. */
  get idStyle(): IdStyle {
    return (this.style ??= IdStyle.infer(this.definitions, this.declared));
  }

  /**
   * A new id in the document's style (src/ids/style.ts) for a kindRequest /
   * typeRequest / connectionRequest / flowRequest; claims it. `base` is the
   * id the request wanted: when it was taken the id carries a suffix, which
   * is recorded for W_ID_SUFFIXED (takeSuffixed). An id under a prefix the
   * declared conventions name for the request (IdStyle.explain: `lint`;
   * not one they only shaped, nor a message flow that borrows the sequence
   * flows' prefix) that the file's own style would give otherwise is
   * recorded for the result's `conventions:` line (takeDeclaredIds), in a
   * file that has a style of its own there (IdStyle.ownStyleDiffers: ids
   * the conventions check that do not follow them; not a new file, nor one
   * whose checked ids all follow them).
   */
  allocateId(req: IdRequest): { id: string; base: string } {
    const style = this.idStyle;
    const out = style.next(req, this.ids);
    if (style.ownStyleDiffers && style.explain(req).source === 'lint' && out.base !== style.learnedOnly().next(req, this.ids).base) this.declaredIds.push(out.id);
    this.ids.claim(out.id);
    this.generatedIds.set(out.id, out.base);
    if (out.id !== out.base) this.suffixed.push(out);
    return out;
  }

  /**
   * The id `id` wanted (before a collision suffix) where allocateId (or
   * markGenerated) generated it since the batch or the op on its own began
   * and no explicit claim took it since (claimId): nobody's API yet
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

  /** Forgets the generated ids (generatedBase), at the start of a batch or of an op on its own. */
  forgetGeneratedIds(): void {
    this.generatedIds.clear();
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
    for (let n = 2; this.has(id) || this.ids.has(id); n++) id = withSuffix(base, sep, n);
    if (id !== base) this.suffixed.push({ id, base });
    if (this.declaredIds.includes(old)) this.declaredIds.push(id);
    return id;
  }

  /** Records an id under a declared prefix that the file's own style would give otherwise, outside allocateId (a split's join), where the file has a style of its own there (IdStyle.ownStyleDiffers). */
  recordDeclaredId(id: string): void {
    if (this.idStyle.ownStyleDiffers) this.declaredIds.push(id);
  }

  /** The ids under a declared prefix recorded since the last call (allocateId; the pipeline keeps those still in the document). */
  takeDeclaredIds(): string[] {
    const out = this.declaredIds;
    this.declaredIds = [];
    return out;
  }

  /**
   * Records that an op renamed an element (ops/index.ts rewrites the op's
   * change entries; `el`: only those of that element, ChangeSet.rename);
   * `was`: what the old id named (a flow's old ends).
   */
  recordRename(from: string, to: string, was?: string, el?: El): void {
    this.renamedIds.push(about({ from, to, ...(was ? { was } : {}) }, el));
  }

  /**
   * Records that an element the batch created took another id
   * (regeneratedId), or a flow the batch named after it followed (`was`:
   * the flow's ends before): the entries, their details, notes and
   * warnings name it by the new one (Rename.regenerated).
   */
  recordRegenerated(from: string, to: string, was?: string, el?: El): void {
    this.renamedIds.push(about({ from, to, ...(was ? { was } : {}), regenerated: true as const }, el));
  }

  /** The renames since the last call. */
  takeRenames(): Rename[] {
    const out = this.renamedIds;
    this.renamedIds = [];
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
    return !this.followFlowEnds && !!flow.get<string | undefined>('id') && (this.flowsBefore?.has(flow) ?? true);
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

  /**
   * Records what a node was called as a flow end (`end`: its id and labels)
   * before `set` gives it another id or name (ops/flows.ts recordFormerEnd):
   * a flow whose id named it so still names its ends (idNamesEnds) until
   * the batch or the op on its own ends (forgetFormerEnds).
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

  /** Forgets the former ends (recordFormerEnd), at the start of a batch or of an op on its own. */
  forgetFormerEnds(): void {
    this.formerEnds.clear();
  }

  /**
   * `next` took the place of `old` (a retype that changes the type builds a
   * new element, ops/retype.ts swapType): what the running batch recorded
   * about `old` is about `next`, its former ends (recordFormerEnd) and the
   * change entries made for it (change-set.ts replaced).
   */
  replaceElement(old: El, next: El): void {
    replaced(old, next);
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

  /** The flows kept since the last call, with the ends their id named and that id (reportStaleFlows turns them into W_FLOW_ID_STALE). */
  takeKeptFlows(): Map<El, KeptFlow> {
    const out = this.keptFlows;
    this.keptFlows = new Map();
    return out;
  }

  /** The generated ids that took a collision suffix since the last call (reportSuffixed reports them as W_ID_SUFFIXED). */
  takeSuffixed(): Array<{ id: string; base: string }> {
    const out = this.suffixed;
    this.suffixed = [];
    return out;
  }

  /** W_ID_SUFFIXED on `cs` for every generated id that took a collision suffix since the last call (the id it wanted was taken). */
  reportSuffixed(cs: ChangeSet): void {
    for (const { id, base } of this.takeSuffixed()) {
      if (cs.warnings.some((w) => w.code === 'W_ID_SUFFIXED' && w.element === id)) continue;
      cs.warn({
        code: 'W_ID_SUFFIXED',
        message: `Id ${base} is already taken; using ${id}`,
        element: id,
        hint: 'Pass an explicit id to choose it yourself (--id, "id"; --flow-id / "flowId" for the flow into a new node, "joinId" for a join), or give the element a distinct name.',
      });
    }
  }

  /** Next id for a prefix (the family of `bpmn kinds`, or a type name) and name in the document's style; claims it. */
  newId(prefix: string, name?: string): string {
    return this.allocateId({ key: prefix, prefix, typeNames: [prefix.charAt(0).toLowerCase() + prefix.slice(1)], ...(name ? { name } : {}) }).id;
  }

  /** Validates and claims an explicit id: the caller's, so no longer generated (generatedBase), also where an op before freed a generated one. */
  claimId(id: string): void {
    if (!isValidId(id)) {
      throw modelError('E_INVALID_ID', `"${id}" is not a valid id: must match [A-Za-z_][A-Za-z0-9_.-]*`, { element: id });
    }
    if (this.has(id) || this.ids.has(id)) {
      throw modelError('E_DUPLICATE_ID', `An element with id "${id}" already exists`, { element: id, hint: 'Choose another --id or omit it.' });
    }
    this.ids.claim(id);
    this.generatedIds.delete(id);
  }

  /** moddle.create wrapper that claims the id. */
  create(type: string, attrs: Record<string, unknown> = {}): El {
    const el = this.moddle.create(type, attrs);
    const id = attrs['id'];
    if (typeof id === 'string') this.ids.claim(id);
    this.invalidate();
    return el;
  }

  declareNamespace(prefix: string, uri?: string): void {
    const key = `xmlns:${prefix}`;
    if (this.definitions.$attrs[key]) return;
    const resolved = uri ?? KNOWN_NAMESPACES[prefix];
    if (!resolved) {
      throw modelError('E_UNKNOWN_NAMESPACE', `Unknown namespace prefix "${prefix}"`, {
        hint: `Declare it once with an inline xmlns: \`bpmn ext add <file> <id> ${prefix}:<type> --xml '<${prefix}:<type> xmlns:${prefix}="<uri>"/>'\`, or add xmlns:${prefix}="<uri>" to bpmn:definitions in the file. Known prefixes: ${Object.keys(KNOWN_NAMESPACES).join(', ')}`,
      });
    }
    this.definitions.$attrs[key] = resolved;
  }

  namespaceUri(prefix: string): string | undefined {
    return (this.definitions.$attrs[`xmlns:${prefix}`] as string | undefined) ?? KNOWN_NAMESPACES[prefix];
  }

  async toXml(): Promise<string> {
    return serialize(this.model);
  }

  /* ------------------------------------------------------------ */
  /* structure                                                      */
  /* ------------------------------------------------------------ */

  processes(): El[] {
    return rootProcesses(this.definitions);
  }

  collaboration(): El | undefined {
    return rootCollaboration(this.definitions);
  }

  layoutRoot(): El | undefined {
    return pickLayoutRoot(this.definitions);
  }

  participants(): El[] {
    const collab = this.collaboration();
    return collab ? many(collab, 'participants') : [];
  }

  participantOf(process: El): El | undefined {
    return this.participants().find((p) => p.get<El | undefined>('processRef') === process);
  }

  /** The Process or SubProcess directly containing a flow element / artifact. */
  scopeOf(el: El): El | undefined {
    let p = el.$parent as El | undefined;
    while (p) {
      if (is(p, 'bpmn:Process') || is(p, 'bpmn:SubProcess')) return p;
      p = p.$parent as El | undefined;
    }
    return undefined;
  }

  /** The Process containing an element (walking out of sub-processes). */
  processOf(el: El): El | undefined {
    let p: El | undefined = is(el, 'bpmn:Process') ? el : (el.$parent as El | undefined);
    while (p && !is(p, 'bpmn:Process')) p = p.$parent as El | undefined;
    return p;
  }

  /**
   * The single process an operation applies to when no scope is given.
   * Throws E_AMBIGUOUS_SCOPE when there are several processes.
   */
  defaultScope(): El {
    const procs = this.processes();
    if (procs.length === 1) return procs[0]!;
    if (!procs.length) throw modelError('E_NO_PROCESS', 'The file contains no process', { hint: 'Create one with `bpmn new`.' });
    throw modelError('E_AMBIGUOUS_SCOPE', `The file has ${procs.length} processes; specify the scope with --in <processId|subProcessId>`, {
      candidates: procs.map((p) => p.get<string>('id')),
    });
  }

  /** Resolves a scope id (process, sub-process or participant -> its process). */
  requireScope(id: string | undefined): El {
    if (!id) return this.defaultScope();
    const el = this.require(id, ['bpmn:Process', 'bpmn:SubProcess', 'bpmn:Participant'], 'scope');
    if (is(el, 'bpmn:Participant')) {
      const proc = el.get<El | undefined>('processRef');
      if (!proc) throw modelError('E_BLACK_BOX', `Participant "${id}" has no process (black box)`, { element: id });
      return proc;
    }
    return el;
  }

  flowElements(scope: El): El[] {
    return many(scope, 'flowElements');
  }

  flowNodes(scope: El): El[] {
    return this.flowElements(scope).filter((e) => is(e, 'bpmn:FlowNode'));
  }

  sequenceFlows(scope: El): El[] {
    return this.flowElements(scope).filter((e) => is(e, 'bpmn:SequenceFlow'));
  }

  /** All sequence flows in the document (any scope). */
  allSequenceFlows(): El[] {
    return [...this.byId().values()].filter((e) => is(e, 'bpmn:SequenceFlow'));
  }

  incoming(node: El): El[] {
    return (node.get<El[] | undefined>('incoming') ?? []).filter((f) => is(f, 'bpmn:SequenceFlow'));
  }

  outgoing(node: El): El[] {
    return (node.get<El[] | undefined>('outgoing') ?? []).filter((f) => is(f, 'bpmn:SequenceFlow'));
  }

  boundaryEventsOf(activity: El): El[] {
    const scope = this.scopeOf(activity);
    if (!scope) return [];
    return this.flowElements(scope).filter((e) => is(e, 'bpmn:BoundaryEvent') && e.get<El | undefined>('attachedToRef') === activity);
  }

  /** All lanes of a process, flattened (nested lanes included, deepest last). */
  allLanes(process: El): El[] {
    const out: El[] = [];
    const visit = (laneSet: El | undefined): void => {
      if (!laneSet) return;
      for (const lane of many(laneSet, 'lanes')) {
        out.push(lane);
        visit(lane.get<El | undefined>('childLaneSet'));
      }
    };
    for (const ls of many(process, 'laneSets')) visit(ls);
    return out;
  }

  /** Lanes that reference a node (usually 0 or 1). */
  lanesOf(node: El): El[] {
    const process = this.processOf(node);
    if (!process) return [];
    return this.allLanes(process).filter((lane) => (lane.get<El[] | undefined>('flowNodeRef') ?? []).includes(node));
  }

  messageFlows(): El[] {
    const collab = this.collaboration();
    return collab ? many(collab, 'messageFlows') : [];
  }

  /** Root-level Message/Error/Signal/Escalation elements. */
  rootElementsOfType(type: string): El[] {
    return many(this.definitions, 'rootElements').filter((e) => is(e, type));
  }
}
