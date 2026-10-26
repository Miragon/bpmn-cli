/**
 * The field specs the edit commands share (placement, flow and trigger options, the nodes and
 * branches of a split, the selectors); each command's own table is in its definition
 * (`../definitions/`). `FieldsOf` makes a missing or extra key a compile error.
 */
import { alias, bool, list, map, ref, str, type FieldsOf, type SplitNode } from './field-specs.js';
import type { EditCommand, FlowOptions, Placement, Selectors, SplitBranch, TriggerOptions } from '../types.js';

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

export const REF_AS = 'Batch alias of the bpmn:Message / Error / Signal / Escalation the element references after the op (the one `message` / `error` / `signal` / `escalation` created or found; E_USAGE when it references none), e.g. "$msg"; then `{"op": "ext", "id": "$msg", "action": "add", "type": "zeebe:subscription", ...}`.';
export const KIND_FIELD = ref('Element kind with optional trigger suffix, e.g. "userTask", "startEvent:message", "boundaryEvent:timer" (see `bpmn kinds`).', { required: true });

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

export const PLACEMENT_KEYS = Object.keys(PLACEMENT_FIELDS) as Array<keyof Placement>;
export const FLOW_KEYS = Object.keys(FLOW_FIELDS) as Array<keyof FlowOptions>;
export const TRIGGER_KEYS = Object.keys(TRIGGER_FIELDS) as Array<keyof TriggerOptions>;

/** `after` + `before` is the only placement pair that combines. */
export const PLACEMENT_CONFLICTS: Array<[string, string]> = [];
for (let firstIndex = 0; firstIndex < PLACEMENT_KEYS.length; firstIndex++) {
  for (let secondIndex = firstIndex + 1; secondIndex < PLACEMENT_KEYS.length; secondIndex++) {
    const firstKey = PLACEMENT_KEYS[firstIndex]!;
    const secondKey = PLACEMENT_KEYS[secondIndex]!;
    if (!(firstKey === 'after' && secondKey === 'before')) PLACEMENT_CONFLICTS.push([firstKey, secondKey]);
  }
}

/**
 * Assumes `bpmn new order.bpmn --name "Order handling" --target camunda8` with a
 * start -> "Check invoice" user task -> end; the result is a valid Camunda 8 file.
 */
export function opsExample(): { ops: EditCommand[] } {
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
