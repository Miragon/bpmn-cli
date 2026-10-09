/**
 * The AI's read view of the model (no DI, no coordinates).
 *
 * CONTRACT (implemented in the "view" work package):
 *  - buildView(doc): ModelView. Nodes of a scope are listed in FLOW ORDER:
 *    depth-first from start events (then nodes without incoming flows), in
 *    declaration order of outgoing flows; unreachable nodes follow, flagged.
 *    Boundary events are nested under their host, sub-process children under
 *    the sub-process (recursively). Lanes list member ids. Collaboration
 *    section with participants and message flows. Root messages/errors/
 *    signals/escalations. `problems` = validateDoc(doc) errors + warnings
 *    (import from ./validate.js).
 *  - elementDetail(doc, el): everything about one element incl. readProperties()
 *    from ops/set.js, listExtensions() from ops/ext.js, flows in/out with
 *    labels/conditions, host, attached boundary events, lane, scope.
 *  Both first add missing incoming/outgoing mirror entries (optional in BPMN
 *  2.0, see repairFlowLinks in validate.ts) so flows of hand-written files
 *  show up; a file with complete mirrors is left untouched.
 *  - findElements(doc, text, kind?): case-insensitive substring over ids and
 *    names (kind filter by canonical kind), returns ViewNode-like entries;
 *    also over vendor attribute values (camunda:topic, camunda:assignee, ...,
 *    of nested elements too) and the attributes / bodies of extension
 *    elements (`match` says what matched), and, for a non-empty text, over
 *    the ids of event definitions and loop characteristics.
 *  Vendor content: nodes, processes and flows carry `attrs` (vendor attribute
 *  values; those of nested elements under the `set` keys `definition.`,
 *  `loop.`, `condition.`), `extensions` (extension element types and vendor
 *  attribute names, deduplicated) and `extensionElements` (the extension
 *  element types in document order, repeated ones included).
 */
import type { Doc } from './document.js';
import { usageError, type Warning } from './errors.js';
import { KindError, kindLabel, kindOf, parseKind, triggerOf, TRIGGER_TYPES } from './kinds.js';
import { diExpansionState } from './layout.js';
import { is, localType, walk, type El } from './model.js';
import { laneOf } from './ops/containers.js';
import { describeTrigger } from './ops/events.js';
import { listExtensions, type ExtensionInfo } from './ops/ext.js';
import { definitionsOf, nestedEntries, readProperties, vendorAttributes } from './ops/set.js';
import { flowOrder, repairFlowLinks, validateDoc } from './validate.js';

export interface ViewFlow {
  id: string;
  target: string;
  name?: string;
  condition?: string;
  /** camunda:resource of a script resource condition (it has no body) */
  conditionResource?: string;
  /** expression language of the condition */
  language?: string;
  default?: boolean;
  /** vendor attribute values of the flow and (`condition.` keys) of its condition, except the resource */
  attrs?: Record<string, string>;
  /** extension element types and vendor attribute names */
  extensions?: string[];
  /** extension element types in document order (repeats included) */
  extensionElements?: string[];
}

export interface ViewNode {
  id: string;
  /** canonical kind label incl. trigger, e.g. `startEvent:message` */
  kind: string;
  type: string;
  name?: string;
  /** trigger details text, e.g. "PT2D", "message OrderReceived" */
  trigger?: string;
  nonInterrupting?: boolean;
  documentation?: string;
  outgoing: ViewFlow[];
  incoming: string[];
  lane?: string;
  /** boundary events attached to this activity */
  boundary?: ViewNode[];
  /** sub-process children */
  children?: ViewNode[];
  expanded?: boolean;
  unreachable?: boolean;
  /** extra semantic facts, e.g. loop=parallel, calledElement=X */
  props?: Record<string, unknown>;
  /** vendor attribute values; nested elements under their set keys (`loop.camunda:collection`) */
  attrs?: Record<string, string>;
  /** vendor attributes and extension element types, for context */
  extensions?: string[];
  /** extension element types in document order (repeats included) */
  extensionElements?: string[];
}

export interface ViewLane {
  id: string;
  name?: string;
  members: string[];
  lanes?: ViewLane[];
}

