import type { ImportWarning } from 'bpmn-moddle';
import type { BpmnModdle } from 'bpmn-moddle';
import { modelError, ioError, usageError } from './utils/errors.js';
import { hasIdWords, isValidId } from './utils/slug.js';
import { IdRegistry } from './ids/IdRegistry.js';
import type { IdConventions } from './ids/IdConventions.js';
import { IdStyle } from './ids/IdStyle.js';
import { typeRequest } from './utils/requests.js';
import { speakingStem } from './utils/id-words.js';
import type { BatchContext } from './EditSession.js';
import { LayoutRequests } from './LayoutRequests.js';
import { kindLabel } from './Kinds.js';
import { IdSuggestions } from './IdSuggestions.js';
import { completeMirrorLists, takeMirrorSnapshot, type MirrorSnapshot } from './utils/mirror.js';
import { allLanes } from './utils/lanes.js';
import { createDefinitions, createModdle, enclosingProcess, indexById, is, isBpmnElement, many, parseXml, processes as rootProcesses, collaboration as rootCollaboration, layoutRoot as pickLayoutRoot, serialize, walk, type El, type Model } from './utils/moddle.js';
import { ModelError } from './ModelError.js';
import { C7_DEFAULT_TTL, C7_PLATFORM_VERSION } from './vendor/CamundaDescriptor.js';
import { C8_PLATFORM_VERSION } from './vendor/ZeebeDescriptor.js';
import { PlatformDetection, platformOfTarget, TARGETS, type Platform, type Target } from './vendor/PlatformDetection.js';

/** `operaton` is Operaton's copy of the camunda namespace (only Operaton reads it). */
export const KNOWN_NAMESPACES: Record<string, string> = {
  camunda: 'http://camunda.org/schema/1.0/bpmn',
  operaton: 'http://operaton.org/schema/1.0/bpmn',
  zeebe: 'http://camunda.org/schema/zeebe/1.0',
  modeler: 'http://camunda.org/schema/modeler/1.0',
  bioc: 'http://bpmn.io/schema/bpmn/biocolor/1.0',
  color: 'http://www.omg.org/spec/BPMN/non-normative/color/1.0',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
};

// `duplicate element`: an element the schema allows once appears twice; the reader keeps the last
const LOSSY_PATTERNS = [/unparsable content/i, /unrecognized element/i, /unresolved reference/i, /duplicate ID/i, /^duplicate element/i];

export interface NewDocOptions {
  processId?: string;
  processName?: string;
  executable?: boolean;
  /** declares vendor namespaces, the platform and (camunda7) the Modeler's process defaults */
  target?: Target;
  /** process and definitions ids follow them only where they name that type exactly */
  conventions?: IdConventions;
}

export interface DocSource {
  text: string;
  /** the incoming / outgoing lists as read, before the in-memory repair */
  mirror: MirrorSnapshot;
}

/**
 * A loaded BPMN document: the semantic model plus the id registry and lookups every op relies on.
 * Ids of vendor extension elements never resolve: `require` names their BPMN owner instead.
 */
export class Doc {
  private index: Map<string, El> | null = null;
  private style: IdStyle | undefined;
  private declared: IdConventions | undefined;
  readonly layoutRequests = new LayoutRequests();
  /**
   * Whether a flow whose id names its ends is renamed when an op changes them.
   * False keeps the ids of the flows the document had before the batch (reported W_FLOW_ID_STALE).
   */
  followFlowEnds = true;

  private constructor(
    public readonly model: Model,
    public readonly ids: IdRegistry,
    public readonly file: string | undefined,
    /** lets the write keep the file's formatting and report an equal result as `unchanged` */
    public readonly source?: DocSource,
  ) {}

  /** Operaton and CIB seven files are camunda7. */
  static assertTarget(target: unknown): asserts target is NewDocOptions['target'] {
    if (target === undefined || (TARGETS as readonly unknown[]).includes(target)) return;
    throw usageError(`Unknown --target "${String(target)}": expected camunda8 or camunda7`, {
      hint: 'camunda7 also covers CIB seven and Operaton (they read the camunda: namespace); camunda8 is Zeebe. Omit --target for a plain BPMN file.',
    });
  }

  static assertProcessId(id: string): void {
    if (!isValidId(id)) throw modelError('E_INVALID_ID', `"${id}" is not a valid id (XML NCName)`);
  }

