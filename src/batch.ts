/**
 * The JSON ops format for `bpmn apply` ("CLI flags spelled as JSON"): a
 * hand-written validator (no schema library), the matching JSON Schema and a
 * complete example.
 *
 * One table of field specs per op is the single source of truth: the
 * validator walks it, OPS_SCHEMA is generated from it, and its TypeScript
 * type ties it to the Op interfaces in ops/types.ts (a missing or extra key
 * is a compile error, see `FieldsOf`).
 *
 * Accepted input: `[op, op, ...]` or `{ "ops": [op, ...] }`. Every problem is
 * reported as a usage error whose message starts with `ops[<index>] (<op>)`
 * and whose details carry `op: <index>`.
 */
import { usageError, type CliError } from './errors.js';
import { KindError, kindByName, normalizeTrigger, parseKind } from './kinds.js';
import {
  OP_NAMES,
  type AddOp,
  type AlignOp,
  type ColorOp,
  type ConnectOp,
  type ExtOp,
  type LabelOp,
  type PlaceOp,
  type RouteOp,
  type SpaceOp,
  type TidyOp,
  type CompactOp,
  type FlowOptions,
  type MoveOp,
  type Op,
  type OrderOp,
  type Placement,
  type RemoveOp,
  type RetypeOp,
  type SetOp,
  type SplitBranch,
  type SplitOp,
  type TriggerOptions,
} from './ops/types.js';

/* ------------------------------------------------------------------ */
/* field specs                                                          */
/* ------------------------------------------------------------------ */

export type FieldType = 'string' | 'boolean' | 'integer' | 'string[]' | 'map' | 'branches' | 'nodes' | 'size';

export interface FieldSpec {
  type: FieldType;
  description: string;
  required?: boolean;
  /** allowed values (strings) */
  values?: readonly string[];
  /** ids, references and kinds: must not be empty */
  ref?: boolean;
  /** lists: minimum number of entries */
  minItems?: number;
}

/** Exactly the keys of an op interface (minus `op`), each with a spec. */
type FieldsOf<T> = { [K in Exclude<keyof T, 'op'>]-?: FieldSpec };

/** A node inside a split branch: an AddOp without placement. */
export type SplitNode = SplitBranch['nodes'][number];

const str = (description: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ type: 'string', description, ...extra });
const ref = (description: string, extra: Partial<FieldSpec> = {}): FieldSpec => str(description, { ref: true, ...extra });
const bool = (description: string): FieldSpec => ({ type: 'boolean', description });
const list = (description: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ type: 'string[]', description, ...extra });
const map = (description: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ type: 'map', description, ...extra });

export const PLACEMENT_FIELDS: FieldsOf<Placement> = {
  after: ref("Anchor id: append after a gateway or an unconnected node, or splice into the anchor's single outgoing flow. Together with `before`: splice into the flow after -> before."),
  before: ref("Anchor id: prepend before a join gateway or an unconnected node, or splice into the anchor's single incoming flow."),
  flow: ref('Sequence flow id to splice the node into (A -> B becomes A -> node -> B).'),
  in: ref('Container id (process, sub-process or participant): put the node there without connecting it.'),
  on: ref('Boundary events only: id of the host activity.'),
};

