/**
 * Reading views for agents that work on large models: the neighbourhood of
 * one element and the context of one element, both in a fraction of the
 * bytes of the whole model view (src/view.ts). Ids only: an element is
 * addressed by its id, never by its name (names may repeat).
 *
 *   aroundView(doc, id, { depth, inner })  `show <file> --around <id> [--depth n] [--inner]`
 *   elementContext(doc, id)                `show <file> <id> --context`
 *   implementationOf(el)                   vendor values and a compact summary of the extension elements
 *
 * The neighbourhood follows sequence flows in both directions, `depth` flow
 * steps from the element (default 2; a sequence flow starts from both its
 * ends). A boundary event and its host are neighbours, a throwing and a
 * catching link event of one name too. The first and last nodes of a
 * sub-process lead out to the sub-process (the window can leave it); the
 * window enters a sub-process from outside only with `inner` (its first and
 * last nodes are then neighbours of the sub-process). Nodes come in flow
 * order per scope, each with its lane, its implementation and its flows;
 * incoming flows from outside the window are listed on the node, and the
 * counts of what was left out close the header.
 *
 * The context of an element: where it is (process, pool, sub-processes),
 * its effective lane (a node inside a sub-process is in the sub-process's
 * lane), what comes before and after it (with names), its own boundary
 * events, the error / escalation boundary events of the sub-processes around
 * it, the event sub-processes of every scope around it, associated
 * annotations, message flows with the partner at the other end, data it reads
 * and writes, and its implementation in one line.
 */
import type { Doc } from './document.js';
import { usageError } from './errors.js';
import { kindLabel, triggerOf } from './kinds.js';
import { diExpansionState } from './layout.js';
import { is, type El } from './model.js';
import { laneOf } from './ops/containers.js';
import { listAllExtensions, type ExtensionInfo } from './ops/ext.js';
import { flowOrder } from './validate.js';
import {
  annotationsOf,
  associationsOf,
  dataLinksOf,
  documentationOf,
  flowView,
  isEventSubProcess,
  labelOf,
  messageFlowsOf,
  nodeProps,
  nonInterruptingOf,
  poolOf,
  scopesWithin,
  triggerText,
  vendorValues,
  type DetailData,
  type DetailMessageFlow,
  type ViewAnnotation,
  type ViewData,
  type ViewFlow,
  type ViewMessageFlow,
} from './view.js';

/** Flow steps `show --around` looks at when --depth is not given (like PR #218's `outline --around`). */
export const AROUND_DEFAULT_DEPTH = 2;

/* ------------------------------------------------------------------ */
/* small helpers                                                        */
/* ------------------------------------------------------------------ */

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

function nameOf(el: El | undefined): string | undefined {
  const n = el ? peek<unknown>(el, 'name') : undefined;
  return typeof n === 'string' && n ? n : undefined;
}

function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as Array<keyof T>) if (obj[key] === undefined) delete obj[key];
  return obj;
}

function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length ? items : undefined;
}