export interface ViewData {
  id: string;
  kind: 'dataObject' | 'dataStore';
  name?: string;
  /** node ids writing to this data element */
  from: string[];
  /** node ids reading from it */
  to: string[];
}

export interface ViewAnnotation {
  id: string;
  text?: string;
  /** associated element ids */
  attachedTo: string[];
}

export interface ViewProcess {
  id: string;
  name?: string;
  executable: boolean;
  participant?: string;
  /** vendor attribute values, e.g. camunda:historyTimeToLive */
  attrs?: Record<string, string>;
  /** extension element types and vendor attribute names */
  extensions?: string[];
  /** extension element types in document order (repeats included) */
  extensionElements?: string[];
  lanes: ViewLane[];
  nodes: ViewNode[];
  data: ViewData[];
  annotations: ViewAnnotation[];
}

export interface ViewMessageFlow {
  id: string;
  source: string;
  target: string;
  name?: string;
  message?: string;
}

export interface ModelView {
  file?: string;
  definitions: { id: string; targetNamespace?: string; namespaces: string[] };
  collaboration?: { id: string; participants: Array<{ id: string; name?: string; process?: string }>; messageFlows: ViewMessageFlow[] };
  processes: ViewProcess[];
  rootElements: Array<{ id: string; kind: string; name?: string; code?: string }>;
  problems: Warning[];
  /** content the reader could not keep (a write needs --force and drops it), e.g. a duplicate loopCharacteristics */
  importWarnings?: string[];
}

/** A nested element of `show <id>` (event definition, loop characteristics, condition). */
export interface NestedDetail {
  type: string;
  id?: string;
  /** vendor attributes, settable as `<slot>.<key>` */
  attrs: Record<string, string>;
  extensions: ExtensionInfo[];
}

export interface ElementDetail {
  id: string;
  kind: string;
  type: string;
  name?: string;
  scope?: string;
  process?: string;
  lane?: string;
  host?: string;
  properties: Record<string, unknown>;
  incoming: Array<{ id: string; source: string; name?: string; condition?: string; default?: boolean }>;
  outgoing: ViewFlow[];
  boundary?: string[];
  children?: string[];
  extensions: unknown[];
  attrs: Record<string, string>;
  /** nested elements by their set-key prefix (definition, loop, condition; definition[<n>] when an event has several) */
  nested?: Record<string, NestedDetail>;
}

/* ------------------------------------------------------------------ */
/* read helpers (never create lazy collections)                         */
/* ------------------------------------------------------------------ */

/** xmlns prefixes that are part of BPMN itself (not vendor namespaces). */
const STANDARD_NS = new Set(['bpmn', 'bpmndi', 'di', 'dc', 'xsi', 'xml']);

function peek<T>(el: El, prop: string): T | undefined {
  return (el as Record<string, unknown>)[prop] as T | undefined;
}

function list(el: El, prop: string): El[] {
  const v = peek<unknown>(el, prop);
  return Array.isArray(v) ? (v as El[]) : [];
}

function idOf(el: El | undefined): string {
  return el ? (peek<string>(el, 'id') ?? '?') : '?';
}

function nameOf(el: El): string | undefined {
  const n = peek<unknown>(el, 'name');
  return typeof n === 'string' && n ? n : undefined;
}

/** Drops undefined-valued keys so JSON output stays compact. */
function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as Array<keyof T>) if (obj[key] === undefined) delete obj[key];
  return obj;
}

/**
 * Kind label for any element: the canonical kind (incl. trigger) for kinds the
 * AI can create, else the lowerCamel local type (`sequenceFlow`, `lane`,
 * `participant`, `messageFlow`, `association`, `dataAssociation`, ...).
 */
export function labelOf(el: El): string {
  if (kindOf(el)) return kindLabel(el);
  if (is(el, 'bpmn:DataAssociation')) return 'dataAssociation';
  const local = localType(el);
  return local.charAt(0).toLowerCase() + local.slice(1);
}

function isEventSubProcess(el: El): boolean {
  return is(el, 'bpmn:SubProcess') && peek<boolean>(el, 'triggeredByEvent') === true;
}