export const FLOW_FIELDS: FieldsOf<FlowOptions> = {
  flowName: str('Label of the flow into the new node.'),
  flowId: ref('Explicit id of the flow into the new node (only used when a new flow is created).'),
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

const KIND_FIELD = ref('Element kind with optional trigger suffix, e.g. "userTask", "startEvent:message", "boundaryEvent:timer" (see `bpmn kinds`).', { required: true });

export const NODE_FIELDS: FieldsOf<SplitNode> = {
  kind: KIND_FIELD,
  name: str('Display name. Also drives the generated id (<Prefix>_<NameSlug> in the default style; new ids follow the id style of the file).'),
  id: ref('Explicit id (default: generated in the id style of the file, else <Prefix>_<NameSlug>, or <Prefix>_<hash> for unnamed elements). Give an id to every element a later op of the batch refers to.'),
  lane: ref('Lane id the node is assigned to (default: the lane of the anchor / host).'),
  ...FLOW_FIELDS,
  ...TRIGGER_FIELDS,
  collapsed: bool('Sub-processes: draw collapsed instead of expanded.'),
  doc: str('Documentation text of the element.'),
  set: map('Extra properties, same keys as the `set` op (e.g. {"camunda:assignee": "kermit"}).'),
  process: ref('Participants: bind this existing (unbound) process instead of creating a new one.'),
  blackBox: bool('Participants: create no process (black-box pool).'),
  text: str('Text annotations: the annotation text.'),
  members: list('Lanes: initial member node ids.'),
};

export const ADD_FIELDS: FieldsOf<AddOp> = {
  kind: NODE_FIELDS.kind,
  name: NODE_FIELDS.name,
  id: NODE_FIELDS.id,
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
};

export const REMOVE_FIELDS: FieldsOf<RemoveOp> = {
  ids: list('Ids to remove (cascading: flows, boundary events, children, associations).', { required: true, minItems: 1 }),
  bridge: bool('Reconnect predecessor and successor when a node with one incoming and one outgoing flow is removed (default true).'),
  ifExists: bool('Skip unknown ids with a note instead of failing.'),
};

export const RETYPE_FIELDS: FieldsOf<RetypeOp> = {
  id: ref('Element id.', { required: true }),
  kind: KIND_FIELD,
  ...TRIGGER_FIELDS,
};

export const MOVE_FIELDS: FieldsOf<MoveOp> = {
  ids: list('Node ids to move (boundary events follow their host).', { required: true, minItems: 1 }),
  ...PLACEMENT_FIELDS,
  ...FLOW_FIELDS,
  lane: str('Assign the nodes to this lane; an empty string removes lane membership.'),
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
  join: bool('Create a joining gateway of the same kind and connect every branch end to it (default true).'),
  joinId: ref('Explicit id of the join gateway (default <gatewayId>_join).'),
  joinName: str('Name of the join gateway.'),
  branches: { type: 'branches', required: true, minItems: 1, description: 'Branches in top-to-bottom order.' },
};

export const BRANCH_FIELDS: FieldsOf<SplitBranch> = {
  nodes: { type: 'nodes', required: true, description: 'Nodes of the branch in order (each like an `add` op without placement); empty = a direct gateway -> join flow.' },
  ...FLOW_FIELDS,
};

/* format ops (diagram only) */

export const SIDE_VALUES = ['right', 'top', 'bottom', 'left'] as const;
export const LABEL_SIDE_VALUES = ['above', 'below', 'left', 'right'] as const;
export const COLOR_VALUES = ['blue', 'orange', 'green', 'red', 'purple', 'default'] as const;

export const PLACE_FIELDS: FieldsOf<PlaceOp> = {
  ids: list('Shapes moved as one rigid group; the first id is the reference that lands on the target row / column. Boundary events, labels and the content of an expanded sub-process follow.', { required: true, minItems: 1 }),
  rowOf: ref('Row: centre the reference vertically on this element.'),
  below: ref('Row: put the reference one row below this element.'),
  above: ref('Row: put the reference one row above this element.'),
  columnOf: ref('Column: centre the reference horizontally on this element.'),
  after: ref('Column: put the reference one gap right of this element.'),
  before: ref('Column: put the reference one gap left of this element.'),
};

export const ALIGN_FIELDS: FieldsOf<AlignOp> = {
  ids: list('Shapes to align (each moves on its own).', { required: true, minItems: 1 }),
  axis: str('row: same vertical centre (one horizontal line); column: same horizontal centre (one vertical line).', { required: true, values: ['row', 'column'] }),
  to: ref('Reference element that stays (default: the first id).'),
};

export const COLOR_FIELDS: FieldsOf<ColorOp> = {
  ids: list('Shapes and connections to colour.', { required: true, minItems: 1 }),
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
  by: { type: 'size', description: 'How much: "column" (one node width plus gap, default for `after`), "row" (one row, default for `below`) or pixels (integer >= 1). Negative ("-column", "-row", an integer <= -1) closes up to that much empty space instead (only as far as it is empty).' },
};

export const TIDY_FIELDS: FieldsOf<TidyOp> = {
  ids: list('Only these shapes (default: every shape of every diagram).', { minItems: 1 }),
};

export const COMPACT_FIELDS: FieldsOf<CompactOp> = {
  ids: list('Only these frames (pools by participant id, lanes, expanded sub-processes) and what is inside them (default: the whole drawing).', { minItems: 1 }),
};

/** Field specs per op name (`op` itself is implicit). */
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

/** One-line purpose of every op, for schema descriptions and the guide. */
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

const PLACEMENT_KEYS = Object.keys(PLACEMENT_FIELDS) as Array<keyof Placement>;
/** place: at most one row key and one column key */
const PLACE_GROUPS = [
  ['rowOf', 'below', 'above'],
  ['columnOf', 'after', 'before'],
];
const FLOW_KEYS = Object.keys(FLOW_FIELDS) as Array<keyof FlowOptions>;
const TRIGGER_KEYS = Object.keys(TRIGGER_FIELDS) as Array<keyof TriggerOptions>;

/** Placement key pairs that cannot be combined (`after` + `before` is the only allowed pair). */
const PLACEMENT_CONFLICTS: Array<[string, string]> = [];
for (let i = 0; i < PLACEMENT_KEYS.length; i++) {
  for (let j = i + 1; j < PLACEMENT_KEYS.length; j++) {
    const a = PLACEMENT_KEYS[i]!;
    const b = PLACEMENT_KEYS[j]!;
    if (!(a === 'after' && b === 'before')) PLACEMENT_CONFLICTS.push([a, b]);
  }
}

/* ------------------------------------------------------------------ */
/* validation                                                           */
/* ------------------------------------------------------------------ */

interface Ctx {
  /** op index in the batch */
  index: number;
  /** where we are, e.g. `ops[2] (split) branches[0].nodes[1]` */
  path: string;
}

function fail(ctx: Ctx, message: string, hint?: string, candidates?: string[]): CliError {
  return usageError(`${ctx.path}: ${message}`, {
    op: ctx.index,
    ...(hint ? { hint } : {}),
    ...(candidates?.length ? { candidates } : {}),
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'object') return 'an object';
  return `${typeof v} ${JSON.stringify(v)}`;
}

/** Edit distance with adjacent transpositions (optimal string alignment; small strings only). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** kebab-case / snake_case / wrong-case spellings and small typos of an allowed key. */
export function closestKey(key: string, allowed: readonly string[]): string | undefined {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(key);
  const exact = allowed.find((k) => norm(k) === n) ?? allowed.find((k) => norm(k).startsWith(n) || n.startsWith(norm(k)));
  if (exact || !n) return exact;
  let best: string | undefined;
  let bestD = Infinity;
  for (const k of allowed) {
    const d = editDistance(n, norm(k));
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return bestD <= (n.length >= 5 ? 2 : 1) ? best : undefined;
}

function checkString(ctx: Ctx, key: string, spec: FieldSpec, value: unknown): string {
  if (typeof value !== 'string') {
    throw fail(ctx, `"${key}" must be a string, got ${describe(value)}`, `Write it as a JSON string, e.g. "${key}": "...".`);
  }
  if (spec.ref && !value.trim()) throw fail(ctx, `"${key}" must not be empty`);
  if (spec.values && !spec.values.includes(value)) {
    throw fail(ctx, `"${key}" must be one of ${spec.values.map((v) => `"${v}"`).join(', ')}, got "${value}"`);
  }
  return value;
}

function checkBoolean(ctx: Ctx, key: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    const hint = value === 'true' || value === 'false' ? `Use the JSON literal ${value}, not the string "${value}".` : `Write "${key}": true or false.`;
    throw fail(ctx, `"${key}" must be a boolean, got ${describe(value)}`, hint);
  }
  return value;
}

function checkInteger(ctx: Ctx, key: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw fail(ctx, `"${key}" must be a non-negative integer, got ${describe(value)}`);
  }
  return value;
}

function checkStringList(ctx: Ctx, key: string, spec: FieldSpec, value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw fail(ctx, `"${key}" must be an array of strings, got ${describe(value)}`, `Write "${key}": ["Id_1", "Id_2"].`);
  }
  const out: string[] = [];
  value.forEach((item, i) => {
    if (typeof item !== 'string' || !item.trim()) throw fail(ctx, `"${key}[${i}]" must be a non-empty string, got ${describe(item)}`);
    out.push(item);
  });
  if (spec.minItems && out.length < spec.minItems) {
    throw fail(ctx, `"${key}" needs at least ${spec.minItems} ${spec.minItems === 1 ? 'entry' : 'entries'}`);
  }
  return out;
}

