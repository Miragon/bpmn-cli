import type { DetailData, DetailMessageFlow, ElementSummary, FlowRef, ViewAnnotation, ViewData, ViewMessageFlow } from './model-view.js';

export const AROUND_DEFAULT_DEPTH = 2;

/** What an element runs: its vendor values and its extension elements, compact. */
export interface Implementation {
  /** nested elements' values under their set keys (`definition.camunda:topic`) */
  attrs?: Record<string, string>;
  /**
   * one item per type: `io: in a, b; out c`, `zeebe:taskDefinition type=pay retries=3`,
   * `<type>: a, b` for a container, `<type> xN` for repeated types
   */
  ext?: string[];
}

export interface AroundOptions {
  depth?: number;
  inner?: boolean;
}

export interface AroundScope {
  id: string;
  kind: string;
  name?: string;
  parent?: string;
  lane?: string;
  /** false: printed as a heading only */
  inWindow: boolean;
}

export interface AroundNode extends ElementSummary {
  scope: string;
  distance: number;
  host?: string;
  expanded?: boolean;
  /** a sub-process with no node in the window: how many flow nodes it holds */
  content?: number;
  impl?: Implementation;
  /** incoming flows whose source is outside the window */
  from?: Array<Pick<FlowRef, 'id' | 'name'> & { source: string }>;
}

export interface AroundView {
  file?: string;
  around: string;
  depth: number;
  inner: boolean;
  process: { id: string; name?: string; participant?: string; participantName?: string };
  scopes: AroundScope[];
  /** flow order per scope; boundary events follow their host, sub-process nodes the sub-process */
  nodes: AroundNode[];
  messageFlows: ViewMessageFlow[];
  annotations: ViewAnnotation[];
  data: ViewData[];
  shown: { nodes: number; flows: number };
  omitted: { nodes: number; flows: number };
}

export interface ContextRef {
  id: string;
  kind: string;
  name?: string;
}

export interface ContextLink extends ContextRef {
  flow: string;
  flowName?: string;
  condition?: string;
  default?: boolean;
  pool?: string;
  poolName?: string;
}

export interface ContextMessage {
  id: string;
  name?: string;
  /** Camunda 8: its zeebe:subscription's correlation key */
  correlationKey?: string;
}

/** A boundary event or the start event of an event sub-process. */
export interface ContextCatch extends ContextRef {
  trigger?: string;
  nonInterrupting?: boolean;
  on?: string;
  to?: string[];
}

export interface ContextEventSubProcess extends ContextRef {
  in: string;
  start?: ContextCatch;
}

export interface ElementContext extends Omit<ElementSummary, 'lane' | 'outgoing'> {
  implementation?: Implementation;
  ancestors: ContextRef[];
  pool?: { id: string; name?: string };
  /** `via`: the sub-process or boundary host whose lane it inherits */
  lane?: { id: string; name?: string; via?: string; parents?: Array<{ id: string; name?: string }> };
  host?: ContextRef;
  from: ContextLink[];
  to: ContextLink[];
  boundary: ContextCatch[];
  /** boundary events on the sub-processes around it, inner first */
  caughtBy: ContextCatch[];
  eventSubProcesses: ContextEventSubProcess[];
  annotations: Array<{ id: string; text?: string }>;
  /** for a message element also the flows of its message that end at its pool (`at`) */
  messageFlows: DetailMessageFlow[];
  message?: ContextMessage;
  usedBy?: ContextRef[];
  data?: DetailData;
}