function documentationOf(el: El): string | undefined {
  const texts = list(el, 'documentation')
    .map((d) => peek<string>(d, 'text'))
    .filter((t): t is string => typeof t === 'string' && !!t.trim());
  return texts.length ? texts.join(' ') : undefined;
}

function refLabel(ref: El | undefined): string {
  if (!ref) return '?';
  return nameOf(ref) ?? idOf(ref);
}

function bodyOf(expr: El | undefined): string | undefined {
  if (!expr) return undefined;
  const body = peek<unknown>(expr, 'body');
  return typeof body === 'string' && body ? body : undefined;
}

/** Trigger details from the first event definition (fallback while events.ts is a stub). */
function triggerText(el: El): string | undefined {
  const described = describeTrigger(el);
  if (described) return described;
  const def = list(el, 'eventDefinitions')[0];
  if (!def) return undefined;
  if (is(def, 'bpmn:TimerEventDefinition')) {
    for (const key of ['timeCycle', 'timeDuration', 'timeDate']) {
      const value = bodyOf(peek<El>(def, key));
      if (value) return value;
    }
    return undefined;
  }
  if (is(def, 'bpmn:MessageEventDefinition')) return `message ${refLabel(peek<El>(def, 'messageRef'))}`;
  if (is(def, 'bpmn:SignalEventDefinition')) return `signal ${refLabel(peek<El>(def, 'signalRef'))}`;
  if (is(def, 'bpmn:ErrorEventDefinition')) {
    const ref = peek<El>(def, 'errorRef');
    const code = ref ? peek<string>(ref, 'errorCode') : undefined;
    return `error ${refLabel(ref)}${code ? ` (${code})` : ''}`;
  }
  if (is(def, 'bpmn:EscalationEventDefinition')) {
    const ref = peek<El>(def, 'escalationRef');
    const code = ref ? peek<string>(ref, 'escalationCode') : undefined;
    return `escalation ${refLabel(ref)}${code ? ` (${code})` : ''}`;
  }
  if (is(def, 'bpmn:ConditionalEventDefinition')) return `if ${bodyOf(peek<El>(def, 'condition')) ?? '?'}`;
  if (is(def, 'bpmn:LinkEventDefinition')) return `link ${peek<string>(def, 'name') ?? '?'}`;
  return undefined;
}

function nonInterruptingOf(el: El): boolean | undefined {
  if (is(el, 'bpmn:BoundaryEvent')) return peek<boolean>(el, 'cancelActivity') === false ? true : undefined;
  if (is(el, 'bpmn:StartEvent')) return peek<boolean>(el, 'isInterrupting') === false ? true : undefined;
  return undefined;
}

/** Extra semantic facts of a node worth showing in one line. */
function nodeProps(el: El): Record<string, unknown> | undefined {
  const props: Record<string, unknown> = {};
  const loop = peek<El>(el, 'loopCharacteristics');
  if (loop) {
    if (is(loop, 'bpmn:StandardLoopCharacteristics')) props['loop'] = 'standard';
    else props['loop'] = peek<boolean>(loop, 'isSequential') ? 'sequential' : 'parallel';
    const cardinality = bodyOf(peek<El>(loop, 'loopCardinality'));
    if (cardinality) props['cardinality'] = cardinality;
  }
  const called = peek<string>(el, 'calledElement');
  if (called) props['calledElement'] = called;
  if (peek<boolean>(el, 'isForCompensation') === true) props['isForCompensation'] = true;
  const messageRef = peek<El>(el, 'messageRef');
  if (messageRef && (is(el, 'bpmn:SendTask') || is(el, 'bpmn:ReceiveTask'))) props['message'] = refLabel(messageRef);
  const scriptFormat = peek<string>(el, 'scriptFormat');
  if (scriptFormat) props['scriptFormat'] = scriptFormat;
  // several event definitions on one event (the label shows the first one's trigger): name them all
  const defs = definitionsOf(el);
  if (defs.length > 1) props['definitions'] = defs.map((d) => (Object.entries(TRIGGER_TYPES) as Array<[string, string]>).find(([, t]) => is(d, t))?.[0] ?? d.$type).join('+');
  return Object.keys(props).length ? props : undefined;
}