/** "column" | "row" | "-column" | "-row" | a non-zero integer (a string of digits is converted). */
function checkSize(ctx: Ctx, key: string, value: unknown): SpaceOp['by'] & {} {
  if (value === 'column' || value === 'row' || value === '-column' || value === '-row') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value) && Number(value) !== 0) return Number(value);
  if (typeof value === 'number' && Number.isInteger(value) && value !== 0) return value;
  throw fail(ctx, `"${key}" must be "column", "row" or a positive integer (pixels), or "-column", "-row" or a negative integer to close space, got ${describe(value)}`);
}

function checkMap(ctx: Ctx, key: string, value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    throw fail(ctx, `"${key}" must be an object of key/value pairs, got ${describe(value)}`, `Write "${key}": {"name": "..."}.`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!k.trim()) throw fail(ctx, `"${key}" contains an empty key`);
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
    else {
      throw fail(ctx, `"${key}.${k}" must be a string (numbers and booleans are converted), got ${describe(v)}`, v === null ? `Use "" to remove a property (or "unset": ["${k}"] in a set op).` : undefined);
    }
  }
  return out;
}

/** Validates `value` against `fields`; returns a clean copy with only known keys. */
function checkFields(ctx: Ctx, value: unknown, fields: Record<string, FieldSpec>): Record<string, unknown> {
  if (!isPlainObject(value)) throw fail(ctx, `expected an object, got ${describe(value)}`);
  const allowed = Object.keys(fields);
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'op') continue;
    const spec = fields[key];
    if (!spec) {
      const alt = closestKey(key, allowed);
      throw fail(
        ctx,
        `unknown key "${key}"${alt ? ` (did you mean "${alt}"?)` : ''}; allowed keys: ${allowed.join(', ')}`,
        'Keys are the CLI flags in lowerCamelCase (--flow-name -> flowName). See `bpmn kinds --json` for the schema.',
        alt ? [alt] : [],
      );
    }
    if (raw === undefined || raw === null) continue;
    switch (spec.type) {
      case 'string':
        out[key] = checkString(ctx, key, spec, raw);
        break;
      case 'boolean':
        out[key] = checkBoolean(ctx, key, raw);
        break;
      case 'integer':
        out[key] = checkInteger(ctx, key, raw);
        break;
      case 'string[]':
        out[key] = checkStringList(ctx, key, spec, raw);
        break;
      case 'map':
        out[key] = checkMap(ctx, key, raw);
        break;
      case 'branches':
        out[key] = checkBranches(ctx, key, spec, raw);
        break;
      case 'nodes':
        out[key] = checkNodes(ctx, key, raw);
        break;
      case 'size':
        out[key] = checkSize(ctx, key, raw);
        break;
    }
  }
  for (const [key, spec] of Object.entries(fields)) {
    if (spec.required && out[key] === undefined) {
      throw fail(ctx, `missing required key "${key}" (${spec.description})`);
    }
  }
  return out;
}

