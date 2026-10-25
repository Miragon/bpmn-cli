/**
 * The field specs of the `bpmn apply` ops format, the single source for the parser, the
 * JSON Schema and the batch aliases. `FieldsOf` makes a missing or extra key a compile error.
 */
import { alias, bool, list, map, ref, str, type FieldSpec, type FieldsOf, type SplitNode } from './field-specs.js';
import type { AddOp, AlignOp, ColorOp, ConnectOp, ExtOp, LabelOp, PlaceOp, RouteOp, SpaceOp, TidyOp, CompactOp, FlowOptions, MoveOp, Op, OrderOp, Placement, RemoveOp, RetypeOp, SetOp, Selectors, SplitBranch, SplitOp, TriggerOptions } from '../types.js';

export const PLACEMENT_FIELDS: FieldsOf<Placement> = {
  after: ref("Anchor id: append after a gateway or an unconnected node, or splice into the anchor's single outgoing flow. Together with `before`: splice into the flow after -> before."),
  before: ref("Anchor id: prepend before a join gateway or an unconnected node, or splice into the anchor's single incoming flow."),
  flow: ref('Sequence flow id to splice the node into (A -> B becomes A -> node -> B).'),
  in: ref('Container id (process, sub-process or participant): put the node there without connecting it.'),
  on: ref('Boundary events only: id of the host activity.'),
};

export const FLOW_FIELDS: FieldsOf<FlowOptions> = {
  flowName: str('Label of the flow into the new node.'),
  flowId: ref('Explicit id of the flow into the new node (only used when a new flow is created; a move that leaves its nodes in place renames the flow into the first node).'),
  condition: str('Condition expression of the flow into the new node, e.g. "${ok}".'),
  language: str('Expression language of `condition` (omit for the engine default).'),
  default: bool('Mark the flow into the new node as the default flow of its source (exclusive/inclusive gateway or activity).'),
};

export const TRIGGER_FIELDS: FieldsOf<TriggerOptions> = {
  timer: str('ISO 8601 timer: "R/PT1H" (cycle), "PT5M" (duration) or "2026-01-31T09:00:00Z" (date); classified automatically.'),
  timerKind: str('Override the automatic timer classification.', { values: ['cycle', 'duration', 'date'] }),
  message: str('Name of the bpmn:Message (created at root level when missing); message events and send / receive tasks.'),
  error: str('Name of the bpmn:Error (created at root level when missing).'),
  errorCode: str('errorCode of the bpmn:Error.'),
  signal: str('Name of the bpmn:Signal (created at root level when missing).'),
  escalation: str('Name of the bpmn:Escalation (created at root level when missing).'),
  escalationCode: str('escalationCode of the bpmn:Escalation.'),
  when: str('Condition expression of a conditional event.'),
  link: str('Link name of a link event (a throw and a catch event pair up by name).'),
  nonInterrupting: bool('Boundary events: cancelActivity=false; start events of an event sub-process: isInterrupting=false.'),
};

const REF_AS = 'Batch alias of the bpmn:Message / Error / Signal / Escalation the element references after the op (the one `message` / `error` / `signal` / `escalation` created or found; E_USAGE when it references none), e.g. "$msg"; then `{"op": "ext", "id": "$msg", "action": "add", "type": "zeebe:subscription", ...}`.';
const KIND_FIELD = ref('Element kind with optional trigger suffix, e.g. "userTask", "startEvent:message", "boundaryEvent:timer" (see `bpmn kinds`).', { required: true });

export const NODE_FIELDS: FieldsOf<SplitNode> = {
  kind: KIND_FIELD,
  name: str('Display name. Also drives the generated id (<Prefix>_<NameSlug> in the default style; new ids follow the id style of the file).'),
  id: ref('Explicit id (default: a speaking id in the id style of the file: <Prefix>_<NameSlug>, unnamed elements <Prefix>_<Kind><Context> such as Gateway_AfterCheckInvoice). A later op of the batch refers to the element by this id or by an alias ("as").'),
  as: alias('Batch alias of the new element: "$" + a name, e.g. "$check".'),
  flowAs: alias('Batch alias of the flow into the new node (the flow the flow options describe; with "before" on a join or an unconnected node: the flow out of it).'),
  refAs: alias(REF_AS),
  lane: ref('Lane id the node is assigned to (default: the lane of the anchor / host; into a flow between two lanes: the target\'s after a branching source, else the anchor\'s, with W_LANE_INHERITED).'),
  ...FLOW_FIELDS,
  ...TRIGGER_FIELDS,
  collapsed: bool('Sub-processes: draw collapsed instead of expanded.'),
  doc: str('Documentation text of the element.'),
  set: map('Extra properties, same keys as the `set` op (e.g. {"camunda:assignee": "kermit"}).'),
  process: ref('Participants: bind this existing (unbound) process instead of creating a new one.'),
  blackBox: bool('Participants: create no process (black-box pool).'),
  text: str('Text annotations: the annotation text.'),
  members: list('Lanes: initial member node ids. Groups (required): the elements the group is drawn around.'),
};