function short(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

/** A value inside a summary item: bare when short and plain, else quoted and truncated. */
function itemValue(value: string, max = 40): string {
  return /^[^\s,;[\]"]+$/.test(value) && value.length <= max ? value : `"${short(value, max).replace(/"/g, '\\"')}"`;
}

function isSubProcess(el: El): boolean {
  return is(el, 'bpmn:SubProcess');
}

function isLink(el: El, side: 'throw' | 'catch'): boolean {
  return is(el, side === 'throw' ? 'bpmn:IntermediateThrowEvent' : 'bpmn:IntermediateCatchEvent') && triggerOf(el) === 'link';
}

function linkName(el: El): string | undefined {
  const def = list(el, 'eventDefinitions').find((d) => is(d, 'bpmn:LinkEventDefinition'));
  const name = def ? peek<unknown>(def, 'name') : undefined;
  return typeof name === 'string' && name ? name : undefined;
}

/* ------------------------------------------------------------------ */
/* implementation summary                                               */
/* ------------------------------------------------------------------ */

/** What an element runs: its vendor values (as `show` prints them) and its extension elements, compact. */
export interface Implementation {
  /** vendor attribute values; those of nested elements under their set keys (`definition.camunda:topic`) */
  attrs?: Record<string, string>;
  /**
   * extension elements, one item per type: `io: in a, b; out c` for an
   * input / output mapping (camunda / operaton inputOutput, zeebe:ioMapping),
   * `<type> key=value ...` for one element without children
   * (`zeebe:taskDefinition type=pay retries=3`), `<type>: a, b` for one
   * container (its children's names / ids), `<type> xN` for repeated types;
   * nested elements' under their prefix (`loop.camunda:failedJobRetryTimeCycle`)
   */
  ext?: string[];
}

/** The names an io mapping gives its inputs and outputs (camunda: name, zeebe: target). */
function ioItem(e: ExtensionInfo | Omit<ExtensionInfo, 'index'>): string | undefined {
  const local = e.type.split(':')[1] ?? e.type;
  const isIo = local === 'inputOutput' || e.type === 'zeebe:ioMapping';
  if (!isIo) return undefined;
  const ins: string[] = [];
  const outs: string[] = [];
  for (const c of e.children ?? []) {
    const cl = c.type.split(':')[1] ?? c.type;
    const name = c.attrs['name'] ?? c.attrs['target'] ?? '?';
    if (cl === 'inputParameter' || cl === 'input') ins.push(name);
    else if (cl === 'outputParameter' || cl === 'output') outs.push(name);
  }
  const parts = [ins.length ? `in ${ins.join(', ')}` : '', outs.length ? `out ${outs.join(', ')}` : ''].filter(Boolean);
  return `io: ${parts.length ? parts.join('; ') : 'empty'}`;
}

/** The key a child of a container is known by (its name, id, target or event), else its local type. */
function childKey(c: Omit<ExtensionInfo, 'index'>): string {
  return c.attrs['name'] ?? c.attrs['id'] ?? c.attrs['key'] ?? c.attrs['target'] ?? c.attrs['event'] ?? (c.type.split(':')[1] ?? c.type);
}

const MAX_CHILDREN = 6;

function extensionItem(e: ExtensionInfo): string {
  const prefix = e.slot ? `${e.slot}.` : '';
  const io = ioItem(e);
  if (io) return `${prefix}${io}`;
  const children = e.children ?? [];
  if (!children.length) {
    const attrs = Object.entries(e.attrs).map(([k, v]) => `${k}=${itemValue(v)}`);
    const body = e.body?.trim() ? [`body=${itemValue(e.body)}`] : [];
    return [`${prefix}${e.type}`, ...attrs, ...body].join(' ');
  }
  const keys = children.slice(0, MAX_CHILDREN).map(childKey);
  return `${prefix}${e.type}: ${keys.join(', ')}${children.length > MAX_CHILDREN ? `, +${children.length - MAX_CHILDREN} more` : ''}`;
}

/** Vendor values and a compact summary of the extension elements of an element (and of its nested elements). */
export function implementationOf(el: El): Implementation | undefined {
  const attrs = vendorValues(el);
  const all = listAllExtensions(el);
  const groups = new Map<string, ExtensionInfo[]>();
  for (const e of all) {
    const key = `${e.slot ? `${e.slot}.` : ''}${e.type}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const ext = [...groups].map(([key, items]) => (items.length > 1 ? `${key} x${items.length}` : extensionItem(items[0]!)));
  return attrs || ext.length ? compact<Implementation>({ attrs, ext: nonEmpty(ext) }) : undefined;
}

/* ------------------------------------------------------------------ */
/* lanes                                                                */
/* ------------------------------------------------------------------ */

/** The lane of a node: its own, a boundary event's host's, else the lane of the nearest sub-process around it (`via`). */
function effectiveLane(doc: Doc, el: El): { lane: El; via?: El } | undefined {
  const own = laneOf(doc, el);
  if (own) return { lane: own };
  const host = is(el, 'bpmn:BoundaryEvent') ? peek<El>(el, 'attachedToRef') : undefined;
  if (host) {
    const found = effectiveLane(doc, host);
    if (found) return { lane: found.lane, via: found.via ?? host };
  }
  let scope = doc.scopeOf(el);
  while (scope && isSubProcess(scope)) {
    const lane = laneOf(doc, scope);
    if (lane) return { lane, via: scope };
    scope = doc.scopeOf(scope);
  }
  return undefined;
}

/** The lanes enclosing a lane, outermost first. */
function parentLanes(lane: El): El[] {
  const out: El[] = [];
  let p = lane.$parent as El | undefined; // a laneSet
  while (p) {
    const owner = p.$parent as El | undefined;
    if (!owner || !is(owner, 'bpmn:Lane')) break;
    out.unshift(owner);
    p = owner.$parent as El | undefined;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* --around                                                             */
/* ------------------------------------------------------------------ */

export interface AroundOptions {
  /** flow steps from the element (default AROUND_DEFAULT_DEPTH; 0 = the element alone) */
  depth?: number;
  /** also enter sub-processes from outside (their first and last nodes are neighbours of the sub-process) */
  inner?: boolean;
}

/** A scope (the process or a sub-process) that holds nodes of the window. */
export interface AroundScope {
  id: string;
  kind: string;
  name?: string;
  /** the scope around it (none for the process) */
  parent?: string;
  /** the scope's own lane (a sub-process that is a lane member) */
  lane?: string;
  /** whether the sub-process itself is a node of the window (else it is printed as a heading only) */
  inWindow: boolean;
}

export interface AroundNode {
  id: string;
  kind: string;
  name?: string;
  /** the process or sub-process the node is in */
  scope: string;
  /** flow steps from the element (0: the element itself) */
  distance: number;
  /** a boundary event: its host */
  host?: string;
  /** the lane the node is a member of (nodes in a sub-process are in its lane) */
  lane?: string;
  trigger?: string;
  nonInterrupting?: boolean;
  /** sub-processes: expanded in the drawing */
  expanded?: boolean;
  /** a sub-process none of whose nodes is in the window: how many flow nodes it holds */
  content?: number;
  props?: Record<string, unknown>;
  /** vendor values and extension elements, compact (implementationOf) */
  impl?: Implementation;
  documentation?: string;
  /** outgoing sequence flows (targets outside the window included) */
  outgoing: ViewFlow[];
  /** incoming sequence flows whose source is outside the window */
  from?: Array<{ id: string; source: string; name?: string }>;
}

export interface AroundView {
  file?: string;
  /** the element the window is centred on */
  around: string;
  depth: number;
  inner: boolean;
  process: { id: string; name?: string; participant?: string; participantName?: string };
  /** the scopes of the window's nodes, outermost first (tree order) */
  scopes: AroundScope[];
  /** the window's nodes in flow order per scope; boundary events follow their host, a sub-process's nodes follow the sub-process */
  nodes: AroundNode[];
  /** message flows that start or end at a node of the window */
  messageFlows: ViewMessageFlow[];
  /** text annotations associated with a node of the window */
  annotations: ViewAnnotation[];
  /** data objects / stores a node of the window reads or writes */
  data: ViewData[];
  shown: { nodes: number; flows: number };
  /** the process's flow nodes and sequence flows (every scope) left out of the window */
  omitted: { nodes: number; flows: number };
}

/** The first and last nodes of a scope: where a token enters it and where it leaves it. */
function isEntryOrExit(doc: Doc, node: El): boolean {
  if (is(node, 'bpmn:BoundaryEvent')) return false;
  return doc.incoming(node).length === 0 || doc.outgoing(node).length === 0;
}

function neighbours(doc: Doc, node: El, inner: boolean): El[] {
  const out: El[] = [];
  for (const f of doc.outgoing(node)) {
    const t = peek<El>(f, 'targetRef');
    if (t) out.push(t);
  }
  for (const f of doc.incoming(node)) {
    const s = peek<El>(f, 'sourceRef');
    if (s) out.push(s);
  }
  if (is(node, 'bpmn:Activity')) out.push(...doc.boundaryEventsOf(node));
  const host = is(node, 'bpmn:BoundaryEvent') ? peek<El>(node, 'attachedToRef') : undefined;
  if (host) out.push(host);
  const scope = doc.scopeOf(node);
  if (scope && (isLink(node, 'throw') || isLink(node, 'catch'))) {
    const name = linkName(node);
    const other = isLink(node, 'throw') ? 'catch' : 'throw';
    if (name) out.push(...doc.flowNodes(scope).filter((n) => isLink(n, other) && linkName(n) === name));
  }
  // leaving a sub-process: its first and last nodes lead to the sub-process
  if (scope && isSubProcess(scope) && isEntryOrExit(doc, node)) out.push(scope);
  // entering one (inner): the sub-process leads to its first and last nodes
  if (inner && isSubProcess(node)) out.push(...doc.flowNodes(node).filter((n) => isEntryOrExit(doc, n)));
  return out;
}

/** The element's nodes to start from: a flow node itself, both ends of a sequence flow. */
function seedsOf(doc: Doc, el: El, id: string): El[] {
  if (is(el, 'bpmn:FlowNode')) return [el];
  if (is(el, 'bpmn:SequenceFlow')) return [peek<El>(el, 'sourceRef'), peek<El>(el, 'targetRef')].filter((n): n is El => !!n);
  throw usageError(`--around needs a flow node or a sequence flow; "${id}" is a ${labelOf(el)}`, {
    hint: is(el, 'bpmn:Process') || is(el, 'bpmn:Participant') || isSubProcess(el) ? 'Use `bpmn show <file> --scope <id>` for a whole process, pool or sub-process.' : 'Pick a node it belongs to (`bpmn show <file> <id>` names it).',
  });
}

/** Every flow node and sequence flow of a process, in every scope. */
function processContent(doc: Doc, process: El): { nodes: El[]; flows: El[] } {
  const scopes = scopesWithin(process);
  return { nodes: scopes.flatMap((s) => doc.flowNodes(s)), flows: scopes.flatMap((s) => doc.sequenceFlows(s)) };
}

/** `show --around`: the window of `depth` flow steps around an element (see the module header). */
export function aroundView(doc: Doc, id: string, opts: AroundOptions = {}): AroundView {
  const depth = opts.depth ?? AROUND_DEFAULT_DEPTH;
  if (!Number.isInteger(depth) || depth < 0) throw usageError(`--depth must be a whole number >= 0, got ${String(opts.depth)}`);
  const inner = !!opts.inner;
  const el = doc.require(id);
  const seeds = seedsOf(doc, el, id);
  const process = doc.processOf(seeds[0] ?? el);
  if (!process) throw usageError(`"${id}" is in no process`);

  // breadth-first along the neighbourhood
  const distance = new Map<El, number>();
  let frontier = seeds;
  for (const s of seeds) distance.set(s, 0);
  for (let step = 1; step <= depth && frontier.length; step++) {
    const next: El[] = [];
    for (const node of frontier) {
      for (const n of neighbours(doc, node, inner)) {
        if (distance.has(n) || !is(n, 'bpmn:FlowNode')) continue;
        distance.set(n, step);
        next.push(n);
      }
    }
    frontier = next;
  }
  const inWindow = (n: El | undefined): n is El => !!n && distance.has(n);

  // the scopes holding window nodes, with their ancestors
  const scopeSet = new Set<El>([process]);
  for (const n of distance.keys()) {
    let s = doc.scopeOf(n);
    while (s && !scopeSet.has(s)) {
      scopeSet.add(s);
      s = doc.scopeOf(s);
    }
  }
  const expansion = diExpansionState(doc.definitions);
  const scopes: AroundScope[] = [];
  const nodes: AroundNode[] = [];

  const nodeOf = (n: El): AroundNode => {
    const sub = isSubProcess(n);
    const children = sub ? doc.flowNodes(n).filter((c) => !is(c, 'bpmn:BoundaryEvent')) : [];
    const from = doc
      .incoming(n)
      .filter((f) => !inWindow(peek<El>(f, 'sourceRef')))
      .map((f) => compact({ id: idOf(f), source: idOf(peek<El>(f, 'sourceRef')), name: nameOf(f) }));
    return compact<AroundNode>({
      id: idOf(n),
      kind: kindLabel(n),
      name: nameOf(n),
      scope: idOf(doc.scopeOf(n)),
      distance: distance.get(n)!,
      host: is(n, 'bpmn:BoundaryEvent') ? idOf(peek<El>(n, 'attachedToRef')) : undefined,
      lane: is(n, 'bpmn:BoundaryEvent') ? undefined : laneOf(doc, n)?.get<string>('id'),
      trigger: is(n, 'bpmn:Event') ? triggerText(n) : undefined,
      nonInterrupting: nonInterruptingOf(n),
      expanded: sub ? expansion.get(idOf(n)) !== false : undefined,
      content: sub && children.length && !children.some((c) => inWindow(c)) ? children.length : undefined,
      props: nodeProps(n),
      impl: implementationOf(n),
      documentation: documentationOf(n),
      outgoing: doc.outgoing(n).map(flowView),
      from: nonEmpty(from),
    });
  };

  // tree order: a scope's nodes in flow order, a host's boundary events after it, a sub-process's window after it
  const visitScope = (scope: El): void => {
    const ordered = flowOrder(doc, scope).ordered;
    const placed = new Set<El>();
    const emit = (n: El): void => {
      if (placed.has(n)) return;
      placed.add(n);
      nodes.push(nodeOf(n));
      if (is(n, 'bpmn:Activity')) for (const b of doc.boundaryEventsOf(n)) if (inWindow(b)) emit(b);
      if (isSubProcess(n) && scopeSet.has(n)) {
        scopes.push(scopeEntry(n, true));
        visitScope(n);
      }
    };
    for (const n of ordered) if (inWindow(n)) emit(n);
    // boundary events whose host is outside the window
    for (const n of doc.flowNodes(scope)) if (inWindow(n) && is(n, 'bpmn:BoundaryEvent')) emit(n);
    // sub-processes outside the window that hold window nodes: a heading, then their window
    for (const n of doc.flowNodes(scope)) {
      if (!isSubProcess(n) || inWindow(n) || !scopeSet.has(n)) continue;
      scopes.push(scopeEntry(n, false));
      visitScope(n);
    }
  };
  const scopeEntry = (s: El, shown: boolean): AroundScope =>
    compact<AroundScope>({
      id: idOf(s),
      kind: is(s, 'bpmn:Process') ? 'process' : kindLabel(s),
      name: nameOf(s),
      parent: is(s, 'bpmn:Process') ? undefined : idOf(doc.scopeOf(s)),
      lane: is(s, 'bpmn:Process') ? undefined : effectiveLane(doc, s)?.lane.get<string>('id'),
      inWindow: shown,
    });
  scopes.push(scopeEntry(process, false));
  visitScope(process);

  const content = processContent(doc, process);
  const shownFlows = content.flows.filter((f) => inWindow(peek<El>(f, 'sourceRef')) && inWindow(peek<El>(f, 'targetRef'))).length;
  const windowEls = [...distance.keys()];
  const participant = doc.participantOf(process);

  const messageFlows = doc
    .messageFlows()
    .filter((mf) => windowEls.includes(peek<El>(mf, 'sourceRef')!) || windowEls.includes(peek<El>(mf, 'targetRef')!))
    .map((mf) => {
      const source = peek<El>(mf, 'sourceRef');
      const target = peek<El>(mf, 'targetRef');
      const message = peek<El>(mf, 'messageRef');
      return compact<ViewMessageFlow>({
        id: idOf(mf),
        source: idOf(source),
        target: idOf(target),
        name: nameOf(mf),
        message: message ? (nameOf(message) ?? idOf(message)) : undefined,
        sourceName: nameOf(source),
        targetName: nameOf(target),
      });
    });

  const associations = associationsOf(doc);
  const annotations: ViewAnnotation[] = [];
  for (const n of windowEls) {
    for (const a of annotationsOf(doc, n, associations)) {
      const known = annotations.find((x) => x.id === a.id);
      if (known) known.attachedTo.push(idOf(n));
      else annotations.push(compact<ViewAnnotation>({ id: a.id, text: a.text, attachedTo: [idOf(n)] }));
    }
  }

  const data: ViewData[] = [];
  for (const n of windowEls) {
    const links = dataLinksOf(doc, n);
    for (const [side, refs] of [['to', links?.reads ?? []], ['from', links?.writes ?? []]] as const) {
      for (const r of refs) {
        const ref = doc.get(r.id);
        let entry = data.find((d) => d.id === r.id);
        if (!entry) {
          entry = compact<ViewData>({ id: r.id, kind: ref && is(ref, 'bpmn:DataStoreReference') ? 'dataStore' : 'dataObject', name: r.name, from: [], to: [] });
          data.push(entry);
        }
        entry[side].push(idOf(n));
      }
    }
  }

  return compact<AroundView>({
    file: doc.file,
    around: id,
    depth,
    inner,
    process: compact({ id: idOf(process), name: nameOf(process), participant: participant ? idOf(participant) : undefined, participantName: nameOf(participant) }),
    scopes,
    nodes,
    messageFlows,
    annotations,
    data,
    shown: { nodes: nodes.length, flows: shownFlows },
    omitted: { nodes: content.nodes.length - nodes.length, flows: content.flows.length - shownFlows },
  });
}

/* ------------------------------------------------------------------ */
/* --context                                                            */
/* ------------------------------------------------------------------ */

/** An element named in a context: id, kind, name. */
export interface ContextRef {
  id: string;
  kind: string;
  name?: string;
}

/** A neighbour along a sequence flow: the node and the flow that connects it. */
export interface ContextLink extends ContextRef {
  flow: string;
  flowName?: string;
  condition?: string;
  default?: boolean;
}

/** A catching event: a boundary event (with its host) or the start event of an event sub-process. */
export interface ContextCatch extends ContextRef {
  /** trigger details, e.g. "error PaymentFailed (PAY-1)" */
  trigger?: string;
  nonInterrupting?: boolean;
  /** a boundary event: the activity it is attached to */
  on?: string;
  /** where its outgoing flows lead */
  to?: string[];
}

/** An event sub-process of a scope around the element, with its start event. */
export interface ContextEventSubProcess extends ContextRef {
  /** the process or sub-process it belongs to */
  in: string;
  start?: ContextCatch;
}

export interface ElementContext {
  id: string;
  kind: string;
  name?: string;
  trigger?: string;
  nonInterrupting?: boolean;
  props?: Record<string, unknown>;
  documentation?: string;
  implementation?: Implementation;
  /** where the element is, outermost first: the process, then the sub-processes around it */
  ancestors: ContextRef[];
  /** the pool of its process */
  pool?: { id: string; name?: string };
  /** the lane it is in; `via` the sub-process (or a boundary event's host) whose lane it inherits; `parents` the enclosing lanes, outermost first */
  lane?: { id: string; name?: string; via?: string; parents?: Array<{ id: string; name?: string }> };
  /** a boundary event: its host */
  host?: ContextRef;
  /** what comes before it (sources of its incoming flows; a sequence flow's source) */
  from: ContextLink[];
  /** what comes after it (targets of its outgoing flows; a sequence flow's target) */
  to: ContextLink[];
  /** its own boundary events */
  boundary: ContextCatch[];
  /** error and escalation boundary events of the sub-processes around it (they catch what it throws) */
  caughtBy: ContextCatch[];
  /** event sub-processes of every scope around it */
  eventSubProcesses: ContextEventSubProcess[];
  annotations: Array<{ id: string; text?: string }>;
  messageFlows: DetailMessageFlow[];
  data?: DetailData;
}

function refOf(el: El): ContextRef {
  return compact<ContextRef>({ id: idOf(el), kind: labelOf(el), name: nameOf(el) });
}

function conditionOf(flow: El): string | undefined {
  const body = peek<El>(flow, 'conditionExpression') ? peek<unknown>(peek<El>(flow, 'conditionExpression')!, 'body') : undefined;
  return typeof body === 'string' && body ? body : undefined;
}

function linkOf(node: El, flow: El): ContextLink {
  const source = peek<El>(flow, 'sourceRef');
  return compact<ContextLink>({
    ...refOf(node),
    flow: idOf(flow),
    flowName: nameOf(flow),
    condition: conditionOf(flow),
    default: source && peek<El>(source, 'default') === flow ? true : undefined,
  });
}

function catchOf(doc: Doc, ev: El): ContextCatch {
  const host = is(ev, 'bpmn:BoundaryEvent') ? peek<El>(ev, 'attachedToRef') : undefined;
  const to = doc.outgoing(ev).map((f) => idOf(peek<El>(f, 'targetRef')));
  return compact<ContextCatch>({ ...refOf(ev), trigger: triggerText(ev), nonInterrupting: nonInterruptingOf(ev), on: host ? idOf(host) : undefined, to: nonEmpty(to) });
}

/** `show <id> --context`: the element in its context (see the module header). */
export function elementContext(doc: Doc, id: string): ElementContext {
  const el = doc.require(id);
  const isFlow = is(el, 'bpmn:SequenceFlow');
  // the sub-processes around it (inner first), then the process
  const chain: El[] = [];
  let scope = doc.scopeOf(el);
  while (scope) {
    chain.push(scope);
    scope = isSubProcess(scope) ? doc.scopeOf(scope) : undefined;
  }
  const process = doc.processOf(el);
  if (process && !chain.includes(process) && process !== el) chain.push(process);
  const ancestors = [...chain].reverse().map((s) => (is(s, 'bpmn:Process') ? compact<ContextRef>({ id: idOf(s), kind: 'process', name: nameOf(s) }) : refOf(s)));
  const pool = poolOf(doc, el);
  const lane = is(el, 'bpmn:FlowNode') ? effectiveLane(doc, el) : undefined;
  const host = is(el, 'bpmn:BoundaryEvent') ? peek<El>(el, 'attachedToRef') : undefined;

  let from: ContextLink[] = [];
  let to: ContextLink[] = [];
  if (isFlow) {
    const s = peek<El>(el, 'sourceRef');
    const t = peek<El>(el, 'targetRef');
    if (s) from = [linkOf(s, el)];
    if (t) to = [linkOf(t, el)];
  } else if (is(el, 'bpmn:FlowNode')) {
    from = doc.incoming(el).flatMap((f) => (peek<El>(f, 'sourceRef') ? [linkOf(peek<El>(f, 'sourceRef')!, f)] : []));
    to = doc.outgoing(el).flatMap((f) => (peek<El>(f, 'targetRef') ? [linkOf(peek<El>(f, 'targetRef')!, f)] : []));
  }

  const boundary = is(el, 'bpmn:Activity') ? doc.boundaryEventsOf(el).map((b) => catchOf(doc, b)) : [];
  const caughtBy: ContextCatch[] = [];
  for (const s of chain) {
    if (!isSubProcess(s)) continue;
    for (const b of doc.boundaryEventsOf(s)) {
      const t = triggerOf(b);
      if (t === 'error' || t === 'escalation') caughtBy.push(catchOf(doc, b));
    }
  }
  const eventSubProcesses: ContextEventSubProcess[] = [];
  for (const s of chain) {
    for (const n of doc.flowNodes(s)) {
      // the element itself, or an event sub-process it is inside of, does not catch it
      if (!isEventSubProcess(n) || n === el || chain.includes(n)) continue;
      const start = doc.flowNodes(n).find((c) => is(c, 'bpmn:StartEvent'));
      eventSubProcesses.push(compact<ContextEventSubProcess>({ ...refOf(n), in: idOf(s), start: start ? catchOf(doc, start) : undefined }));
    }
  }

  const laneEl = lane?.lane;
  const parents = laneEl ? parentLanes(laneEl).map((l) => compact({ id: idOf(l), name: nameOf(l) })) : [];
  return compact<ElementContext>({
    id: idOf(el),
    kind: labelOf(el),
    name: nameOf(el),
    trigger: is(el, 'bpmn:Event') ? triggerText(el) : undefined,
    nonInterrupting: nonInterruptingOf(el),
    props: nodeProps(el),
    documentation: documentationOf(el),
    implementation: implementationOf(el),
    ancestors,
    pool: pool && pool !== el ? compact({ id: idOf(pool), name: nameOf(pool) }) : undefined,
    lane: laneEl ? compact({ id: idOf(laneEl), name: nameOf(laneEl), via: lane?.via ? idOf(lane.via) : undefined, parents: nonEmpty(parents) }) : undefined,
    host: host ? refOf(host) : undefined,
    from,
    to,
    boundary,
    caughtBy,
    eventSubProcesses,
    annotations: annotationsOf(doc, el),
    messageFlows: is(el, 'bpmn:MessageFlow') ? [] : messageFlowsOf(doc, el),
    data: dataLinksOf(doc, el),
  });
}