function presentKeys(obj: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((k) => obj[k] !== undefined);
}

/** Placement keys must form one of: after | before | after+before | flow | in | on. */
function checkPlacement(ctx: Ctx, obj: Record<string, unknown>): void {
  for (const [a, b] of PLACEMENT_CONFLICTS) {
    if (obj[a] !== undefined && obj[b] !== undefined) {
      throw fail(ctx, `"${a}" and "${b}" cannot be combined`, 'Use exactly one placement: after, before, after + before (splice into that flow), flow, in, or on (boundary events).');
    }
  }
}

/** Flow options describe the flow INTO the node; they need a placement that creates one. */
function checkFlowOptions(ctx: Ctx, obj: Record<string, unknown>, needsPlacement: boolean): void {
  if (obj['default'] === true && obj['condition'] !== undefined) {
    throw fail(ctx, '"default" and "condition" are mutually exclusive: a default flow has no condition', 'Keep the condition on the other branches and mark this one as default.');
  }
  if (!needsPlacement) return;
  const used = presentKeys(obj, FLOW_KEYS);
  const createsFlow = obj['after'] !== undefined || obj['before'] !== undefined || obj['flow'] !== undefined;
  if (used.length && !createsFlow) {
    throw fail(ctx, `${used.map((k) => `"${k}"`).join(', ')} describe the flow into the node and need "after", "before" or "flow"`, 'With "in" or "on" no sequence flow is created; connect the node afterwards with a connect op.');
  }
}

/** Parses the kind; trigger options are only meaningful on events. */
function checkKind(ctx: Ctx, obj: Record<string, unknown>, expectFamily?: string): void {
  const kind = obj['kind'];
  if (typeof kind !== 'string') return;
  let family: string;
  // `eventSubProcess:<trigger>` creates the event sub-process together with its start event (see ops/add.ts)
  const eventSub = /^(eventSubProcess|eventSub|bpmn:eventSubProcess):(.+)$/i.exec(kind);
  if (eventSub) {
    const trigger = normalizeTrigger(eventSub[2]!);
    const allowed: string[] = (kindByName('startEvent')?.triggers ?? []).filter((t) => t !== 'none');
    if (!trigger || !allowed.includes(trigger)) {
      throw fail(ctx, `Trigger "${eventSub[2]}" is not allowed on eventSubProcess. Allowed: ${allowed.join(', ')}`, 'eventSubProcess:<trigger> creates the event sub-process with a startEvent:<trigger> inside, e.g. eventSubProcess:error with "error": "PaymentFailed".', allowed);
    }
    return; // trigger options are meaningful here (they configure the start event)
  }
  try {
    family = parseKind(kind).def.family;
  } catch (err) {
    if (err instanceof KindError) throw fail(ctx, err.message, 'Run `bpmn kinds` for the list of kinds and triggers.', err.candidates);
    throw err;
  }
  if (expectFamily && family !== expectFamily) {
    throw fail(ctx, `"kind" must be a ${expectFamily} kind, "${kind}" is a ${family}`, expectFamily === 'gateway' ? 'Use exclusiveGateway, parallelGateway, inclusiveGateway or eventBasedGateway.' : undefined);
  }
  // send and receive tasks reference a message too (`add sendTask --message X`, ops/add.ts)
  const messageTask = ['sendTask', 'receiveTask'].includes(parseKind(kind).def.kind);
  const triggers = presentKeys(obj, TRIGGER_KEYS).filter((k) => !(messageTask && k === 'message'));
  if (triggers.length && family !== 'event') {
    throw fail(ctx, `${triggers.map((k) => `"${k}"`).join(', ')} only apply to events, but "${kind}" is a ${family}`, 'Use an event kind such as startEvent:timer or boundaryEvent:message, or drop the trigger options.');
  }
}

