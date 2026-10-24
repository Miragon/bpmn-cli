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
import { editDistance, typoTolerance } from '../shared/utils/fuzzy.js';
import { hasIdWords, isValidId, transliterate } from '../ids/utils/slug.js';
import { IdRegistry } from '../ids/IdRegistry.js';
import type { IdConventions } from '../ids/IdConventionsReader.js';
import { IdStyle } from '../ids/IdStyle.js';
import { typeRequest, type IdRequest } from '../ids/utils/requests.js';
import { speakingStem } from '../ids/utils/id-words.js';
import { EditContext } from './EditContext.js';
import { LayoutRequests } from './LayoutRequests.js';
import { kindLabel, suggestKinds } from './kinds.js';
import { completeMirrorLists, takeMirrorSnapshot, type MirrorSnapshot } from './utils/mirror.js';
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
   * the project's declared id conventions (src/ids/IdConventionsReader.ts; the node
   * layer reads them from the .bpmnlintrc): the document keeps them
   * (Doc.conventions); the process and definitions ids follow them only
   * where they name bpmn:Process / bpmn:Definitions exactly
   */
  conventions?: IdConventions;
}

/** The values `new --target` (NewDocOptions.target) accepts. */
export const TARGETS = ['camunda8', 'camunda7', 'none'] as const;

/** What a document was read from (see Doc.source). */
export interface DocSource {
  /** the XML text as read */
  text: string;
  /** the incoming / outgoing lists as read, before the in-memory repair */
  mirror: MirrorSnapshot;
}

export class Doc {
  private index: Map<string, El> | null = null;
  private style: IdStyle | undefined;
  /** the declared id conventions (see the conventions accessor) */
  private declared: IdConventions | undefined;
  /**
   * The running edit (src/model/EditContext.ts): OpRunner sets it while ops
   * run (the edit transaction's for mutateDoc); between runs the document's
   * own, for ops called directly.
   */
  edit: EditContext = new EditContext(this);
  /** the sub-processes ops asked to lay out expanded or collapsed, until a layout reads them */
  readonly layoutRequests = new LayoutRequests();
  /**
   * Whether a flow whose id names its ends is renamed when an op changes
   * them (ops/flows.ts followEnds). False keeps the id of every flow the
   * document had before the batch (EditContext.flowsBefore); the batch
   * reports each one whose id no longer names its ends as W_FLOW_ID_STALE
   * (ops/OpRunner.ts). MutationOptions.keepFlowIds decides for one call
   * instead (EditContext.followFlowEnds); the engine-ownership check sets it
   * on a copy to simulate a remove.
   */
  followFlowEnds = true;

  private constructor(
    public readonly model: Model,
    public readonly ids: IdRegistry,
    public readonly file: string | undefined,
    /**
     * The text the document was read from and its incoming / outgoing lists
     * at that time (Doc.fromXml, also readDoc / loadDoc of the node layer;
     * undefined for Doc.create): the write pipeline keeps the file's
     * formatting and mirror-list style (xml/preserve.ts, utils/mirror.ts) and reports
     * a result equal to it as `unchanged`.
     */
    public readonly source?: DocSource,
  ) {}

  /** E_USAGE for a target that is not one of TARGETS (Operaton and CIB seven files are camunda7). */
  static assertTarget(target: unknown): asserts target is NewDocOptions['target'] {
    if (target === undefined || (TARGETS as readonly unknown[]).includes(target)) return;
    throw usageError(`Unknown --target "${String(target)}": expected camunda8 or camunda7`, {
      hint: 'camunda7 also covers CIB seven and Operaton (they read the camunda: namespace); camunda8 is Zeebe. Omit --target for a plain BPMN file.',
    });
  }

  /** Throws E_INVALID_ID unless `id` can be a new document's process id (NewDocOptions.processId; `bpmn new --id` checks it first). */
  static assertProcessId(id: string): void {
    if (!isValidId(id)) throw modelError('E_INVALID_ID', `"${id}" is not a valid id (XML NCName)`);
  }