function vendorAttrs(el: El): Record<string, string> {
  return vendorAttributes(el);
}

function extensionTypes(el: El): string[] {
  const container = peek<El>(el, 'extensionElements');
  return container ? list(container, 'values').map((v) => v.$type) : [];
}

/** Vendor attribute names and extension element types, e.g. ["camunda:assignee", "zeebe:taskDefinition"]. */
function extensionMentions(el: El): string[] | undefined {
  const mentions = [...extensionTypes(el), ...Object.keys(vendorAttrs(el))];
  return mentions.length ? [...new Set(mentions)] : undefined;
}

/** Vendor attribute values of an element and, under `<slot>.<key>` (`definition[1].<key>`), of its nested elements. */
function vendorValues(el: El, skip: (slot: string, key: string) => boolean = () => false): Record<string, string> | undefined {
  const out: Record<string, string> = { ...vendorAttrs(el) };
  for (const { prefix, el: nested } of nestedEntries(el)) {
    for (const [k, v] of Object.entries(vendorAttrs(nested))) if (!skip(prefix, k)) out[`${prefix}.${k}`] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length ? items : undefined;
}

/** camunda:resource (any prefix) of an expression. */
function resourceOf(expr: El | undefined): { key: string; value: string } | undefined {
  if (!expr) return undefined;
  const key = Object.keys(expr.$attrs ?? {}).find((k) => /:resource$/.test(k) && !k.startsWith('xmlns'));
  const value = key ? expr.$attrs[key] : undefined;
  return key && typeof value === 'string' && value ? { key, value } : undefined;
}

function flowView(flow: El): ViewFlow {
  const source = peek<El>(flow, 'sourceRef');
  const cond = peek<El>(flow, 'conditionExpression');
  const resource = resourceOf(cond);
  return compact({
    id: idOf(flow),
    target: idOf(peek<El>(flow, 'targetRef')),
    name: nameOf(flow),
    condition: bodyOf(cond),
    conditionResource: resource?.value,
    language: cond ? peek<string>(cond, 'language') || undefined : undefined,
    default: source && peek<El>(source, 'default') === flow ? true : undefined,
    attrs: vendorValues(flow, (slot, key) => slot === 'condition' && key === resource?.key),
    extensions: extensionMentions(flow),
    extensionElements: nonEmpty(extensionTypes(flow)),
  });
}

/* ------------------------------------------------------------------ */
/* nodes                                                                */
/* ------------------------------------------------------------------ */

interface ViewCtx {
  doc: Doc;
  expansion: Map<string, boolean>;
}

function buildNodes(ctx: ViewCtx, scope: El): ViewNode[] {
  const { ordered, unreachable } = flowOrder(ctx.doc, scope);
  return ordered.map((node) => buildNode(ctx, node, unreachable));
}

function buildNode(ctx: ViewCtx, el: El, unreachable: Set<El>): ViewNode {
  const { doc } = ctx;
  const id = idOf(el);
  const isSub = is(el, 'bpmn:SubProcess');
  const boundary = is(el, 'bpmn:Activity') ? doc.boundaryEventsOf(el).map((b) => buildNode(ctx, b, unreachable)) : [];
  return compact<ViewNode>({
    id,
    kind: kindLabel(el),
    type: el.$type,
    name: nameOf(el),
    trigger: is(el, 'bpmn:Event') ? triggerText(el) : undefined,
    nonInterrupting: nonInterruptingOf(el),
    documentation: documentationOf(el),
    outgoing: doc.outgoing(el).map(flowView),
    incoming: doc.incoming(el).map(idOf),
    lane: is(el, 'bpmn:BoundaryEvent') ? undefined : laneOf(doc, el)?.get<string>('id'),
    boundary: boundary.length ? boundary : undefined,
    children: isSub ? buildNodes(ctx, el) : undefined,
    expanded: isSub ? ctx.expansion.get(id) !== false : undefined,
    unreachable: unreachable.has(el) ? true : undefined,
    props: nodeProps(el),
    attrs: vendorValues(el),
    extensions: extensionMentions(el),
    extensionElements: nonEmpty(extensionTypes(el)),
  });
}

/* ------------------------------------------------------------------ */
/* lanes, data, annotations                                             */
/* ------------------------------------------------------------------ */

function buildLanes(laneSet: El | undefined): ViewLane[] {
  if (!laneSet) return [];
  return list(laneSet, 'lanes').map((lane) => {
    const nested = buildLanes(peek<El>(lane, 'childLaneSet'));
    return compact<ViewLane>({
      id: idOf(lane),
      name: nameOf(lane),
      members: list(lane, 'flowNodeRef').map(idOf),
      lanes: nested.length ? nested : undefined,
    });
  });
}

/** The process and every sub-process nested in it, in tree order. */
function scopesWithin(process: El): El[] {
  return [...walk(process)].filter((e) => is(e, 'bpmn:Process') || is(e, 'bpmn:SubProcess'));
}

function buildData(doc: Doc, process: El): ViewData[] {
  const scopes = scopesWithin(process);
  const nodes = scopes.flatMap((s) => doc.flowNodes(s));
  const out: ViewData[] = [];
  for (const scope of scopes) {
    for (const el of doc.flowElements(scope)) {
      const kind = is(el, 'bpmn:DataObjectReference') ? 'dataObject' : is(el, 'bpmn:DataStoreReference') ? 'dataStore' : undefined;
      if (!kind) continue;
      const from: string[] = [];
      const to: string[] = [];
      for (const node of nodes) {
        if (list(node, 'dataOutputAssociations').some((a) => peek<El>(a, 'targetRef') === el)) from.push(idOf(node));
        if (list(node, 'dataInputAssociations').some((a) => list(a, 'sourceRef').includes(el))) to.push(idOf(node));
      }
      out.push(compact<ViewData>({ id: idOf(el), kind, name: nameOf(el), from, to }));
    }
  }
  return out;
}

function buildAnnotations(doc: Doc, process: El): ViewAnnotation[] {
  const scopes = scopesWithin(process);
  const collab = doc.collaboration();
  const associations = [...scopes, ...(collab ? [collab] : [])].flatMap((s) => list(s, 'artifacts')).filter((a) => is(a, 'bpmn:Association'));
  const out: ViewAnnotation[] = [];
  for (const scope of scopes) {
    for (const el of list(scope, 'artifacts')) {
      if (!is(el, 'bpmn:TextAnnotation')) continue;
      const attachedTo: string[] = [];
      for (const a of associations) {
        const source = peek<El>(a, 'sourceRef');
        const target = peek<El>(a, 'targetRef');
        if (source === el && target) attachedTo.push(idOf(target));
        else if (target === el && source) attachedTo.push(idOf(source));
      }
      const text = peek<string>(el, 'text');
      out.push(compact<ViewAnnotation>({ id: idOf(el), text: text ? String(text) : undefined, attachedTo }));
    }
  }
  return out;
}

function buildProcess(ctx: ViewCtx, process: El): ViewProcess {
  const { doc } = ctx;
  return compact<ViewProcess>({
    id: idOf(process),
    name: nameOf(process),
    executable: peek<boolean>(process, 'isExecutable') === true,
    participant: doc.participantOf(process)?.get<string>('id'),
    attrs: vendorValues(process),
    extensions: extensionMentions(process),
    extensionElements: nonEmpty(extensionTypes(process)),
    lanes: list(process, 'laneSets').flatMap((ls) => buildLanes(ls)),
    nodes: buildNodes(ctx, process),
    data: buildData(doc, process),
    annotations: buildAnnotations(doc, process),
  });
}

/* ------------------------------------------------------------------ */
/* whole model                                                          */
/* ------------------------------------------------------------------ */

const ROOT_KINDS: Array<[string, string]> = [
  ['bpmn:Message', 'message'],
  ['bpmn:Error', 'error'],
  ['bpmn:Signal', 'signal'],
  ['bpmn:Escalation', 'escalation'],
];

function buildRootElements(doc: Doc): ModelView['rootElements'] {
  const out: ModelView['rootElements'] = [];
  for (const el of doc.definitions.get<El[]>('rootElements')) {
    const match = ROOT_KINDS.find(([type]) => is(el, type));
    if (!match) continue;
    const code = peek<string>(el, 'errorCode') ?? peek<string>(el, 'escalationCode');
    out.push(compact({ id: idOf(el), kind: match[1], name: nameOf(el), code: code || undefined }));
  }
  return out;
}

function buildCollaboration(doc: Doc): ModelView['collaboration'] {
  const collab = doc.collaboration();
  if (!collab) return undefined;
  return {
    id: idOf(collab),
    participants: doc.participants().map((p) => compact({ id: idOf(p), name: nameOf(p), process: peek<El>(p, 'processRef')?.get<string>('id') })),
    messageFlows: doc.messageFlows().map((mf) =>
      compact<ViewMessageFlow>({
        id: idOf(mf),
        source: idOf(peek<El>(mf, 'sourceRef')),
        target: idOf(peek<El>(mf, 'targetRef')),
        name: nameOf(mf),
        message: peek<El>(mf, 'messageRef') ? refLabel(peek<El>(mf, 'messageRef')) : undefined,
      }),
    ),
  };
}

/** Vendor namespace prefixes declared on the definitions (bpmn/di/xsi left out). */
function vendorNamespaces(doc: Doc): string[] {
  const attrs = (doc.definitions.$attrs ?? {}) as Record<string, unknown>;
  return Object.keys(attrs)
    .filter((k) => k.startsWith('xmlns:'))
    .map((k) => k.slice('xmlns:'.length))
    .filter((prefix) => !STANDARD_NS.has(prefix));
}

/** Builds the complete semantic view of a document (see contract above). */
export function buildView(doc: Doc): ModelView {
  const ctx: ViewCtx = { doc, expansion: diExpansionState(doc.definitions) };
  const { errors, warnings } = validateDoc(doc);
  return compact<ModelView>({
    file: doc.file,
    definitions: compact({
      id: idOf(doc.definitions),
      targetNamespace: peek<string>(doc.definitions, 'targetNamespace'),
      namespaces: vendorNamespaces(doc),
    }),
    collaboration: buildCollaboration(doc),
    processes: doc.processes().map((p) => buildProcess(ctx, p)),
    rootElements: buildRootElements(doc),
    problems: [...errors, ...warnings],
    importWarnings: nonEmpty(doc.lossyImportWarnings.map((w) => w.message.split('\n')[0]!)),
  });
}

/* ------------------------------------------------------------------ */
/* one element                                                          */
/* ------------------------------------------------------------------ */

/** Facts the view derives itself; readProperties() (ops/set.ts) overrides them key by key. */
function baseProperties(doc: Doc, el: El): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const documentation = documentationOf(el);
  if (documentation) props['documentation'] = documentation;
  if (is(el, 'bpmn:Event')) {
    const trigger = triggerOf(el);
    if (trigger) props['trigger'] = trigger;
    const details = triggerText(el);
    if (details) props['triggerDetails'] = details;
    if (nonInterruptingOf(el)) props['nonInterrupting'] = true;
  }
  if (is(el, 'bpmn:SubProcess')) {
    props['expanded'] = diExpansionState(doc.definitions).get(idOf(el)) !== false;
    if (isEventSubProcess(el)) props['triggeredByEvent'] = true;
  }
  Object.assign(props, nodeProps(el) ?? {});
  if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association')) {
    props['source'] = idOf(peek<El>(el, 'sourceRef'));
    props['target'] = idOf(peek<El>(el, 'targetRef'));
  }
  if (is(el, 'bpmn:SequenceFlow')) {
    const cond = peek<El>(el, 'conditionExpression');
    const body = bodyOf(cond);
    if (body) props['condition'] = body;
    const language = cond ? peek<string>(cond, 'language') : undefined;
    if (language) props['language'] = language;
    const source = peek<El>(el, 'sourceRef');
    if (source && peek<El>(source, 'default') === el) props['default'] = true;
  }
  if (is(el, 'bpmn:MessageFlow') && peek<El>(el, 'messageRef')) props['message'] = refLabel(peek<El>(el, 'messageRef'));
  if (is(el, 'bpmn:Participant')) {
    const process = peek<El>(el, 'processRef');
    props['process'] = process ? idOf(process) : undefined;
    if (!process) props['blackBox'] = true;
  }
  if (is(el, 'bpmn:Lane')) props['members'] = list(el, 'flowNodeRef').map(idOf);
  if (is(el, 'bpmn:TextAnnotation')) props['text'] = peek<string>(el, 'text');
  if (is(el, 'bpmn:Process')) props['isExecutable'] = peek<boolean>(el, 'isExecutable') === true;
  if (is(el, 'bpmn:Error')) props['errorCode'] = peek<string>(el, 'errorCode');
  if (is(el, 'bpmn:Escalation')) props['escalationCode'] = peek<string>(el, 'escalationCode');
  if (is(el, 'bpmn:DataStoreReference')) props['dataStore'] = peek<El>(el, 'dataStoreRef') ? refLabel(peek<El>(el, 'dataStoreRef')) : undefined;
  if (is(el, 'bpmn:FlowNode')) {
    const def = peek<El>(el, 'default');
    if (def) props['default'] = idOf(def);
  }
  return compact(props);
}