function checkNodes(ctx: Ctx, key: string, value: unknown): SplitNode[] {
  if (!Array.isArray(value)) throw fail(ctx, `"${key}" must be an array of node objects, got ${describe(value)}`, 'An empty array is allowed: the branch is then a direct gateway -> join flow.');
  return value.map((node, i) => {
    const nctx: Ctx = { index: ctx.index, path: `${ctx.path}.${key}[${i}]` };
    const out = checkFields(nctx, node, NODE_FIELDS);
    checkKind(nctx, out);
    checkFlowOptions(nctx, out, false);
    return out as unknown as SplitNode;
  });
}

function checkBranches(ctx: Ctx, key: string, spec: FieldSpec, value: unknown): SplitBranch[] {
  if (!Array.isArray(value)) throw fail(ctx, `"${key}" must be an array of branch objects, got ${describe(value)}`, 'Write "branches": [{"flowName": "yes", "nodes": [{"kind": "userTask", "name": "..."}]}].');
  if (spec.minItems && value.length < spec.minItems) throw fail(ctx, `"${key}" needs at least ${spec.minItems} branch`);
  return value.map((branch, i) => {
    const bctx: Ctx = { index: ctx.index, path: `${ctx.path} ${key}[${i}]` };
    const out = checkFields(bctx, branch, BRANCH_FIELDS);
    checkFlowOptions(bctx, out, false);
    return out as unknown as SplitBranch;
  });
}

function checkExt(ctx: Ctx, obj: Record<string, unknown>): void {
  const addOnly = ['attrs', 'body', 'xml', 'replace'];
  if (obj['action'] === 'add') {
    if (obj['type'] === undefined && obj['xml'] === undefined) throw fail(ctx, 'ext add needs "type" (plus optional "attrs"/"body") or "xml"', 'Example: {"op":"ext","id":"Activity_X","action":"add","type":"zeebe:taskDefinition","attrs":{"type":"my-worker"}}.');
    if (obj['index'] !== undefined) throw fail(ctx, '"index" only applies to action "remove"');
    if (obj['xml'] !== undefined && (obj['attrs'] !== undefined || obj['body'] !== undefined)) throw fail(ctx, '"xml" cannot be combined with "attrs" or "body"', 'Put everything into the XML snippet, or use type + attrs + body.');
  } else {
    const bad = presentKeys(obj, addOnly);
    if (bad.length) throw fail(ctx, `${bad.map((k) => `"${k}"`).join(', ')} only apply to action "add"`);
    const hasType = obj['type'] !== undefined;
    const hasIndex = obj['index'] !== undefined;
    if (hasType === hasIndex) throw fail(ctx, 'ext remove needs exactly one of "type" or "index"', 'Run `bpmn ext list <file> <id>` to see types and indexes.');
  }
}

/** At most one key of each group; with `atLeastOne`, one key of all groups together. */
function checkGroups(ctx: Ctx, obj: Record<string, unknown>, groups: string[][], atLeastOne: string): void {
  for (const g of groups) {
    const used = presentKeys(obj, g);
    if (used.length > 1) throw fail(ctx, `${used.map((k) => `"${k}"`).join(' and ')} cannot be combined`, `Give at most one of ${g.map((k) => `"${k}"`).join(', ')}.`);
  }
  if (!presentKeys(obj, groups.flat()).length) throw fail(ctx, atLeastOne);
}