export const ADD_FIELDS: FieldsOf<AddOp> = {
  kind: NODE_FIELDS.kind,
  name: NODE_FIELDS.name,
  id: NODE_FIELDS.id,
  as: NODE_FIELDS.as,
  flowAs: NODE_FIELDS.flowAs,
  outAs: alias('Batch alias of the flow the add creates out of the new node (a splice: to the old successor; a prepend: to the anchor; else to `to`); E_USAGE when it creates none or two.'),
  refAs: NODE_FIELDS.refAs,
  ...PLACEMENT_FIELDS,
  to: ref('Also connect the new node to this target (a branch that re-joins).'),
  lane: NODE_FIELDS.lane,
  ...FLOW_FIELDS,
  ...TRIGGER_FIELDS,
  collapsed: NODE_FIELDS.collapsed,
  ifAbsent: bool('With an explicit id: succeed without changes when the element already exists.'),
  doc: NODE_FIELDS.doc,
  set: NODE_FIELDS.set,
  process: NODE_FIELDS.process,
  blackBox: NODE_FIELDS.blackBox,
  text: NODE_FIELDS.text,
  members: NODE_FIELDS.members,
};

export const CONNECT_FIELDS: FieldsOf<ConnectOp> = {
  source: ref('Source element id.', { required: true }),
  target: ref('Target element id.', { required: true }),
  name: str('Label of the connection (sequence flows only).'),
  id: ref('Explicit id of the connection.'),
  as: alias('Batch alias of the new connection (with ifAbsent and an existing one: that one).'),
  refAs: alias('Message flows: batch alias of the bpmn:Message it carries (created or found by `message`).'),
  condition: str('Condition expression (sequence flows only).'),
  language: str('Expression language of `condition`.'),
  default: bool('Make it the default flow of the source (sequence flows only).'),
  message: str('Message flows: name of the bpmn:Message (created when missing).'),
  ifAbsent: bool('Succeed without changes when an identical connection already exists.'),
};

export const SET_FIELDS: FieldsOf<SetOp> = {
  id: ref('Element id.', { required: true }),
  values: map('Properties to set (`bpmn kinds` lists the keys per element family); an empty string removes the property.'),
  unset: list('Keys to remove.', { minItems: 1 }),
  refAs: alias(REF_AS),
};

export const REMOVE_FIELDS: FieldsOf<RemoveOp> = {
  ids: list('Ids to remove (cascading: flows, boundary events, children, associations).', { required: true, minItems: 1 }),
  bridge: bool('Reconnect predecessor and successor when a node with one incoming and one outgoing flow is removed, every predecessor of a merge (several incoming, one outgoing; a parallel / inclusive join is refused: E_AMBIGUOUS_BRIDGE) (default true).'),
  bridgeAll: bool('A join (several incoming flows, one outgoing): connect every predecessor to the successor. A split (several outgoing flows) is refused (E_AMBIGUOUS_BRIDGE).'),
  withBranch: bool('Also remove the exclusive downstream path of each node or boundary event: every node only it leads to, up to the next merge with another path or the ends (a node several paths reach is refused: E_AMBIGUOUS_BRANCH). Nothing is bridged.'),
  ifExists: bool('Skip unknown ids with a note instead of failing.'),
};

export const RETYPE_FIELDS: FieldsOf<RetypeOp> = {
  id: ref('Element id.', { required: true }),
  kind: KIND_FIELD,
  ...TRIGGER_FIELDS,
  refAs: alias(REF_AS),
};

export const MOVE_FIELDS: FieldsOf<MoveOp> = {
  ids: list('Node ids to move (boundary events follow their host).', { required: true, minItems: 1 }),
  ...PLACEMENT_FIELDS,
  ...FLOW_FIELDS,
  lane: str('Assign the nodes to this lane; an empty string removes lane membership. Without it a node keeps its lane; one without a lane at its new place inherits like add (into a flow between two lanes: the target\'s after a branching source, else the anchor\'s, with W_LANE_INHERITED).'),
};

