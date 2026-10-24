/**
 * Reading views for agents that work on large models: the neighbourhood of
 * one element and the context of one element, both in a fraction of the
 * bytes of the whole model view (src/query/ModelViewBuilder.ts). Ids only: an element is
 * addressed by its id, never by its name (names may repeat).
 *
 *   AroundWindow(doc, id, { depth, inner }).view()  `show <file> --around <id> [--depth n] [--inner]`
 *   ElementContextBuilder(doc, id).build()          `show <file> <id> --context`
 *   ElementFacts(el).implementation()               vendor values and a compact summary of the extension elements
 */
import type { DetailData, DetailMessageFlow, ViewAnnotation, ViewData, ViewFlow, ViewMessageFlow } from './model-view.js';

/** Flow steps `show --around` looks at when --depth is not given (like PR #218's `outline --around`). */
export const AROUND_DEFAULT_DEPTH = 2;

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

/** An element named in a context: id, kind, name. */
export interface ContextRef {
  id: string;
  kind: string;
  name?: string;
}

/** A neighbour along a sequence flow (or an end of a message flow): the node and the flow that connects it. */
export interface ContextLink extends ContextRef {
  flow: string;
  flowName?: string;
  condition?: string;
  default?: boolean;
  /** an end of a message flow inside a pool: that pool */
  pool?: string;
  poolName?: string;
}

/** The message an element sends or receives (a message event, a send / receive task, a message flow). */
export interface ContextMessage {
  id: string;
  name?: string;
  /** Camunda 8: the correlation key of its zeebe:subscription */
  correlationKey?: string;
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
  /** its own boundary events (every kind) */
  boundary: ContextCatch[];
  /**
   * boundary events of every kind on the sub-processes around it, inner
   * first: an interrupting one cancels the element with its sub-process, a
   * non-interrupting one (marked) runs beside it; error / escalation ones
   * catch what it throws
   */
  caughtBy: ContextCatch[];
  /** event sub-processes of every scope around it */
  eventSubProcesses: ContextEventSubProcess[];
  annotations: Array<{ id: string; text?: string }>;
  /** message flows into / out of it; for a message element also the flows of its message that end at its pool (`at`) */
  messageFlows: DetailMessageFlow[];
  /** a message event, send / receive task or message flow: its message */
  message?: ContextMessage;
  /** a message, signal, error or escalation: the elements that use it (events, send / receive tasks, message flows) */
  usedBy?: ContextRef[];
  data?: DetailData;
}