function checkOp(ctx: Ctx, name: Op['op'], raw: Record<string, unknown>): Op {
  const out = checkFields(ctx, raw, OP_FIELDS[name]);
  switch (name) {
    case 'add':
      checkKind(ctx, out);
      checkPlacement(ctx, out);
      checkFlowOptions(ctx, out, true);
      if (out['ifAbsent'] === true && out['id'] === undefined) throw fail(ctx, '"ifAbsent" needs an explicit "id" to check for', 'Add "id": "<Prefix>_<Name>" or drop ifAbsent.');
      break;
    case 'connect':
      checkFlowOptions(ctx, out, false);
      break;
    case 'set': {
      const values = (out['values'] as Record<string, string> | undefined) ?? {};
      const unset = (out['unset'] as string[] | undefined) ?? [];
      if (!Object.keys(values).length && !unset.length) throw fail(ctx, 'nothing to do: "values" is empty and "unset" is missing', 'Example: {"op":"set","id":"Activity_X","values":{"name":"New name"}}.');
      out['values'] = values;
      break;
    }
    case 'retype':
      checkKind(ctx, out);
      break;
    case 'move':
      checkPlacement(ctx, out);
      checkFlowOptions(ctx, out, true);
      if (!presentKeys(out, PLACEMENT_KEYS).length && out['lane'] === undefined) throw fail(ctx, 'nothing to do: give a placement (after/before/flow/in) and/or "lane"');
      break;
    case 'ext':
      checkExt(ctx, out);
      break;
    case 'split':
      checkKind(ctx, out, 'gateway');
      break;
    case 'order': {
      const given = ['flows', 'lanes', 'pools'].filter((k) => out[k] !== undefined);
      if (given.length !== 1) {
        throw fail(ctx, `give exactly one of "flows" (outgoing flows of a node), "lanes" (lanes of a pool / process / parent lane) or "pools" (participants of a collaboration)`, 'Example: {"op":"order","id":"Gateway_Ok","flows":["Flow_yes","Flow_no"]}, {"op":"order","id":"Participant_X","lanes":["Lane_B","Lane_A"]} or {"op":"order","id":"Collaboration_1","pools":["Participant_Customer","Participant_X"]}.');
      }
      break;
    }
    case 'place':
      checkGroups(ctx, out, PLACE_GROUPS, 'nothing to do: give a row ("rowOf", "below" or "above") and/or a column ("columnOf", "after" or "before")');
      break;
    case 'align':
      if ((out['ids'] as string[]).length < 2 && out['to'] === undefined) throw fail(ctx, 'align needs two ids, or one id and "to"', 'Example: {"op":"align","ids":["Event_A","Event_B"],"axis":"column"}.');
      break;
    case 'space':
      checkGroups(ctx, out, [['after', 'below']], 'give "after" (horizontal space right of an element) or "below" (vertical space below it)');
      break;
    case 'remove':
    case 'color':
    case 'label':
    case 'route':
    case 'tidy':
    case 'compact':
      break;
  }
  return { op: name, ...out } as unknown as Op;
}

function parseOne(raw: unknown, index: number): Op {
  const base: Ctx = { index, path: `ops[${index}]` };
  if (!isPlainObject(raw)) throw fail(base, `expected an op object, got ${describe(raw)}`, 'Every entry looks like {"op": "add", ...}.');
  const name = raw['op'];
  if (name === undefined) throw fail(base, `missing "op"; one of: ${OP_NAMES.join(', ')}`);
  if (typeof name !== 'string' || !(OP_NAMES as string[]).includes(name)) {
    const alt = typeof name === 'string' ? closestKey(name, OP_NAMES) : undefined;
    throw fail(base, `unknown op ${JSON.stringify(name)}${alt ? ` (did you mean "${alt}"?)` : ''}; one of: ${OP_NAMES.join(', ')}`, undefined, alt ? [alt] : []);
  }
  return checkOp({ index, path: `ops[${index}] (${name})` }, name as Op['op'], raw);
}

/**
 * Validates the ops JSON (an array or `{ ops: [...] }`) and returns typed
 * ops. Throws a usage error (exit 1) naming the op index for every problem.
 */
export function parseOps(input: unknown): Op[] {
  let ops: unknown;
  if (Array.isArray(input)) ops = input;
  else if (isPlainObject(input) && Array.isArray(input['ops'])) {
    const extra = Object.keys(input).filter((k) => k !== 'ops' && k !== '$schema');
    if (extra.length) throw usageError(`Unknown top-level key${extra.length > 1 ? 's' : ''} ${extra.map((k) => `"${k}"`).join(', ')}; expected only "ops"`, { hint: 'The ops file is {"ops": [...]} or a plain array of ops.' });
    ops = input['ops'];
  } else {
    throw usageError(`Expected an array of ops or an object {"ops": [...]}, got ${describe(input)}`, {
      hint: 'Run `bpmn guide` for the format and `bpmn kinds --json` for the JSON schema (key "ops").',
    });
  }
  const list = ops as unknown[];
  if (!list.length) throw usageError('The ops list is empty', { hint: 'Add at least one op, e.g. {"op": "add", "kind": "userTask", "name": "Check invoice", "after": "Event_Start"}.' });
  return list.map(parseOne);
}