export const ORDER_FIELDS: FieldsOf<OrderOp> = {
  id: ref('Node whose outgoing flows are ordered, the process / participant / parent lane whose lanes are ordered, or the collaboration whose pools are ordered.', { required: true }),
  flows: list('Outgoing flow ids in the wanted top-to-bottom order; unlisted flows follow in their old order.', { minItems: 1 }),
  lanes: list('Lane ids (direct child lanes of `id`) in the wanted top-to-bottom order; unlisted lanes follow in their old order. The diagram bands are reordered too.', { minItems: 1 }),
  pools: list('Participant ids (pools of the collaboration `id`, black boxes included) in the wanted top-to-bottom order; unlisted pools follow in their old order. The pool bands are reordered with their content, message flows are routed again.', { minItems: 1 }),
};

export const EXT_FIELDS: FieldsOf<ExtOp> = {
  id: ref('Element id.', { required: true }),
  action: str('What to do with the extension elements.', { required: true, values: ['add', 'remove'] }),
  type: str('Prefixed element type or path (add: what to create, e.g. "zeebe:taskDefinition", "camunda:inputParameter" (filed into its container) or "camunda:connector/camunda:inputParameter"; remove: a selector such as "camunda:inputParameter[name=x]", every element of a bare type, or an index from `ext list` such as "2" or "loop.0"). A "definition." / "loop." / "condition." prefix addresses the nested element; one of several event definitions of an event: "definition[<n>]." (0-based) or "definition[<trigger>].".'),
  attrs: map('add: attributes of the new element.'),
  body: str('add: text content of the new element.'),
  xml: str('add: raw XML snippet (may contain nested elements), parsed and appended instead of type/attrs/body.'),
  replace: bool('add: replace existing elements of the same type first.'),
  index: { type: 'integer', description: 'remove: index within extensionElements (alternative to type; see `ext list`).' },
  slot: str('A nested element of id instead of the element itself: the event definition, the loop characteristics or the condition expression (same as a "definition." / "loop." / "condition." prefix of type, e.g. "loop.camunda:failedJobRetryTimeCycle").', { values: ['definition', 'loop', 'condition'] }),
};

export const SPLIT_FIELDS: FieldsOf<SplitOp> = {
  after: ref("Anchor id: the split gateway is placed after it (spliced into its single outgoing flow, or appended).", { required: true }),
  kind: ref('Gateway kind (default exclusiveGateway).'),
  name: str('Name of the split gateway (exclusive gateways: a question, e.g. "Invoice ok?").'),
  id: ref('Explicit id of the split gateway.'),
  as: alias('Batch alias of the split gateway.'),
  join: bool('Create a joining gateway of the same kind and connect every branch end to it (default true). A branch ending in an end event terminates there; with only one branch that continues no join is created (it runs on to the old successor).'),
  joinId: ref("Explicit id of the join gateway (default <gatewayId>_join in the file's case; <gatewayId>Join under a declared camelCase / PascalCase)."),
  joinAs: alias('Batch alias of the join gateway.'),
  joinName: str('Name of the join gateway.'),
  branches: { type: 'branches', required: true, minItems: 1, description: 'Branches in top-to-bottom order.' },
};

export const BRANCH_FIELDS: FieldsOf<SplitBranch> = {
  nodes: { type: 'nodes', required: true, description: 'Nodes of the branch in order (each like an `add` op without placement); empty = a direct gateway -> join flow.' },
  ...FLOW_FIELDS,
};

/* format ops (diagram only) */

export const SIDE_VALUES = ['right', 'top', 'bottom', 'left'] as const;
export const BOUNDARY_SIDE_VALUES = ['top', 'bottom'] as const;
export const LABEL_SIDE_VALUES = ['above', 'below', 'left', 'right'] as const;
export const COLOR_VALUES = ['blue', 'orange', 'green', 'red', 'purple', 'default'] as const;

export const SELECTOR_FIELDS: FieldsOf<Selectors> = {
  path: list('[fromId, toId]: add every node (and, for color, every flow) on the shortest sequence-flow path between them (default flows first on ties).', { minItems: 2 }),
  via: list('With "path": sequence flows the path must pass, in order (to pick a branch).', { minItems: 1 }),
  kind: ref('Add every element of this kind (the `find --kind` grammar: endEvent, userTask, startEvent:message, sequenceFlow, ...).'),
  branch: ref('Add the branch this sequence flow starts: every node only it reaches up to the join (for color also its flows).'),
};