  /**
   * The ids of a new document's process and definitions (claimed in `ids`):
   * the given process id, else from the name in `style`, else Process_1 (a
   * process prefix the declared conventions name exactly: from it); the
   * definitions speak like the process (Definitions_OrderToCash), a process
   * without name or speaking id gives the tool default Definitions_1.
   */
  private static rootIds(opts: NewDocOptions, style: IdStyle, ids: IdRegistry): { processId: string; definitionsId: string } {
    const declared = (type: string): boolean => style.explain(typeRequest(type)).source === 'lint';
    const processId = opts.processId ?? (opts.processName || declared('bpmn:Process') ? style.next(typeRequest('bpmn:Process', opts.processName ? { name: opts.processName } : {}), ids).id : 'Process_1');
    Doc.assertProcessId(processId);
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

  /** An id or name folded for fuzzy matching: lower-case ASCII with ae / oe / ue / ss read as a / o / u / s (ä -> a). */
  private static foldUmlauts(text: string): string {
    return transliterate(text)
      .toLowerCase()
      .replace(/ae/g, 'a')
      .replace(/oe/g, 'o')
      .replace(/ue/g, 'u')
      .replace(/ss/g, 's')
      .replace(/[^a-z0-9]/g, '');
  }

  /** The prefix of an id (`flow` of Flow_CheckToBook), lower case; undefined without one. */
  private static prefixOf(id: string): string | undefined {
    return /^([A-Za-z][A-Za-z0-9]*)_./.exec(id)?.[1]!.toLowerCase();
  }

  /** An id without its prefix (`Activity_CheckInvoice` -> `CheckInvoice`; an id without `_` is its own stem). */
  private static stemOf(id: string): string {
    const i = id.indexOf('_');
    return i === -1 ? id : id.slice(i + 1);
  }

  /** True for elements somewhere below a bpmn:extensionElements container. */
  private static insideExtension(el: El): boolean {
    for (let p = el.$parent as El | undefined; p; p = p.$parent as El | undefined) if (is(p, 'bpmn:ExtensionElements')) return true;
    return false;
  }

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
    // the mirror lists as read decide what a write keeps (utils/mirror.ts); in memory they are complete
    const mirror = takeMirrorSnapshot(model.definitions);
    completeMirrorLists(model.definitions);
    return new Doc(model, ids, file, { text: xml, mirror });
  }