/* ------------------------------------------------------------------ */
/* JSON schema                                                          */
/* ------------------------------------------------------------------ */

function fieldSchema(spec: FieldSpec): Record<string, unknown> {
  const d = { description: spec.description };
  switch (spec.type) {
    case 'string':
      return { type: 'string', ...(spec.ref ? { minLength: 1 } : {}), ...(spec.values ? { enum: [...spec.values] } : {}), ...d };
    case 'boolean':
      return { type: 'boolean', ...d };
    case 'integer':
      return { type: 'integer', minimum: 0, ...d };
    case 'string[]':
      return { type: 'array', items: { type: 'string', minLength: 1 }, ...(spec.minItems ? { minItems: spec.minItems } : {}), ...d };
    case 'map':
      return { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] }, ...d };
    case 'branches':
      return { type: 'array', minItems: spec.minItems ?? 1, items: { $ref: '#/$defs/branch' }, ...d };
    case 'nodes':
      return { type: 'array', items: { $ref: '#/$defs/node' }, ...d };
    case 'size':
      return { oneOf: [{ type: 'string', enum: ['column', 'row', '-column', '-row'] }, { type: 'integer', not: { const: 0 } }], ...d };
  }
}

/** JSON-schema rules: at most one key per group, at least one key overall. */
const groupRules = (groups: string[][]): unknown[] => [
  ...groups.flatMap((g) => g.flatMap((a, i) => g.slice(i + 1).map((b) => ({ not: { required: [a, b] } })))),
  { anyOf: groups.flat().map((k) => ({ required: [k] })) },
];

function objectSchema(fields: Record<string, FieldSpec>, opts: { op?: string; description: string; allOf?: unknown[] }): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (opts.op) properties['op'] = { const: opts.op };
  for (const [key, spec] of Object.entries(fields)) properties[key] = fieldSchema(spec);
  const required = [...(opts.op ? ['op'] : []), ...Object.entries(fields).filter(([, s]) => s.required).map(([k]) => k)];
  return {
    type: 'object',
    description: opts.description,
    properties,
    required,
    additionalProperties: false,
    ...(opts.allOf?.length ? { allOf: opts.allOf } : {}),
  };
}

const placementRules = (): unknown[] => PLACEMENT_CONFLICTS.map(([a, b]) => ({ not: { required: [a, b] } }));
const defaultRule = (): unknown => ({ not: { required: ['default', 'condition'], properties: { default: { const: true } } } });