export const PLACE_FIELDS: FieldsOf<PlaceOp> = {
  ids: list('Shapes moved as one rigid group; the first id is the reference that lands on the target row / column. Boundary events, labels and the content of an expanded sub-process follow.', { minItems: 1 }),
  ...SELECTOR_FIELDS,
  rowOf: ref('Row: centre the reference vertically on this element.'),
  below: ref('Row: put the reference one row below this element.'),
  above: ref('Row: put the reference one row above this element.'),
  columnOf: ref('Column: centre the reference horizontally on this element.'),
  after: ref('Column: put the reference one gap right of this element.'),
  before: ref('Column: put the reference one gap left of this element.'),
  side: str('A boundary event (the only id, no row or column): the border of its host it moves to; its outgoing flow is routed again, and its exception path follows when it was drawn on the old side.', { values: BOUNDARY_SIDE_VALUES }),
};

export const ALIGN_FIELDS: FieldsOf<AlignOp> = {
  ids: list('Shapes to align (each moves on its own).', { minItems: 1 }),
  ...SELECTOR_FIELDS,
  axis: str('row: same vertical centre (one horizontal line); column: same horizontal centre (one vertical line).', { required: true, values: ['row', 'column'] }),
  to: ref('Reference element that stays (default: the first id).'),
};

export const COLOR_FIELDS: FieldsOf<ColorOp> = {
  ids: list('Shapes and connections to colour.', { minItems: 1 }),
  ...SELECTOR_FIELDS,
  color: str('A colour of the bpmn-js colour picker; "default" removes the colour.', { required: true, values: COLOR_VALUES }),
};

export const LABEL_FIELDS: FieldsOf<LabelOp> = {
  id: ref('Event, gateway, data object / store or flow with a name (external label).', { required: true }),
  side: str('Side of the element (flows: of the longest horizontal / vertical segment) the label goes to.', { required: true, values: LABEL_SIDE_VALUES }),
};

export const ROUTE_FIELDS: FieldsOf<RouteOp> = {
  id: ref('Sequence flow or message flow to route again.', { required: true }),
  exit: str('Side the flow leaves its source by (default: the conventions).', { values: SIDE_VALUES }),
  entry: str('Side the flow enters its target by (default: the conventions).', { values: SIDE_VALUES }),
};

export const SPACE_FIELDS: FieldsOf<SpaceOp> = {
  after: ref('Insert horizontal space right of this element (everything starting right of it moves right, frames grow).'),
  below: ref('Insert vertical space below this element (everything starting below it moves down, frames grow).'),
  by: { type: 'size', description: 'How much: "column" (one node width plus gap, default for `after`), "row" (one row, default for `below`), a number of them ("2col", "2columns", "3rows") or pixels (an integer >= 1, "80px"). Negative ("-column", "-2col", "-row", an integer <= -1) closes up to that much empty space instead (only as far as it is empty). The result notes the distance moved.' },
};

export const TIDY_FIELDS: FieldsOf<TidyOp> = {
  ids: list('Only these shapes (default: every shape of every diagram).', { minItems: 1 }),
  ...SELECTOR_FIELDS,
};

export const COMPACT_FIELDS: FieldsOf<CompactOp> = {
  ids: list('Only these frames (pools by participant id, lanes, expanded sub-processes) and what is inside them (default: the whole drawing).', { minItems: 1 }),
};

export const OP_FIELDS: Record<Op['op'], Record<string, FieldSpec>> = {
  add: ADD_FIELDS,
  connect: CONNECT_FIELDS,
  set: SET_FIELDS,
  remove: REMOVE_FIELDS,
  retype: RETYPE_FIELDS,
  move: MOVE_FIELDS,
  order: ORDER_FIELDS,
  ext: EXT_FIELDS,
  split: SPLIT_FIELDS,
  place: PLACE_FIELDS,
  align: ALIGN_FIELDS,
  color: COLOR_FIELDS,
  label: LABEL_FIELDS,
  route: ROUTE_FIELDS,
  space: SPACE_FIELDS,
  tidy: TIDY_FIELDS,
  compact: COMPACT_FIELDS,
};

