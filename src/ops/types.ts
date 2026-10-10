/**
 * Operations = "CLI flags spelled as JSON". One CLI command builds one op;
 * `bpmn apply` runs a list of them in one transaction.
 */

export interface TriggerOptions {
  /** ISO 8601 timer: `R/PT1H` (cycle), `PT5M` (duration) or a date; classified automatically */
  timer?: string;
  timerKind?: 'cycle' | 'duration' | 'date';
  /** name of the bpmn:Message (created at root level when missing) */
  message?: string;
  /** name of the bpmn:Error (created when missing) */
  error?: string;
  errorCode?: string;
  signal?: string;
  escalation?: string;
  escalationCode?: string;
  /** expression of a conditional event */
  when?: string;
  /** link name (link events) */
  link?: string;
  /** boundary events / event sub-process starts: cancelActivity=false / isInterrupting=false */
  nonInterrupting?: boolean;
}

export interface Placement {
  /** anchor: append after a gateway / unconnected node, or splice into the anchor's single outgoing flow */
  after?: string;
  /** anchor: prepend before a join / unconnected node, or splice into the anchor's single incoming flow */
  before?: string;
  /** splice into this sequence flow */
  flow?: string;
  /** container (process / sub-process / participant) when nothing else anchors the node */
  in?: string;
  /** boundary events: host activity */
  on?: string;
}

export interface FlowOptions {
  flowName?: string;
  flowId?: string;
  /** condition expression of the flow into the new node (from the anchor) */
  condition?: string;
  /** expression language of the condition */
  language?: string;
  /** mark the flow into the new node as the gateway's default flow */
  default?: boolean;
}

export interface AddOp extends Placement, FlowOptions, TriggerOptions {
  op: 'add';
  kind: string;
  name?: string;
  id?: string;
  /** also connect the new node to this target (branch that re-joins) */
  to?: string;
  lane?: string;
  /** sub-processes: collapsed instead of expanded */
  collapsed?: boolean;
  /** with an explicit id: succeed without changes when the element already exists */
  ifAbsent?: boolean;
  doc?: string;
  /** extra key=value properties (same keys as `set`) */
  set?: Record<string, string>;
  /** participant: bind an existing process */
  process?: string;
  /** participant without a process */
  blackBox?: boolean;
  /** text annotation text */
  text?: string;
  /** lanes: initial member node ids */
  members?: string[];
}

export interface ConnectOp {
  op: 'connect';
  source: string;
  target: string;
  name?: string;
  id?: string;
  condition?: string;
  language?: string;
  default?: boolean;
  /** message flows: name of the bpmn:Message */
  message?: string;
  ifAbsent?: boolean;
}

export interface SetOp {
  op: 'set';
  id: string;
  values: Record<string, string>;
  unset?: string[];
}

export interface RemoveOp {
  op: 'remove';
  ids: string[];
  /** reconnect predecessor and successor when a node with 1 in / 1 out is removed (default true) */
  bridge?: boolean;
  ifExists?: boolean;
}

export interface RetypeOp extends TriggerOptions {
  op: 'retype';
  id: string;
  kind: string;
}

export interface MoveOp extends Placement, FlowOptions {
  op: 'move';
  ids: string[];
  lane?: string;
}

export interface OrderOp {
  op: 'order';
  /** the node whose outgoing flows are ordered, or the process / participant / parent lane whose lanes are ordered */
  id: string;
  /** outgoing flow ids (lane ids are accepted too and order the lanes) */
  flows?: string[];
  /** lane ids, top to bottom */
  lanes?: string[];
}

export interface ExtOp {
  op: 'ext';
  id: string;
  action: 'add' | 'remove';
  /** prefixed element type, e.g. `zeebe:taskDefinition` */
  type?: string;
  attrs?: Record<string, string>;
  body?: string;
  /** raw XML snippet (may contain nested elements) */
  xml?: string;
  /** add: replace an existing element of the same type */
  replace?: boolean;
  /** remove: index within extensionElements (alternative to type) */
  index?: number;
  /**
   * a nested element of `id` instead of the element itself: its event definition,
   * loop characteristics or condition expression (also given as a `<slot>.` prefix of type;
   * one of several event definitions: `definition[<n>]` / `definition[<trigger>]`)
   */
  slot?: 'definition' | 'loop' | 'condition' | `definition[${string}]`;
}