  static create(opts: NewDocOptions = {}, file?: string): Doc {
    Doc.assertTarget(opts.target);
    const moddle = createModdle();
    const ids = new IdRegistry();
    const style = IdStyle.of(opts.conventions);
    const { processId, definitionsId } = Doc.rootIds(opts, style, ids);
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

  /** The engine the file targets (the running edit's explicit platform, EditContext.platformChoice, else platform/PlatformDetection.ts target). */
  platform(): 'camunda7' | 'camunda8' | undefined {
    const choice = this.edit.platformChoice;
    if (choice) return choice === 'c7' ? 'camunda7' : choice === 'c8' ? 'camunda8' : undefined;
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

  /** Throws E_IMPORT_LOSSY when bpmn-moddle dropped content while importing the document (unless force). */
  assertLossless(opts: { force?: boolean } = {}): void {
    const lossy = this.lossyImportWarnings;
    if (!lossy.length || opts.force) return;
    throw ioError('E_IMPORT_LOSSY', `${this.file ?? 'The XML'} contains content bpmn-moddle cannot represent; writing it back would lose data`, {
      ...(this.file ? { file: this.file } : {}),
      warnings: lossy.map((w) => w.message.split('\n')[0]),
      hint: 'Fix the XML, or pass --force (MutationOptions.force) to write anyway (the reported content will be dropped).',
    });
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
      const batch = this.edit.batch;
      const renamed = batch?.renamed.get(id);
      const candidates = this.suggest(id);
      const alias = batch && Object.keys(batch.aliases()).find((a) => a.slice(1).toLowerCase() === id.toLowerCase());
      const recent = (batch?.created ?? []).filter((c) => this.has(c));
      const because = batch?.retyped?.has(id) ? 'a retype or a trigger change gave it the prefix of its new kind' : 'its id named its old ends';
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
      if ((el as unknown as { id?: unknown }).id !== id || (isBpmnElement(el) && !Doc.insideExtension(el))) continue;
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
    const fq = Doc.foldUmlauts(query);
    const fstem = Doc.foldUmlauts(Doc.stemOf(query));
    const batch = this.edit.batch;
    const recent = new Set(batch?.created ?? []);
    const renamed = batch?.renamed.get(query);
    const prefix = Doc.prefixOf(query);
    const hits: Array<{ id: string; score: number; dist: number }> = [];
    for (const [id, el] of this.byId()) {
      const name = String(el.get<string | undefined>('name') ?? '').toLowerCase();
      const lid = id.toLowerCase();
      const fid = Doc.foldUmlauts(id);
      const fidStem = Doc.foldUmlauts(Doc.stemOf(id));
      let score = Infinity;
      let dist = 0;
      if (id === renamed) score = -1;
      else if (lid === q) score = 0;
      else if ((fq && fid === fq) || (fstem.length >= 3 && fidStem === fstem)) score = 1;
      else if (fq && (fid.includes(fq) || (fid.length >= 3 && fq.includes(fid)))) score = 2;
      // the same prefix and one body inside the other (Flow_GatewayPurchaseApprovedToOrderGoods -> Flow_PurchaseApprovedToOrderGoods)
      else if (prefix && Doc.prefixOf(id) === prefix && fstem.length >= 3 && fidStem.length >= 6 && (fidStem.includes(fstem) || fstem.includes(fidStem))) score = 2;
      else {
        const whole = editDistance(fq, fid);
        const bare = editDistance(fstem, fidStem);
        if (fq && whole <= typoTolerance(fq.length)) [score, dist] = [3, whole];
        else if (fstem && bare <= typoTolerance(fstem.length)) [score, dist] = [3, bare];
        else if (name && (name === q || name.includes(q) || (!!fq && Doc.foldUmlauts(name).includes(fq)))) score = 4;
        else if (q.replace(/[^a-z0-9]/g, '') && lid.replace(/[^a-z0-9]/g, '').includes(q.replace(/[^a-z0-9]/g, ''))) score = 5;
      }
      if (score < Infinity) hits.push({ id, score, dist });
    }
    if (!hits.length) {
      // last resort: kind-alike suggestions are not ids; return nothing
      void suggestKinds;
    }
    const fresh = (id: string): number => (recent.has(id) ? 0 : 1);
    const own = (h: { id: string; score: number }): number => (h.score < 0 || (prefix && Doc.prefixOf(h.id) === prefix) ? 0 : 1);
    return hits
      .sort((a, b) => own(a) - own(b) || a.score - b.score || fresh(a.id) - fresh(b.id) || a.dist - b.dist || a.id.localeCompare(b.id))
      .slice(0, max)
      .map((h) => h.id);
  }

  /**
   * The project's declared id conventions (src/ids/IdConventionsReader.ts;
   * MutationOptions.conventions decide for one call instead,
   * EditContext.conventions): new ids follow them where they declare a
   * prefix, the file's own style elsewhere (src/ids/IdStyle.ts). Setting other
   * ones learns the style again.
   */
  get conventions(): IdConventions | undefined {
    return this.declared;
  }

  set conventions(c: IdConventions | undefined) {
    if (c === this.declared) return;
    this.declared = c;
    this.style = undefined;
  }

  /** The id style new ids follow: the running edit's (EditContext.idStyle). */
  get idStyle(): IdStyle {
    return this.edit.idStyle;
  }

  /** The id conventions of this document, learned from its ids on first use (src/ids/style.ts), the declared ones over them. */
  get ownIdStyle(): IdStyle {
    return (this.style ??= IdStyle.infer(this.definitions, this.declared));
  }

  /** Forgets the learned id style (ownIdStyle): the next use learns it from the ids the document has then. */
  forgetIdStyle(): void {
    this.style = undefined;
  }

  /** A new id in the running edit's style for a kindRequest / typeRequest / connectionRequest / flowRequest; claims it (IdAllocator.allocate). */
  allocateId(req: IdRequest): { id: string; base: string } {
    return this.edit.allocator.allocate(req);
  }

  /** Next id for a prefix (the family of `bpmn kinds`, or a type name) and name in the document's style; claims it. */
  newId(prefix: string, name?: string): string {
    return this.allocateId({ key: prefix, prefix, typeNames: [prefix.charAt(0).toLowerCase() + prefix.slice(1)], ...(name ? { name } : {}) }).id;
  }

  /** Validates and claims an explicit id: the caller's, so no longer generated (IdAllocator.generatedBase), also where an op before freed a generated one. */
  claimId(id: string): void {
    if (!isValidId(id)) {
      throw modelError('E_INVALID_ID', `"${id}" is not a valid id: must match [A-Za-z_][A-Za-z0-9_.-]*`, { element: id });
    }
    if (this.has(id) || this.ids.has(id)) {
      throw modelError('E_DUPLICATE_ID', `An element with id "${id}" already exists`, { element: id, hint: 'Choose another --id or omit it.' });
    }
    this.ids.claim(id);
    this.edit.allocator.forgetGenerated(id);
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
