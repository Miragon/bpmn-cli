/**
 * The data of the read views: the model view (ModelViewBuilder), the detail
 * of one element (ElementDetailBuilder) and the hits of `find` (ElementFinder).
 *
 *  Vendor content: nodes, processes and flows carry `attrs` (vendor attribute
 *  values; those of nested elements under the `set` keys `definition.`,
 *  `loop.`, `condition.`), `extensions` (extension element types and vendor
 *  attribute names, deduplicated) and `extensionElements` (the extension
 *  element types in document order, repeated ones included).
 */
import type { Doc } from '../model/Doc.js';
import { usageError } from '../shared/utils/errors.js';
import type { Warning } from '../shared/CliError.js';
import { KindError } from '../model/KindError.js';
import { kindLabel, kindOf, parseKind, triggerOf, TRIGGER_TYPES } from '../model/utils/kinds.js';
import { diExpansionState } from '../diagram/utils/expansion.js';
import { Groups } from '../diagram/Groups.js';
import { groupName, is, localType, walk, type El, peek, list, shownId } from '../model/utils/moddle.js';
import { laneOf } from '../ops/utils/lanes.js';
import { DecisionLinkReader } from '../ops/DecisionLinkReader.js';
import { ExtensionLister, type ExtensionInfo } from '../ops/ExtensionLister.js';
import { definitionsOf, nestedEntries } from '../ops/utils/nested-slots.js';
import { vendorAttributes } from '../ops/utils/elements.js';
import { flowOrder, repairFlowLinks, validateDoc } from '../validate/structural.js';
import { ZEEBE_URI } from '../platform/ZeebeDescriptor.js';

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
  /** the names of the endpoints (a pool's name for a pool) */
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
    /** text annotations the collaboration owns (drawn next to pools; often attached to nodes inside them) */
    annotations?: ViewAnnotation[];
  };
  processes: ViewProcess[];
  /** groups of every process and of the collaboration */
  groups?: ViewGroup[];
  rootElements: Array<{ id: string; kind: string; name?: string; code?: string; correlationKey?: string }>;
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
  /** message flows into (`in`) and out of (`out`) the element, with the partner at the other end */
  messageFlows?: DetailMessageFlow[];
  /** text annotations associated with the element */
  annotations?: Array<{ id: string; text?: string }>;
  /** a text annotation: the elements it is associated with */
  attachedTo?: string[];
  /** data associations: data objects / stores a node reads and writes, or the nodes reading / writing a data element */
  data?: DetailData;
}

/** A message flow of `show <id>`: direction, the flow and the element at the other end (with its pool). */
export interface DetailMessageFlow {
  direction: 'in' | 'out';
  id: string;
  name?: string;
  message?: string;
  /** the element at the other end */
  partner: string;
  partnerName?: string;
  /** the pool of the partner when the partner is inside one (absent when the partner is a pool) */
  pool?: string;
  poolName?: string;
  /** `show <id> --context` of a message element: the flow ends at this pool (the element's), not at the element itself */
  at?: string;
}

/** Data associations of `show <id>`. */
export interface DetailData {
  /** a node: the data objects / stores it reads (data input associations) */
  reads?: Array<{ id: string; name?: string }>;
  /** a node: the data objects / stores it writes (data output associations) */
  writes?: Array<{ id: string; name?: string }>;
  /** a data object / store: the nodes reading it */
  readBy?: string[];
  /** a data object / store: the nodes writing it */
  writtenBy?: string[];
}

/** A find hit; `match` says which vendor value matched when neither the id nor the name did. */
export interface FindHit {
  id: string;
  kind: string;
  name?: string;
  scope?: string;
  match?: string;
}