export interface SplitBranch extends FlowOptions {
  /** nodes of the branch, in order (each like an AddOp without placement) */
  nodes: Array<Omit<AddOp, 'op' | keyof Placement | 'to' | 'ifAbsent'>>;
}

export interface SplitOp {
  op: 'split';
  /** anchor whose single outgoing flow (or which, when unconnected/gateway) gets the split */
  after: string;
  /** gateway kind (default exclusiveGateway) */
  kind?: string;
  name?: string;
  id?: string;
  /** create a joining gateway of the same kind (default true) */
  join?: boolean;
  joinId?: string;
  joinName?: string;
  branches: SplitBranch[];
}

/* ------------------------------------------------------------------ */
/* format operations: diagram only, see src/diagram/ops.ts               */
/* ------------------------------------------------------------------ */

export type SideName = 'left' | 'right' | 'top' | 'bottom';
export type LabelSideName = 'above' | 'below' | 'left' | 'right';
export type ColorName = 'blue' | 'orange' | 'green' | 'red' | 'purple' | 'default';

export interface PlaceOp {
  op: 'place';
  /** shapes moved as one rigid group; the first id is the reference */
  ids: string[];
  /** row: centre on the row of this element */
  rowOf?: string;
  /** row: the row below this element */
  below?: string;
  /** row: the row above this element */
  above?: string;
  /** column: centre on the column of this element */
  columnOf?: string;
  /** column: the column right of this element */
  after?: string;
  /** column: the column left of this element */
  before?: string;
}

export interface AlignOp {
  op: 'align';
  ids: string[];
  axis: 'row' | 'column';
  /** reference element (default: the first id) */
  to?: string;
}

export interface ColorOp {
  op: 'color';
  ids: string[];
  color: ColorName;
}

export interface LabelOp {
  op: 'label';
  id: string;
  side: LabelSideName;
}

export interface RouteOp {
  op: 'route';
  id: string;
  /** side the flow leaves its source by */
  exit?: SideName;
  /** side the flow enters its target by */
  entry?: SideName;
}

export interface SpaceOp {
  op: 'space';
  /** insert horizontal space right of this element */
  after?: string;
  /** insert vertical space below this element */
  below?: string;
  /**
   * how much: one column / row of the drawing (default), or pixels; negative
   * ('-column', '-row', a negative number) closes that much empty space instead
   */
  by?: 'column' | 'row' | '-column' | '-row' | number;
}

export interface TidyOp {
  op: 'tidy';
  /** only these shapes (default: every shape of the diagram) */
  ids?: string[];
}

export interface CompactOp {
  op: 'compact';
  /** only these frames (pools, lanes, expanded sub-processes) and what is inside them (default: the whole drawing) */
  ids?: string[];
}

export type FormatOp = PlaceOp | AlignOp | ColorOp | LabelOp | RouteOp | SpaceOp | TidyOp | CompactOp;

export type Op = AddOp | ConnectOp | SetOp | RemoveOp | RetypeOp | MoveOp | OrderOp | ExtOp | SplitOp | FormatOp;

/** The diagram-only ops (they run after the semantic ops and the layout, in batch order). */
export const FORMAT_OP_NAMES: Array<FormatOp['op']> = ['place', 'align', 'color', 'label', 'route', 'space', 'tidy', 'compact'];

export const OP_NAMES: Array<Op['op']> = ['add', 'connect', 'set', 'remove', 'retype', 'move', 'order', 'ext', 'split', ...FORMAT_OP_NAMES];

export function isFormatOp(op: Op): op is FormatOp {
  return (FORMAT_OP_NAMES as string[]).includes(op.op);
}