  /**
   * The given process id, else one from its name, else Process_1; the definitions speak like the
   * process (Definitions_OrderToCash), else the tool default Definitions_1.
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

  private static insideExtension(el: El): boolean {
    for (let ancestor = el.$parent as El | undefined; ancestor; ancestor = ancestor.$parent as El | undefined) if (is(ancestor, 'bpmn:ExtensionElements')) return true;
    return false;
  }

  /**
   * `file` only names the document in messages: the core never touches the file system.
   * The mirror lists as read decide what a write keeps; in memory they are completed.
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
    const mirror = takeMirrorSnapshot(model.definitions);
    completeMirrorLists(model.definitions);
    return new Doc(model, ids, file, { text: xml, mirror });
  }

  /** A new file has no own id style to differ from, so given conventions are taken without a `conventions:` line. */
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
    if (opts.conventions) doc.conventions = opts.conventions;
    const platform = platformOfTarget(opts.target);
    if (platform === 'c8') {
      doc.declareNamespace('zeebe');
      doc.declareNamespace('modeler');
      definitions.$attrs['modeler:executionPlatform'] = 'Camunda Cloud';
      definitions.$attrs['modeler:executionPlatformVersion'] = C8_PLATFORM_VERSION;
    } else if (platform === 'c7') {
      doc.declareNamespace('camunda');
      doc.declareNamespace('modeler');
      definitions.$attrs['modeler:executionPlatform'] = 'Camunda Platform';
      definitions.$attrs['modeler:executionPlatformVersion'] = C7_PLATFORM_VERSION;
      doc.initProcess(rootProcesses(definitions)[0]!);
    }
    return doc;
  }

  platform(): Platform {
    return new PlatformDetection(this.definitions).info().platform;
  }

  /**
   * C7, CIB seven and Operaton refuse to deploy an executable process without a
   * historyTimeToLive, so a new process gets the Modeler's default (operaton: prefix in
   * Operaton-only files). An existing value is never touched.
   */
  initProcess(process: El, platform = this.platform()): void {
    if (platform !== 'c7') return;
    const camunda = KNOWN_NAMESPACES['camunda']!;
    const operaton = KNOWN_NAMESPACES['operaton']!;
    const uri = !this.prefixFor(camunda) && this.prefixFor(operaton) ? operaton : camunda;
    for (const uri of [camunda, operaton]) {
      const prefix = this.prefixFor(uri);
      if (prefix && process.$attrs[`${prefix}:historyTimeToLive`] !== undefined) return;
    }
    const prefix = this.prefixFor(uri) ?? (uri === operaton ? 'operaton' : 'camunda');
    this.declareNamespace(prefix, uri);
    process.$attrs[`${prefix}:historyTimeToLive`] = C7_DEFAULT_TTL;
  }

  prefixFor(uri: string): string | undefined {
    for (const [key, value] of Object.entries(this.definitions.$attrs ?? {})) {
      if (key.startsWith('xmlns:') && value === uri) return key.slice('xmlns:'.length);
    }
    return undefined;
  }

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
    return this.importWarnings.filter((warning) => LOSSY_PATTERNS.some((pattern) => pattern.test(warning.message)));
  }

  assertLossless(opts: { force?: boolean } = {}): void {
    const lossy = this.lossyImportWarnings;
    if (!lossy.length || opts.force) return;
    throw ioError('E_IMPORT_LOSSY', `${this.file ?? 'The XML'} contains content bpmn-moddle cannot represent; writing it back would lose data`, {
      ...(this.file ? { file: this.file } : {}),
      warnings: lossy.map((warning) => warning.message.split('\n')[0]),
      hint: 'Fix the XML, or pass --force (MutationOptions.force) to write anyway (the reported content will be dropped).',
    });
  }

  /** Call after any structural mutation; lookups rebuild lazily. */
  invalidate(): void {
    this.index = null;
  }

  /** Diagram interchange is not addressable: the AI never sees DI. */
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

  /** Throws E_NOT_FOUND with "did you mean" candidates, E_WRONG_KIND when not of `expect`. */
  require(id: string, expect?: string | string[], what = 'element', batch?: BatchContext): El {
    const el = this.get(id);
    if (!el) {
      const vendor = this.vendorUses(id);
      if (vendor.length) {
        const owners = [...new Set(vendor.map((vendorHit) => vendorHit.owner))];
        throw modelError('E_NOT_FOUND', `"${id}" is not a BPMN element: it is the id of ${[...new Set(vendor.map((vendorHit) => vendorHit.type))].join(', ')} vendor extension data inside ${owners.join(', ')}`, {
          element: id,
          candidates: owners,
          hint: `Vendor extension elements are edited through their BPMN element: \`bpmn ext list <file> ${owners[0]}\`, then \`bpmn ext add|remove <file> ${owners[0]} ...\`.`,
        });
      }
      const renamed = batch?.renamed.get(id);
      const candidates = this.suggest(id, 5, batch);
      const alias = batch && Object.keys(batch.aliases()).find((aliasKey) => aliasKey.slice(1).toLowerCase() === id.toLowerCase());
      const recent = (batch?.created ?? []).filter((createdId) => this.has(createdId));
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
      if (!types.some((type) => is(el, type))) {
        throw modelError('E_WRONG_KIND', `"${id}" is a ${kindLabel(el)}, expected ${types.map((type) => type.replace('bpmn:', '')).join(' or ')}`, {
          element: id,
        });
      }
    }
    return el;
  }

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

  /** "Did you mean" ids, best first (`IdSuggestions`). */
  suggest(query: string, max = 5, batch?: BatchContext): string[] {
    return new IdSuggestions(this, batch).for(query, max);
  }

  /** New ids follow these where they declare a prefix, the file's own style elsewhere. */
  get conventions(): IdConventions | undefined {
    return this.declared;
  }

  set conventions(conventions: IdConventions | undefined) {
    if (conventions === this.declared) return;
    this.declared = conventions;
    this.style = undefined;
  }

  /** Learned from the document's ids on first use, the declared conventions over them. */
  get ownIdStyle(): IdStyle {
    return (this.style ??= IdStyle.infer(this.definitions, this.declared));
  }

  forgetIdStyle(): void {
    this.style = undefined;
  }

  /** Refuses an invalid or taken id. */
  claimId(id: string): void {
    if (!isValidId(id)) {
      throw modelError('E_INVALID_ID', `"${id}" is not a valid id: must match [A-Za-z_][A-Za-z0-9_.-]*`, { element: id });
    }
    if (this.has(id) || this.ids.has(id)) {
      throw modelError('E_DUPLICATE_ID', `An element with id "${id}" already exists`, { element: id, hint: 'Choose another --id or omit it.' });
    }
    this.ids.claim(id);
  }

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
    return this.participants().find((participant) => participant.get<El | undefined>('processRef') === process);
  }

  scopeOf(el: El): El | undefined {
    let ancestor = el.$parent as El | undefined;
    while (ancestor) {
      if (is(ancestor, 'bpmn:Process') || is(ancestor, 'bpmn:SubProcess')) return ancestor;
      ancestor = ancestor.$parent as El | undefined;
    }
    return undefined;
  }

  processOf(el: El): El | undefined {
    return enclosingProcess(el);
  }

  defaultScope(): El {
    const procs = this.processes();
    if (procs.length === 1) return procs[0]!;
    if (!procs.length) throw modelError('E_NO_PROCESS', 'The file contains no process', { hint: 'Create one with `bpmn new`.' });
    throw modelError('E_AMBIGUOUS_SCOPE', `The file has ${procs.length} processes; specify the scope with --in <processId|subProcessId>`, {
      candidates: procs.map((proc) => proc.get<string>('id')),
    });
  }

  /** A participant resolves to its process. */
  requireScope(id: string | undefined, batch?: BatchContext): El {
    if (!id) return this.defaultScope();
    const el = this.require(id, ['bpmn:Process', 'bpmn:SubProcess', 'bpmn:Participant'], 'scope', batch);
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
    return this.flowElements(scope).filter((element) => is(element, 'bpmn:FlowNode'));
  }

  sequenceFlows(scope: El): El[] {
    return this.flowElements(scope).filter((element) => is(element, 'bpmn:SequenceFlow'));
  }

  allSequenceFlows(): El[] {
    return [...this.byId().values()].filter((element) => is(element, 'bpmn:SequenceFlow'));
  }

  incoming(node: El): El[] {
    return (node.get<El[] | undefined>('incoming') ?? []).filter((flow) => is(flow, 'bpmn:SequenceFlow'));
  }

  outgoing(node: El): El[] {
    return (node.get<El[] | undefined>('outgoing') ?? []).filter((flow) => is(flow, 'bpmn:SequenceFlow'));
  }

  boundaryEventsOf(activity: El): El[] {
    const scope = this.scopeOf(activity);
    if (!scope) return [];
    return this.flowElements(scope).filter((element) => is(element, 'bpmn:BoundaryEvent') && element.get<El | undefined>('attachedToRef') === activity);
  }

  lanesOf(node: El): El[] {
    const process = this.processOf(node);
    if (!process) return [];
    return allLanes(process).filter((lane) => (lane.get<El[] | undefined>('flowNodeRef') ?? []).includes(node));
  }

  messageFlows(): El[] {
    const collab = this.collaboration();
    return collab ? many(collab, 'messageFlows') : [];
  }

  rootElementsOfType(type: string): El[] {
    return many(this.definitions, 'rootElements').filter((element) => is(element, type));
  }
}
