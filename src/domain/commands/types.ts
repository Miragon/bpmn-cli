/**
 * Ops are CLI flags spelled as JSON: one CLI command builds one op, `bpmn apply` runs a list of
 * them in one transaction.
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
  /** anchor: append after it, or splice into its single outgoing flow */
  after?: string;
  /** anchor: prepend before it, or splice into its single incoming flow */
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

export interface AddElement extends Placement, FlowOptions, TriggerOptions {
  op: 'add';
  kind: string;
  name?: string;
  id?: string;
  /** batch alias (`$name`) of the new element; later ops of the batch use it as an id */
  as?: string;
  /** batch alias of the flow into the new node */
  flowAs?: string;
  /** batch alias of the sequence flow the add creates out of the new node */
  outAs?: string;
  /** batch alias of the Message / Error / Signal / Escalation the new element references */
  refAs?: string;
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

export interface ConnectElements {
  op: 'connect';
  source: string;
  target: string;
  name?: string;
  id?: string;
  /** batch alias of the new connection */
  as?: string;
  /** message flows: batch alias of the bpmn:Message it carries */
  refAs?: string;
  condition?: string;
  language?: string;
  default?: boolean;
  /** message flows: name of the bpmn:Message */
  message?: string;
  ifAbsent?: boolean;
}

export interface SetProperties {
  op: 'set';
  id: string;
  values: Record<string, string>;
  unset?: string[];
  /** batch alias of the Message / Error / Signal / Escalation referenced after the change */
  refAs?: string;
}

export interface RemoveElements {
  op: 'remove';
  ids: string[];
  /** reconnect predecessor and successor when a node with 1 in / 1 out is removed (default true) */
  bridge?: boolean;
  /** a join (N incoming, 1 outgoing): connect every predecessor to the successor */
  bridgeAll?: boolean;
  /** also remove the node's exclusive downstream path, up to the next merge or the ends */
  withBranch?: boolean;
  ifExists?: boolean;
}

export interface ChangeElementType extends TriggerOptions {
  op: 'retype';
  id: string;
  kind: string;
  /** batch alias of the Message / Error / Signal / Escalation referenced after the change */
  refAs?: string;
}

export interface MoveElements extends Placement, FlowOptions {
  op: 'move';
  ids: string[];
  lane?: string;
}

export interface ReorderElements {
  op: 'order';
  /** node whose outgoing flows are ordered, or the container whose lanes / pools are ordered */
  id: string;
  /** outgoing flow ids (lane or participant ids are accepted too and order the lanes / pools) */
  flows?: string[];
  /** lane ids, top to bottom */
  lanes?: string[];
  /** participant ids (pools), top to bottom */
  pools?: string[];
}

export interface EditExtensionElements {
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
   * edit the event definition, loop characteristics or condition expression of `id` instead;
   * one of several event definitions: `definition[<n>]` / `definition[<trigger>]`
   */
  slot?: 'definition' | 'loop' | 'condition' | `definition[${string}]`;
}

export interface SplitBranch extends FlowOptions {
  /** nodes of the branch, in order, each like an AddElement without placement */
  nodes: Array<Omit<AddElement, 'op' | keyof Placement | 'to' | 'outAs' | 'ifAbsent'>>;
}

export interface SplitIntoBranches {
  op: 'split';
  /** anchor whose single outgoing flow gets the split */
  after: string;
  /** gateway kind (default exclusiveGateway) */
  kind?: string;
  name?: string;
  id?: string;
  /** batch alias of the split gateway */
  as?: string;
  /** create a joining gateway of the same kind (default true) */
  join?: boolean;
  joinId?: string;
  /** batch alias of the join gateway */
  joinAs?: string;
  joinName?: string;
  branches: SplitBranch[];
}

// format operations: diagram only

type SideName = 'left' | 'right' | 'top' | 'bottom';
type LabelSideName = 'above' | 'below' | 'left' | 'right';
type ColorName = 'blue' | 'orange' | 'green' | 'red' | 'purple' | 'default';

/** Selectors of place / align / color / tidy add elements to `ids` (connections only for color). */
export interface Selectors {
  /** [fromId, toId]: every node and flow on the shortest sequence-flow path between them */
  path?: string[];
  /** sequence flows the path must pass, in order */
  via?: string[];
  /** every element of this kind (`find --kind` grammar, e.g. endEvent, userTask, sequenceFlow) */
  kind?: string;
  /** the branch this sequence flow starts: what only it reaches, up to the join */
  branch?: string;
}

export interface PlaceShapes extends Selectors {
  op: 'place';
  /** shapes moved as one rigid group; the first id is the reference */
  ids?: string[];
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
  /** a boundary event: the host border it moves to; its exception path follows */
  side?: 'top' | 'bottom';
}

export interface AlignShapes extends Selectors {
  op: 'align';
  ids?: string[];
  axis: 'row' | 'column';
  /** reference element (default: the first id) */
  to?: string;
}

export interface ColorElements extends Selectors {
  op: 'color';
  ids?: string[];
  color: ColorName;
}

export interface PlaceLabel {
  op: 'label';
  id: string;
  side: LabelSideName;
}

export interface RerouteFlow {
  op: 'route';
  id: string;
  /** side the flow leaves its source by */
  exit?: SideName;
  /** side the flow enters its target by */
  entry?: SideName;
}

export interface InsertSpace {
  op: 'space';
  /** insert horizontal space right of this element */
  after?: string;
  /** insert vertical space below this element */
  below?: string;
  /**
   * how much: one column / row (default), a number of them ('2col', '3 rows') or pixels ('80px');
   * a negative amount closes that much empty space instead
   */
  by?: SpaceAmount;
}

/** A `space` amount: column / row steps of the drawing or pixels; negative closes. */
type SpaceAmount = 'column' | 'row' | '-column' | '-row' | number | `${number}${SpaceUnit}` | `${number} ${SpaceUnit}`;
type SpaceUnit = 'col' | 'cols' | 'column' | 'columns' | 'row' | 'rows' | 'px';

export interface TidyShapes extends Selectors {
  op: 'tidy';
  /** only these shapes (default: every shape of the diagram) */
  ids?: string[];
}

export interface CompactDiagram {
  op: 'compact';
  /** only these frames and their content (default: the whole drawing) */
  ids?: string[];
}

export type DiagramCommand = PlaceShapes | AlignShapes | ColorElements | PlaceLabel | RerouteFlow | InsertSpace | TidyShapes | CompactDiagram;

export type EditCommand = AddElement | ConnectElements | SetProperties | RemoveElements | ChangeElementType | MoveElements | ReorderElements | EditExtensionElements | SplitIntoBranches | DiagramCommand;