/** Everything about one element, for `bpmn show <id>`. */
export function elementDetail(doc: Doc, el: El): ElementDetail {
  repairFlowLinks(doc);
  const isNode = is(el, 'bpmn:FlowNode');
  const incoming = doc.incoming(el).map((f) => {
    const source = peek<El>(f, 'sourceRef');
    return compact({
      id: idOf(f),
      source: idOf(source),
      name: nameOf(f),
      condition: bodyOf(peek<El>(f, 'conditionExpression')),
      conditionResource: resourceOf(peek<El>(f, 'conditionExpression'))?.value,
      default: source && peek<El>(source, 'default') === f ? true : undefined,
    });
  });
  const nested: Record<string, NestedDetail> = {};
  for (const { prefix, el: n } of nestedEntries(el)) {
    nested[prefix] = compact<NestedDetail>({ type: n.$type, id: peek<string>(n, 'id') || undefined, attrs: vendorAttrs(n), extensions: listExtensions(n) });
  }
  const boundary = is(el, 'bpmn:Activity') ? doc.boundaryEventsOf(el).map(idOf) : [];
  const children = is(el, 'bpmn:SubProcess') ? flowOrder(doc, el).ordered.map(idOf) : [];
  const listed = listExtensions(el);
  const extensions: unknown[] = listed.length ? listed : extensionTypes(el).map((type, index) => ({ index, type }));
  const host = peek<El>(el, 'attachedToRef');
  return compact<ElementDetail>({
    id: idOf(el),
    kind: labelOf(el),
    type: el.$type,
    name: nameOf(el),
    scope: is(el, 'bpmn:Process') ? undefined : doc.scopeOf(el)?.get<string>('id'),
    process: is(el, 'bpmn:Participant') ? peek<El>(el, 'processRef')?.get<string>('id') : doc.processOf(el)?.get<string>('id'),
    lane: isNode && !is(el, 'bpmn:BoundaryEvent') ? laneOf(doc, el)?.get<string>('id') : undefined,
    host: host ? idOf(host) : undefined,
    properties: { ...baseProperties(doc, el), ...readProperties(doc, el) },
    incoming,
    outgoing: doc.outgoing(el).map(flowView),
    boundary: boundary.length ? boundary : undefined,
    children: children.length ? children : undefined,
    extensions,
    attrs: vendorAttrs(el),
    nested: Object.keys(nested).length ? nested : undefined,
  });
}

