/**
 * The data of the read views. `attrs` holds vendor attribute values (nested elements under the
 * `definition.` / `loop.` / `condition.` set keys), `extensions` the deduplicated extension
 * types and vendor attribute names, `extensionElements` the types in document order.
 */
import type { Warning } from '../document/CliError.js';
import type { ExtensionInfo } from '../document/ExtensionLister.js';

export interface ViewFlow {
  id: string;
  target: string;
  name?: string;
  condition?: string;
  /** camunda:resource of a script resource condition (it has no body) */
  conditionResource?: string;
  language?: string;
  default?: boolean;
  attrs?: Record<string, string>;
  extensions?: string[];
  extensionElements?: string[];
}

export interface ViewNode {
  id: string;
  kind: string;
  type: string;
  name?: string;
  trigger?: string;
  nonInterrupting?: boolean;
  documentation?: string;
  outgoing: ViewFlow[];
  incoming: string[];
  lane?: string;
  boundary?: ViewNode[];
  children?: ViewNode[];
  expanded?: boolean;
  unreachable?: boolean;
  /** e.g. loop=parallel, calledElement=X */
  props?: Record<string, unknown>;
  attrs?: Record<string, string>;
  extensions?: string[];
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
  from: string[];
  to: string[];
}

export interface ViewAnnotation {
  id: string;
  text?: string;
  attachedTo: string[];
}

export interface ViewGroup {
  id: string;
  name?: string;
  /** the elements its box holds and those that reference its category value */
  members: string[];
}

export interface ViewProcess {
  id: string;
  name?: string;
  executable: boolean;
  participant?: string;
  attrs?: Record<string, string>;
  extensions?: string[];
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
  sourceName?: string;
  targetName?: string;
}

export interface ModelView {
  file?: string;
  definitions: { id: string; targetNamespace?: string; namespaces: string[] };
  collaboration?: {
    id: string;
    participants: Array<{ id: string; name?: string; process?: string }>;
    messageFlows: ViewMessageFlow[];
    /** owned by the collaboration, often attached to nodes inside pools */
    annotations?: ViewAnnotation[];
  };
  processes: ViewProcess[];
  groups?: ViewGroup[];
  rootElements: Array<{ id: string; kind: string; name?: string; code?: string; correlationKey?: string }>;
  problems: Warning[];
  /** content the reader could not keep; a write needs --force and drops it */
  importWarnings?: string[];
}

/** An event definition, loop characteristics or condition of `show <id>`. */
export interface NestedDetail {
  type: string;
  id?: string;
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
  /** by set-key prefix; definition[<n>] when an event has several */
  nested?: Record<string, NestedDetail>;
  messageFlows?: DetailMessageFlow[];
  annotations?: Array<{ id: string; text?: string }>;
  attachedTo?: string[];
  data?: DetailData;
}

export interface DetailMessageFlow {
  direction: 'in' | 'out';
  id: string;
  name?: string;
  message?: string;
  partner: string;
  partnerName?: string;
  /** absent when the partner is a pool itself */
  pool?: string;
  poolName?: string;
  /** `--context` of a message element: the flow ends at this pool, not at the element */
  at?: string;
}

export interface DetailData {
  reads?: Array<{ id: string; name?: string }>;
  writes?: Array<{ id: string; name?: string }>;
  readBy?: string[];
  writtenBy?: string[];
}

/** `match`: the vendor value that matched when neither the id nor the name did. */
export interface FindHit {
  id: string;
  kind: string;
  name?: string;
  scope?: string;
  match?: string;
}