export const OP_DESCRIPTIONS: Record<Op['op'], string> = {
  add: 'Create one element and wire it in (= `bpmn add`).',
  connect: 'Connect two elements; the connection kind (sequence flow, message flow, association, data association) is inferred (= `bpmn connect`).',
  set: 'Set or remove properties of an element (= `bpmn set`).',
  remove: 'Remove elements with cascade (= `bpmn remove`).',
  retype: 'Change the kind of an element, keeping id, name, flows and extensions (= `bpmn retype`).',
  move: 'Relocate nodes to another place or lane (= `bpmn move`).',
  order: 'Set the top-to-bottom order of the outgoing flows of a node, of the lanes of a pool / process / parent lane, or of the pools of a collaboration (= `bpmn order`).',
  ext: 'Add or remove vendor extension elements (= `bpmn ext`).',
  split: 'Macro: split gateway + branches + join gateway in one step (apply only; there is no split command).',
  place: 'Diagram only: move shapes (rigid group) to the row and/or column of another element (= `bpmn place`).',
  align: 'Diagram only: put shapes on one row or one column (= `bpmn align`).',
  color: 'Diagram only: colour shapes and connections with a bpmn-js colour picker colour (= `bpmn color`).',
  label: 'Diagram only: put the external label of an event, gateway, data element or flow on one side (= `bpmn label`).',
  route: 'Diagram only: route one flow again, optionally forcing the exit / entry side (= `bpmn route`).',
  space: 'Diagram only: insert space right of / below an element like the modeler\'s space tool (= `bpmn space`).',
  tidy: 'Diagram only: remove overlaps and gaps < 20 px with minimal moves, keeping the order (= `bpmn tidy`, `bpmn layout --tidy`).',
  compact: 'Diagram only: close empty rows and columns and shrink pools, lanes and expanded sub-processes to their content, keeping the order and relative positions; never adds a layout problem (= `bpmn compact`).',
};

export const PLACEMENT_KEYS = Object.keys(PLACEMENT_FIELDS) as Array<keyof Placement>;
/** place: at most one row key and one column key */
export const PLACE_GROUPS = [
  ['rowOf', 'below', 'above'],
  ['columnOf', 'after', 'before'],
];
export const FLOW_KEYS = Object.keys(FLOW_FIELDS) as Array<keyof FlowOptions>;
export const TRIGGER_KEYS = Object.keys(TRIGGER_FIELDS) as Array<keyof TriggerOptions>;

/** `after` + `before` is the only placement pair that combines. */
export const PLACEMENT_CONFLICTS: Array<[string, string]> = [];
for (let i = 0; i < PLACEMENT_KEYS.length; i++) {
  for (let j = i + 1; j < PLACEMENT_KEYS.length; j++) {
    const a = PLACEMENT_KEYS[i]!;
    const b = PLACEMENT_KEYS[j]!;
    if (!(a === 'after' && b === 'before')) PLACEMENT_CONFLICTS.push([a, b]);
  }
}

/**
 * Assumes `bpmn new order.bpmn --name "Order handling" --target camunda8` with a
 * start -> "Check invoice" user task -> end; the result is a valid Camunda 8 file.
 */
export function opsExample(): { ops: Op[] } {
  return {
    ops: [
      {
        op: 'split',
        after: 'Activity_CheckInvoice',
        kind: 'exclusiveGateway',
        name: 'Invoice ok?',
        as: '$ok',
        branches: [
          { flowName: 'yes', condition: '= ok', nodes: [{ kind: 'serviceTask', name: 'Book invoice', as: '$book' }] },
          { flowName: 'no', default: true, nodes: [{ kind: 'userTask', name: 'Clarify invoice', as: '$clarify', set: { doc: 'Call the customer and clarify the open positions.' } }] },
        ],
      },
      { op: 'add', kind: 'boundaryEvent:timer', name: 'Reminder', on: '$clarify', timer: 'P2D', nonInterrupting: true, as: '$reminder' },
      { op: 'add', kind: 'sendTask', name: 'Remind customer', after: '$reminder', as: '$remind' },
      { op: 'add', kind: 'endEvent', name: 'Reminder sent', in: 'Process_OrderHandling', as: '$sent' },
      { op: 'connect', source: '$remind', target: '$sent' },
      { op: 'set', id: '$book', values: { name: 'Book invoice in ERP', doc: 'Posts the invoice to the ledger.' } },
      { op: 'ext', id: '$book', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'book-invoice', retries: '3' } },
      { op: 'ext', id: '$remind', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'remind-customer' } },
    ],
  };
}