/* ------------------------------------------------------------------ */
/* search                                                               */
/* ------------------------------------------------------------------ */

/** Nested elements `find` lists by id (only for a non-empty text: modeler files give every event definition an id). */
function isNestedSearchable(el: El): boolean {
  return is(el, 'bpmn:EventDefinition') || is(el, 'bpmn:LoopCharacteristics');
}

/** Element types `find` looks at (what the AI can address by id). */
function isSearchable(el: El): boolean {
  if (/^(bpmndi|di|dc):/.test(el.$type)) return false;
  if (is(el, 'bpmn:DataObject') || is(el, 'bpmn:DataStore')) return false;
  return (
    is(el, 'bpmn:FlowElement') ||
    is(el, 'bpmn:Artifact') ||
    is(el, 'bpmn:DataAssociation') ||
    is(el, 'bpmn:Lane') ||
    is(el, 'bpmn:Participant') ||
    is(el, 'bpmn:MessageFlow') ||
    is(el, 'bpmn:Process') ||
    is(el, 'bpmn:Collaboration') ||
    is(el, 'bpmn:Message') ||
    is(el, 'bpmn:Error') ||
    is(el, 'bpmn:Signal') ||
    is(el, 'bpmn:Escalation')
  );
}

/** Non-kind labels `find --kind` also accepts. */
const EXTRA_KINDS = ['sequenceFlow', 'messageFlow', 'association', 'dataAssociation', 'process', 'collaboration', 'message', 'error', 'signal', 'escalation'];