function buildSchema(): Record<string, unknown> {
  const opRefs = OP_NAMES.map((n) => ({ $ref: `#/$defs/${n}` }));
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://bpmn-cli/schemas/ops.json',
    title: 'bpmn apply operations',
    description: 'A batch of edits for `bpmn apply <file> <ops.json>`: either an array of ops or {"ops": [...]}. Semantic ops run first, then the layout, then the diagram-only format ops (place, align, color, label, route, space, tidy) in batch order. Keys are the CLI flags of the same command in lowerCamelCase.',
    oneOf: [
      { type: 'array', minItems: 1, items: { $ref: '#/$defs/op' } },
      { type: 'object', properties: { $schema: { type: 'string' }, ops: { type: 'array', minItems: 1, items: { $ref: '#/$defs/op' } } }, required: ['ops'], additionalProperties: false },
    ],
    $defs: {
      op: { oneOf: opRefs },
      add: objectSchema(ADD_FIELDS, { op: 'add', description: OP_DESCRIPTIONS.add, allOf: [...placementRules(), defaultRule(), { if: { required: ['ifAbsent'], properties: { ifAbsent: { const: true } } }, then: { required: ['id'] } }] }),
      connect: objectSchema(CONNECT_FIELDS, { op: 'connect', description: OP_DESCRIPTIONS.connect, allOf: [defaultRule()] }),
      set: objectSchema(SET_FIELDS, { op: 'set', description: OP_DESCRIPTIONS.set, allOf: [{ anyOf: [{ required: ['values'] }, { required: ['unset'] }] }] }),
      remove: objectSchema(REMOVE_FIELDS, { op: 'remove', description: OP_DESCRIPTIONS.remove }),
      retype: objectSchema(RETYPE_FIELDS, { op: 'retype', description: OP_DESCRIPTIONS.retype }),
      move: objectSchema(MOVE_FIELDS, { op: 'move', description: OP_DESCRIPTIONS.move, allOf: [...placementRules(), defaultRule(), { anyOf: [...PLACEMENT_KEYS.map((k) => ({ required: [k] })), { required: ['lane'] }] }] }),
      order: objectSchema(ORDER_FIELDS, { op: 'order', description: OP_DESCRIPTIONS.order, allOf: [{ oneOf: [{ required: ['flows'] }, { required: ['lanes'] }, { required: ['pools'] }] }] }),
      ext: objectSchema(EXT_FIELDS, {
        op: 'ext',
        description: OP_DESCRIPTIONS.ext,
        allOf: [
          { if: { properties: { action: { const: 'add' } } }, then: { anyOf: [{ required: ['type'] }, { required: ['xml'] }], not: { required: ['index'] } } },
          { if: { properties: { action: { const: 'remove' } } }, then: { oneOf: [{ required: ['type'] }, { required: ['index'] }], not: { anyOf: [{ required: ['attrs'] }, { required: ['body'] }, { required: ['xml'] }, { required: ['replace'] }] } } },
        ],
      }),
      split: objectSchema(SPLIT_FIELDS, { op: 'split', description: OP_DESCRIPTIONS.split }),
      place: objectSchema(PLACE_FIELDS, { op: 'place', description: OP_DESCRIPTIONS.place, allOf: groupRules(PLACE_GROUPS) }),
      align: objectSchema(ALIGN_FIELDS, { op: 'align', description: OP_DESCRIPTIONS.align, allOf: [{ anyOf: [{ required: ['to'] }, { properties: { ids: { minItems: 2 } } }] }] }),
      color: objectSchema(COLOR_FIELDS, { op: 'color', description: OP_DESCRIPTIONS.color }),
      label: objectSchema(LABEL_FIELDS, { op: 'label', description: OP_DESCRIPTIONS.label }),
      route: objectSchema(ROUTE_FIELDS, { op: 'route', description: OP_DESCRIPTIONS.route }),
      space: objectSchema(SPACE_FIELDS, { op: 'space', description: OP_DESCRIPTIONS.space, allOf: [{ oneOf: [{ required: ['after'] }, { required: ['below'] }] }] }),
      tidy: objectSchema(TIDY_FIELDS, { op: 'tidy', description: OP_DESCRIPTIONS.tidy }),
      compact: objectSchema(COMPACT_FIELDS, { op: 'compact', description: OP_DESCRIPTIONS.compact }),
      branch: objectSchema(BRANCH_FIELDS, { description: 'One branch of a split: flow options of the gateway -> first node flow, then the nodes.', allOf: [defaultRule()] }),
      node: objectSchema(NODE_FIELDS, { description: 'A node inside a split branch: an add op without placement (it is chained after the previous node).', allOf: [defaultRule()] }),
    },
  };
}

/** JSON Schema (draft 2020-12) of the ops format, generated from the field specs. */
export const OPS_SCHEMA: Record<string, unknown> = buildSchema();

/* ------------------------------------------------------------------ */
/* example                                                              */
/* ------------------------------------------------------------------ */

/**
 * A small but complete example. It assumes a file made with
 * `bpmn new order.bpmn --name "Order handling" --target camunda8` and a
 * start event -> "Check invoice" user task -> end event.
 */
export function opsExample(): { ops: Op[] } {
  return {
    ops: [
      {
        op: 'split',
        after: 'Activity_CheckInvoice',
        kind: 'exclusiveGateway',
        name: 'Invoice ok?',
        id: 'Gateway_InvoiceOk',
        branches: [
          { flowName: 'yes', condition: '${ok}', nodes: [{ kind: 'serviceTask', name: 'Book invoice' }] },
          { flowName: 'no', default: true, nodes: [{ kind: 'userTask', name: 'Clarify invoice', set: { doc: 'Call the customer and clarify the open positions.' } }] },
        ],
      },
      { op: 'add', kind: 'boundaryEvent:timer', name: 'Reminder', on: 'Activity_ClarifyInvoice', timer: 'PT2D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', name: 'Remind customer', after: 'Event_Reminder' },
      { op: 'add', kind: 'endEvent', name: 'Reminder sent', in: 'Process_OrderHandling' },
      { op: 'connect', source: 'Activity_RemindCustomer', target: 'Event_ReminderSent' },
      { op: 'set', id: 'Activity_BookInvoice', values: { name: 'Book invoice in ERP', doc: 'Posts the invoice to the ledger.' } },
      { op: 'ext', id: 'Activity_BookInvoice', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'book-invoice', retries: '3' } },
    ],
  };
}