function kindFilter(kind: string): (el: El) => boolean {
  try {
    const { def, trigger } = parseKind(kind);
    return (el) => kindOf(el)?.kind === def.kind && (!trigger || triggerOf(el) === trigger);
  } catch (err) {
    if (!(err instanceof KindError)) throw err;
    const token = kind.trim().toLowerCase();
    const extra = EXTRA_KINDS.find((k) => k.toLowerCase() === token);
    if (extra) return (el) => labelOf(el) === extra;
    throw usageError(err.message, { candidates: [...err.candidates, ...EXTRA_KINDS.filter((k) => k.toLowerCase().includes(token))] });
  }
}

/**
 * Case-insensitive substring search over ids and names (and annotation
 * texts). `kind` accepts any kind token (`userTask`, `user`, `startEvent:message`)
 * plus `sequenceFlow`, `messageFlow`, `lane`, `participant`, ... An empty
 * `text` lists every element (of the kind).
 */
/** A find hit; `match` says which vendor value matched when neither the id nor the name did. */
export interface FindHit {
  id: string;
  kind: string;
  name?: string;
  scope?: string;
  match?: string;
}

/** The first vendor value of `el` containing `q`: an attribute (also of a nested element) or an extension element attribute / body. */
function vendorMatch(el: El, q: string): string | undefined {
  for (const [k, v] of Object.entries(vendorValues(el) ?? {})) if (v.toLowerCase().includes(q)) return `${k}=${v}`;
  const visit = (exts: ExtensionInfo[] | undefined, path: string): string | undefined => {
    for (const e of exts ?? []) {
      for (const [k, v] of Object.entries(e.attrs ?? {})) if (String(v).toLowerCase().includes(q)) return `${path}${e.type} ${k}=${v}`;
      if (e.body && e.body.toLowerCase().includes(q)) return `${path}${e.type} ${truncateText(e.body, 60)}`;
      const hit = visit(e.children as ExtensionInfo[] | undefined, path);
      if (hit) return hit;
    }
    return undefined;
  };
  const own = visit(listExtensions(el), '');
  if (own) return own;
  for (const { prefix, el: nested } of nestedEntries(el)) {
    const hit = visit(listExtensions(nested), `${prefix}.`);
    if (hit) return hit;
  }
  return undefined;
}

function truncateText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

export function findElements(doc: Doc, text: string, kind?: string): FindHit[] {
  const q = text.trim().toLowerCase();
  const filter = kind ? kindFilter(kind) : undefined;
  const out: FindHit[] = [];
  for (const el of walk(doc.definitions)) {
    const nested = !isSearchable(el) && !!q && isNestedSearchable(el);
    if (!isSearchable(el) && !nested) continue;
    const id = peek<string>(el, 'id');
    if (!id) continue;
    const name = nameOf(el) ?? (is(el, 'bpmn:TextAnnotation') ? peek<string>(el, 'text') : undefined);
    let match: string | undefined;
    if (q && !id.toLowerCase().includes(q) && !(name ?? '').toLowerCase().includes(q)) {
      match = nested ? undefined : vendorMatch(el, q);
      if (!match) continue;
    }
    if (filter && !filter(el)) continue;
    out.push(compact<FindHit>({ id, kind: labelOf(el), name, scope: is(el, 'bpmn:Process') ? undefined : doc.scopeOf(el)?.get<string>('id'), match }));
  }
  return out;
}
