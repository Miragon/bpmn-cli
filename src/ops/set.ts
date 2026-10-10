/**
 * `set`: key=value properties. Keys are what `show <id>` prints.
 *
 * CONTRACT (implemented in the "mutation" work package):
 *  Generic keys (any element): id (rename incl. every reference and
 *    calledElement strings), name, documentation|doc, any attribute-typed
 *    moddle property of the element's type by its property name (validated via
 *    descriptors, enums checked; e.g. isExecutable, isForCompensation,
 *    completionQuantity, processType, script, scriptFormat, implementation,
 *    calledElement, instantiate, gatewayDirection...), vendor attributes with
 *    a prefix (`camunda:assignee`, `zeebe:modelerTemplate`; the xmlns is declared
 *    automatically for known prefixes, E_UNKNOWN_NAMESPACE otherwise).
 *  Flows: condition, language, default (true|false), source, target (redirect).
 *    default=true removes the flow's condition (W_CONDITION_DROPPED) and
 *    reports a previous default flow losing the marker; default=true together
 *    with a condition is rejected (E_INVALID_VALUE).
 *  Events: trigger (kind suffix, e.g. `message`), timer, message, error,
 *    errorCode, signal, escalation, escalationCode, when, link,
 *    nonInterrupting (true|false)  -> via events.ts. nonInterrupting=true is
 *    refused for triggers that always interrupt (error/cancel/compensate,
 *    untyped start events, starts outside an event sub-process); a trigger
 *    change to such a trigger clears an existing flag with W_PROPERTY_DROPPED.
 *    Details of the current trigger are changed in place (the event
 *    definition keeps its id and vendor content; a new timer value is
 *    classified again); a trigger kind change reports dropped vendor content
 *    of the old definition (W_PROPERTY_DROPPED, see events.ts).
 *    A trigger change that would leave a message flow at an event that can no
 *    longer send/receive it is refused (E_INVALID_TRIGGER), like `connect` would.
 *  Activities: loop (none|standard|parallel|sequential), cardinality,
 *    completion (completionCondition). Removing or replacing a loop reports
 *    the vendor content that goes with it (W_PROPERTY_DROPPED).
 *  Send / receive tasks: message (name of a root bpmn:Message, created when
 *    missing; empty removes the reference).
 *  Business rule tasks: calledDecision (the decision link, written in the
 *    spelling of the file's platform: calledDecision= in a design model,
 *    camunda:decisionRef in Camunda 7, zeebe:calledDecision in Camunda 8; the
 *    other spellings are removed, empty removes the link; see decision.ts).
 *  Nested elements without an id of their own are addressed with a prefix:
 *    `definition.<key>` (the event definition), `loop.<key>` (the loop
 *    characteristics; a parallel multi-instance loop is created when missing),
 *    `condition.<key>` (the condition expression of a sequence flow or a
 *    conditional event). <key> is a vendor attribute (`loop.camunda:collection`)
 *    or an attribute of the nested BPMN type (`loop.isSequential`), or `id`.
 *    A camunda attribute the descriptor places on such a nested element is
 *    refused on the parent (E_WRONG_HOST, hint names the prefixed key); the
 *    same for a camunda attribute of a process set on its participant.
 *    An event with several event definitions (XSD-valid; the engines act on
 *    one of them) needs a selector: `definition[<n>].<key>` (0-based) or
 *    `definition[<trigger>].<key>`; a plain `definition.` is E_AMBIGUOUS_NESTED
 *    listing them (resolveNested; `ext` takes the same prefix).
 *    definition.activityRef (compensation) must name an activity of the
 *    event's own scope, or, from an event sub-process, of the scope around
 *    it (E_CROSS_SCOPE; the engines refuse anything else).
 *  Conditions are changed in place (id and vendor attributes stay); an inline
 *    body replacing a script resource drops camunda:resource and its language
 *    (W_PROPERTY_DROPPED), and a `${...}` body never inherits a script language.
 *    Removing a script resource (`condition.camunda:resource=`) from a
 *    condition without an inline body is E_INVALID_VALUE unless the same
 *    command sets condition= (flows; empty removes the condition) or when=
 *    (conditional events): an empty condition fails every evaluation.
 *  Sub-processes: expanded (true|false) -> recorded in `expansionRequests`
 *    (the pipeline merges it into the layouter options); triggeredByEvent.
 *  Flow nodes: lane (lane id or empty to remove).
 *  Rename (id=): every BPMN reference follows, plus string references
 *    (calledElement, zeebe:calledElement processId) and the id-valued
 *    attributes of camunda extension elements the descriptor knows
 *    (camunda:errorEventDefinition errorRef).
 *  Text annotations: text.
 *  `key=` (empty value) and --unset remove the property.
 *  Unknown keys -> E_UNKNOWN_KEY listing the settable keys for that element.
 *  Export SET_KEYS: per family, the documented keys with a one-line description
 *  (used by `bpmn kinds`).
 *
 * This module also hosts the small helpers every mutation shares
 * (`changeOf`, `descriptorOf`, `ownValue`, `idOf`).
 */
import type { Doc } from '../document.js';
import { modelError, usageError } from '../errors.js';
import { kindLabel, kindOf, normalizeTrigger, triggerOf, TRIGGER_TYPES, type Trigger } from '../kinds.js';
import { diExpansionState } from '../layout.js';
import { addTo, is, localType, many, walk, type El } from '../model.js';
import { attrAppliesTo, camundaAttr, camundaAttrsFor, idReferenceAttrs, isC7Uri, typeIs, ZEEBE_URI } from '../platform/descriptor.js';
import { zeebeAllowedOn, zeebeAttr, zeebeType, zeebeTypeNames } from '../platform/zeebe.js';
import { ChangeSet, type Change } from '../result.js';
import { assignLane } from './containers.js';
import { setDecisionLink } from './decision.js';
import { applyTrigger, ensureRootElement, vendorContent } from './events.js';
import { assertCondition, flowChange, redirectFlow, setDefaultFlow, setFlowCondition } from './flows.js';
import type { SetOp, TriggerOptions } from './types.js';

/* ------------------------------------------------------------------ */
/* shared helpers                                                       */
/* ------------------------------------------------------------------ */

/** A moddle property descriptor (the subset the mutations rely on). */
export interface PropDescriptor {
  name: string;
  type: string;
  isAttr?: boolean;
  isReference?: boolean;
  isMany?: boolean;
  isBody?: boolean;
  default?: unknown;
}

export interface TypeDescriptor {
  isGeneric?: boolean;
  properties?: PropDescriptor[];
  propertiesByName?: Record<string, PropDescriptor>;
}

/** Typed access to an element's moddle descriptor. */
export function descriptorOf(el: El): TypeDescriptor {
  return el.$descriptor as unknown as TypeDescriptor;
}

/** Reads an own property without triggering moddle's lazy collection creation. */
export function ownValue(el: El, prop: string): unknown {
  return Object.prototype.hasOwnProperty.call(el, prop) ? (el as unknown as Record<string, unknown>)[prop] : undefined;
}

export function idOf(el: El): string {
  return el.get<string | undefined>('id') ?? '';
}

/** True for moddle elements (typed or generic). */
export function isEl(v: unknown): v is El {
  return !!v && typeof v === 'object' && typeof (v as El).$type === 'string';
}

/** Canonical kind label for change-set entries (kinds table first, then lowerCamel type). */
export function changeKind(el: El): string {
  if (kindOf(el)) return kindLabel(el);
  if (is(el, 'bpmn:SequenceFlow')) return 'sequenceFlow';
  if (is(el, 'bpmn:MessageFlow')) return 'messageFlow';
  if (is(el, 'bpmn:DataAssociation')) return 'dataAssociation';
  if (is(el, 'bpmn:Association')) return 'association';
  const local = el.$type.split(':')[1] ?? el.$type;
  return local.charAt(0).toLowerCase() + local.slice(1);
}

/** ChangeSet entry for an element. */
export function changeOf(el: El, detail?: string): Change {
  const name = el.get<string | undefined>('name');
  return { id: idOf(el), kind: changeKind(el), ...(name ? { name } : {}), ...(detail ? { detail } : {}) };
}

/* ------------------------------------------------------------------ */
/* expansion requests (sub-process expanded/collapsed)                  */
/* ------------------------------------------------------------------ */

/** Sub-process expansion requested via `set <id> expanded=...`, per document. */
export const expansionRequests = new WeakMap<Doc, Map<string, boolean>>();

/** Records that a sub-process should be laid out expanded (true) or collapsed (false). */
export function requestExpansion(doc: Doc, id: string, expanded: boolean): void {
  let map = expansionRequests.get(doc);
  if (!map) {
    map = new Map();
    expansionRequests.set(doc, map);
  }
  map.set(id, expanded);
}

/** The expansion requests recorded for a document, as layouter options. */
export function requestedExpansion(doc: Doc): { expand: string[]; collapse: string[] } {
  const expand: string[] = [];
  const collapse: string[] = [];
  for (const [id, expanded] of expansionRequests.get(doc) ?? []) (expanded ? expand : collapse).push(id);
  return { expand, collapse };
}

/* ------------------------------------------------------------------ */
/* key documentation                                                    */
/* ------------------------------------------------------------------ */

export interface SetKeyDoc {
  key: string;
  appliesTo: string;
  description: string;
}

const APPLIES_TO: Record<string, (el: El) => boolean> = {
  any: () => true,
  sequenceFlow: (el) => is(el, 'bpmn:SequenceFlow'),
  flowNode: (el) => is(el, 'bpmn:FlowNode'),
  event: (el) => is(el, 'bpmn:Event'),
  activity: (el) => is(el, 'bpmn:Activity'),
  subProcess: (el) => is(el, 'bpmn:SubProcess'),
  textAnnotation: (el) => is(el, 'bpmn:TextAnnotation'),
  'sendTask, receiveTask': (el) => is(el, 'bpmn:SendTask') || is(el, 'bpmn:ReceiveTask'),
  businessRuleTask: (el) => is(el, 'bpmn:BusinessRuleTask'),
  conditionalEvent: (el) => is(el, 'bpmn:Event') && triggerOf(el) === 'conditional',
};

export const SET_KEYS: SetKeyDoc[] = [
  { key: 'id', appliesTo: 'any', description: 'Rename the element; every reference (flows, lanes, boundary hosts, calledElement) follows' },
  { key: 'name', appliesTo: 'any', description: 'Display name (empty value removes it)' },
  { key: 'doc', appliesTo: 'any', description: 'Documentation text (alias: documentation; empty removes it)' },
  { key: '<prefix>:<attr>', appliesTo: 'any', description: 'Vendor attribute, e.g. camunda:assignee=alice or zeebe:modelerTemplate=x (xmlns declared automatically for known prefixes)' },
  { key: '<property>', appliesTo: 'any', description: 'Any attribute of the BPMN type by property name, e.g. isExecutable, calledElement, scriptFormat, script, implementation, isForCompensation, completionQuantity, gatewayDirection, instantiate' },
  { key: 'condition', appliesTo: 'sequenceFlow', description: 'Condition expression (empty removes it; clears the default marker of the flow)' },
  { key: 'language', appliesTo: 'sequenceFlow', description: 'Expression language of the condition' },
  { key: 'default', appliesTo: 'sequenceFlow', description: 'true|false: make this flow the default flow of its source gateway/activity (removes its condition; a previous default flow loses the marker)' },
  { key: 'default', appliesTo: 'flowNode', description: 'Id of the default outgoing flow of a gateway/activity (empty clears it)' },
  { key: 'source', appliesTo: 'sequenceFlow', description: 'Redirect the flow: new source node id' },
  { key: 'target', appliesTo: 'sequenceFlow', description: 'Redirect the flow: new target node id' },
  { key: 'trigger', appliesTo: 'event', description: 'Event trigger: none|message|timer|error|signal|escalation|conditional|link|compensate|terminate|cancel' },
  { key: 'timer', appliesTo: 'event', description: 'ISO 8601 timer: R/PT1H (cycle), PT5M (duration) or a date; implies trigger=timer' },
  { key: 'message', appliesTo: 'event', description: 'Message name (a root bpmn:Message is created when missing); implies trigger=message' },
  { key: 'error', appliesTo: 'event', description: 'Error name (root bpmn:Error created when missing); implies trigger=error' },
  { key: 'errorCode', appliesTo: 'event', description: 'errorCode of the referenced bpmn:Error' },
  { key: 'signal', appliesTo: 'event', description: 'Signal name; implies trigger=signal' },
  { key: 'escalation', appliesTo: 'event', description: 'Escalation name; implies trigger=escalation' },
  { key: 'escalationCode', appliesTo: 'event', description: 'escalationCode of the referenced bpmn:Escalation' },
  { key: 'when', appliesTo: 'event', description: 'Condition expression of a conditional event; implies trigger=conditional' },
  { key: 'link', appliesTo: 'event', description: 'Link name of a link event; implies trigger=link' },
  { key: 'nonInterrupting', appliesTo: 'event', description: 'true|false: boundary events (cancelActivity) and event sub-process start events (isInterrupting); never for error/cancel/compensate triggers or untyped start events' },
  { key: 'loop', appliesTo: 'activity', description: 'none|standard|parallel|sequential (parallel/sequential = multi-instance)' },
  { key: 'cardinality', appliesTo: 'activity', description: 'Multi-instance loop cardinality expression (creates a parallel multi-instance loop when none exists)' },
  { key: 'completion', appliesTo: 'activity', description: 'Multi-instance completion condition expression' },
  { key: 'expanded', appliesTo: 'subProcess', description: 'true|false: draw the sub-process expanded (default) or collapsed' },
  { key: 'triggeredByEvent', appliesTo: 'subProcess', description: 'true|false: event sub-process' },
  { key: 'message', appliesTo: 'sendTask, receiveTask', description: 'Message name of a send / receive task (a root bpmn:Message is created when missing; empty removes the reference)' },
  { key: 'calledDecision', appliesTo: 'businessRuleTask', description: 'The decision the task calls, in the spelling of the file\'s platform: calledDecision="<id>" in a design model (no engine namespace, design-iq), camunda:decisionRef in Camunda 7, a zeebe:calledDecision decisionId in Camunda 8 (the other spellings are removed; empty removes the link)' },
  { key: 'definition.<key>', appliesTo: 'event', description: "Attribute of the event definition, e.g. definition.camunda:errorCodeVariable=code, definition.camunda:type=external + definition.camunda:topic=x (message throw / end), definition.camunda:variableName=amount (conditional); an event with several event definitions takes 'definition[<n>].<key>' (0-based) or 'definition[<trigger>].<key>'" },
  { key: 'loop.<key>', appliesTo: 'activity', description: 'Attribute of the loop characteristics, e.g. loop.camunda:collection=${items}, loop.camunda:elementVariable=item, loop.camunda:asyncBefore=true (creates a parallel multi-instance loop when none exists)' },
  { key: 'condition.<key>', appliesTo: 'sequenceFlow', description: 'Attribute of the condition expression, e.g. condition.camunda:resource=deployment://check.groovy (a script resource condition; set language= too)' },
  { key: 'condition.<key>', appliesTo: 'conditionalEvent', description: 'Attribute of the condition expression of a conditional event, e.g. condition.camunda:resource=deployment://ready.groovy condition.language=groovy; the event definition itself is definition.<key> (definition.camunda:variableName=amount)' },
  { key: 'lane', appliesTo: 'flowNode', description: 'Lane id the node belongs to (empty removes lane membership)' },
  { key: 'text', appliesTo: 'textAnnotation', description: 'Annotation text' },
];

const EVENT_KEYS = new Set(['trigger', 'timer', 'message', 'error', 'errorCode', 'signal', 'escalation', 'escalationCode', 'when', 'link', 'nonInterrupting']);

const TRIGGER_OF_KEY: Record<string, Trigger> = {
  timer: 'timer',
  message: 'message',
  error: 'error',
  errorCode: 'error',
  signal: 'signal',
  escalation: 'escalation',
  escalationCode: 'escalation',
  when: 'conditional',
  link: 'link',
};

/** Properties that must not be set generically (they have a dedicated command / key). */
const BLOCKED_PROPS: Record<string, string> = {
  attachedToRef: 'use `bpmn move <id> --on <activityId>`',
  sourceRef: 'use source=<nodeId>',
  targetRef: 'use target=<nodeId>',
  processRef: 'a participant is bound to its process on creation',
  bpmnElement: 'diagram interchange is generated automatically',
};

const PRIMITIVE_TYPES = new Set(['String', 'Boolean', 'Integer', 'Real']);

/* ------------------------------------------------------------------ */
/* descriptor helpers                                                   */
/* ------------------------------------------------------------------ */

function enumLiterals(doc: Doc, type: string): string[] | undefined {
  const [prefix, local] = type.split(':');
  if (!prefix || !local) return undefined;
  let pkg: { enumerations?: Array<{ name: string; literalValues?: Array<{ name: string }> }> } | undefined;
  try {
    pkg = doc.moddle.getPackage(prefix) as typeof pkg;
  } catch {
    return undefined;
  }
  const found = pkg?.enumerations?.find((e) => e.name === local);
  return found?.literalValues?.map((l) => l.name);
}

/** True when a descriptor property can be set from a string (primitive, enum or id-referencing attribute). */
function isSettableProp(doc: Doc, p: PropDescriptor): boolean {
  if (p.isMany || BLOCKED_PROPS[p.name]) return false;
  if (p.isReference) return !!p.isAttr;
  return PRIMITIVE_TYPES.has(p.type) || !!enumLiterals(doc, p.type);
}

function genericKeys(doc: Doc, el: El): string[] {
  return (descriptorOf(el).properties ?? []).filter((p) => p.name !== 'id' && isSettableProp(doc, p)).map((p) => p.name);
}

/** Every key `set` accepts for this element (documented keys + type attributes). */
export function settableKeys(doc: Doc, el: El): string[] {
  const keys = new Set<string>();
  for (const k of SET_KEYS) {
    if (k.key.startsWith('<')) continue;
    if (APPLIES_TO[k.appliesTo]?.(el)) keys.add(k.key);
  }
  for (const k of genericKeys(doc, el)) keys.add(k);
  keys.add('<prefix>:<attr>');
  return [...keys];
}

/* ------------------------------------------------------------------ */
/* value parsing                                                        */
/* ------------------------------------------------------------------ */

function invalidValue(el: El, key: string, message: string, hint?: string) {
  return modelError('E_INVALID_VALUE', `Invalid value for ${key} on ${idOf(el)}: ${message}`, { element: idOf(el), ...(hint ? { hint } : {}) });
}

function parseBool(el: El, key: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(v)) return true;
  if (['false', 'no', '0', 'off'].includes(v)) return false;
  throw invalidValue(el, key, `"${value}" is not a boolean`, `Use ${key}=true or ${key}=false.`);
}

/** Converts a string to the property's type; errors name `el` and `label` (the key as given). */
function coerceValue(doc: Doc, el: El, p: PropDescriptor, value: string, label: string = p.name): unknown {
  if (p.isReference) return doc.require(value, p.type, p.name);
  switch (p.type) {
    case 'String':
      return value;
    case 'Boolean':
      return parseBool(el, label, value);
    case 'Integer': {
      if (!/^-?\d+$/.test(value.trim())) throw invalidValue(el, label, `"${value}" is not an integer`);
      return Number(value);
    }
    case 'Real': {
      const n = Number(value);
      if (!value.trim() || Number.isNaN(n)) throw invalidValue(el, label, `"${value}" is not a number`);
      return n;
    }
    default: {
      const literals = enumLiterals(doc, p.type) ?? [];
      const hit = literals.find((l) => l.toLowerCase() === value.trim().toLowerCase());
      if (!hit) throw invalidValue(el, label, `"${value}" is not one of ${literals.join('|')}`);
      return hit;
    }
  }
}

function unknownKey(doc: Doc, el: El, key: string, reason?: string) {
  const keys = settableKeys(doc, el);
  return modelError('E_UNKNOWN_KEY', `Unknown key "${key}" for ${kindLabel(el)} ${idOf(el)}${reason ? ` (${reason})` : ''}`, {
    element: idOf(el),
    candidates: keys,
    hint: `Settable keys for this element: ${keys.join(', ')}.`,
  });
}

function normalizeKey(key: string): string {
  const k = key.trim();
  if (k === 'documentation') return 'doc';
  if (k.toLowerCase().startsWith('bpmn:')) return k.slice(5);
  return k;
}

function expression(doc: Doc, body: string, parent: El, language?: string): El {
  const expr = doc.moddle.create('bpmn:FormalExpression', { body, ...(language ? { language } : {}) });
  expr.$parent = parent;
  return expr;
}

/* ------------------------------------------------------------------ */
/* entry point                                                          */
/* ------------------------------------------------------------------ */

/** Applies `op.values` (key=value) and `op.unset` (key=) to one element. */
export function setProperties(doc: Doc, op: SetOp): ChangeSet {
  const cs = new ChangeSet();
  const el = doc.require(op.id);
  const entries: Array<[string, string]> = [
    ...Object.entries(op.values ?? {}).map(([k, v]) => [normalizeKey(k), v === undefined || v === null ? '' : String(v)] as [string, string]),
    ...(op.unset ?? []).map((k) => [normalizeKey(k), ''] as [string, string]),
  ];
  if (!entries.length) {
    throw usageError('Nothing to set: pass key=value pairs (or --unset <key>)', { element: op.id, hint: `Settable keys: ${settableKeys(doc, el).join(', ')}` });
  }
  const eventKeys = new Map<string, string>();
  const conditionKeys = new Map<string, string>();
  const nested: Array<{ slot: string; key: string; value: string }> = [];
  if (is(el, 'bpmn:SequenceFlow')) {
    const wantsDefault = entries.some(([k, v]) => k === 'default' && v && parseBool(el, k, v));
    const wantsCondition = entries.some(([k, v]) => k === 'condition' && v);
    if (wantsDefault && wantsCondition) {
      throw invalidValue(el, 'default', 'default=true and condition cannot be combined: a default flow has no condition', 'Set one of them, or condition= (empty) together with default=true.');
    }
  }
  for (const [key, value] of entries) {
    const split = splitNestedKey(key);
    if (split) {
      nested.push({ ...split, value });
      continue;
    }
    if (EVENT_KEYS.has(key) && is(el, 'bpmn:Event')) {
      eventKeys.set(key, value);
      continue;
    }
    if ((key === 'condition' || key === 'language') && is(el, 'bpmn:SequenceFlow')) {
      conditionKeys.set(key, value);
      continue;
    }
    applyKey(doc, el, key, value, cs);
  }
  // nested keys run after the keys that create their element (loop=, trigger=, when=);
  // a flow's condition.* keys run first, so that a script resource condition can take a language=
  const flowCondition = is(el, 'bpmn:SequenceFlow') ? nested.filter((n) => n.slot === 'condition') : [];
  const newResource = flowCondition.some((n) => n.value && isResourceKey(doc, n.key));
  if (conditionKeys.get('condition') && newResource) {
    throw invalidValue(el, 'condition', 'a condition is either an inline expression (condition=) or a script resource (condition.camunda:resource=), not both', 'Pass one of them; a script resource also needs language=<script language>.');
  }
  if (conditionKeys.has('condition') && newResource) {
    // `condition= condition.camunda:resource=<uri>`: the inline body is replaced by the resource on purpose
    conditionKeys.delete('condition');
    el.get<El | undefined>('conditionExpression')?.set('body', undefined);
  }
  // condition= in the same command replaces (or removes) what a removed script resource leaves behind
  for (const n of flowCondition) applyNestedKey(doc, el, n.slot, n.key, n.value, cs, conditionKeys.has('condition'));
  if (conditionKeys.size) applyCondition(doc, el, conditionKeys, cs);
  // a conditional event's script resource removed together with when=: removed first, so that when= fills the condition
  const resourceRemoval = is(el, 'bpmn:Event') ? nested.filter((n) => n.slot === 'condition' && !n.value && isResourceKey(doc, n.key)) : [];
  for (const n of resourceRemoval) applyNestedKey(doc, el, n.slot, n.key, n.value, cs, eventKeys.has('when'));
  if (eventKeys.size) applyEventKeys(doc, el, eventKeys, cs);
  for (const n of nested) if (!flowCondition.includes(n) && !resourceRemoval.includes(n)) applyNestedKey(doc, el, n.slot, n.key, n.value, cs);
  doc.invalidate();
  return cs;
}

function applyKey(doc: Doc, el: El, key: string, value: string, cs: ChangeSet): void {
  if (key.includes(':')) value = vendorValue(doc, el, key, value);
  const detail = value ? `${key}=${value}` : `${key} removed`;
  switch (key) {
    case 'id': {
      if (!value) throw invalidValue(el, key, 'an id cannot be empty');
      const old = idOf(el);
      renameId(doc, el, value);
      cs.change(changeOf(el, `renamed from ${old}`));
      return;
    }
    case 'name':
      el.set('name', value || undefined);
      break;
    case 'doc':
      setDocumentation(doc, el, value);
      break;
    case 'default':
      setDefaultKey(doc, el, value, cs);
      break;
    case 'source':
    case 'target': {
      if (!is(el, 'bpmn:SequenceFlow')) throw unknownKey(doc, el, key, 'applies to sequence flows');
      if (!value) throw invalidValue(el, key, 'a flow always needs a source and a target');
      const node = doc.require(value, 'bpmn:FlowNode');
      redirectFlow(doc, el, key === 'source' ? { source: node } : { target: node });
      cs.change({ ...flowChange(el), detail: `${flowChange(el).detail} (${key} changed)` });
      return;
    }
    case 'loop':
    case 'cardinality':
    case 'completion':
      if (!is(el, 'bpmn:Activity')) throw unknownKey(doc, el, key, 'applies to activities');
      setLoopKey(doc, el, key, value, cs);
      break;
    case 'expanded': {
      if (!is(el, 'bpmn:SubProcess')) throw unknownKey(doc, el, key, 'applies to sub-processes');
      requestExpansion(doc, idOf(el), value ? parseBool(el, key, value) : true);
      break;
    }
    case 'lane': {
      if (!is(el, 'bpmn:FlowNode')) throw unknownKey(doc, el, key, 'applies to flow nodes');
      assignLane(doc, el, value ? doc.require(value, 'bpmn:Lane', 'lane') : undefined, cs);
      break;
    }
    case 'message':
      if (!is(el, 'bpmn:SendTask') && !is(el, 'bpmn:ReceiveTask')) throw unknownKey(doc, el, key, 'applies to events, send tasks and receive tasks');
      setTaskMessage(doc, el, value, cs);
      break;
    case 'calledDecision':
      // another element: an unprefixed calledDecision="..." BPMN does not define can only be removed (W_C7_DEPLOY_SCHEMA)
      if (is(el, 'bpmn:BusinessRuleTask') || value) {
        cs.change(changeOf(el, setDecisionLink(doc, el, value, cs)));
        return;
      }
      setModelProperty(doc, el, key, value);
      break;
    default:
      if (key.includes(':')) {
        if (value) assertVendorHost(doc, el, key, value);
        if (value) assertZeebeHost(doc, el, key, value);
        setVendorAttribute(doc, el, key, value);
      } else setModelProperty(doc, el, key, value);
  }
  cs.change(changeOf(el, detail));
}

/**
 * Sets (or with an empty name removes) the message of a send / receive task:
 * the root bpmn:Message is found by id or name, or created (`Message_<Slug>`,
 * reported as created) like an event's message trigger.
 */
export function setTaskMessage(doc: Doc, task: El, name: string, cs: ChangeSet): void {
  if (!name) {
    task.set('messageRef', undefined);
    return;
  }
  const { el: message, created } = ensureRootElement(doc, 'bpmn:Message', name);
  task.set('messageRef', message);
  if (created) cs.create({ id: idOf(message), kind: 'message', name: message.get<string>('name'), detail: 'root element' });
}

/* ------------------------------------------------------------------ */
/* individual keys                                                      */
/* ------------------------------------------------------------------ */

function setDocumentation(doc: Doc, el: El, value: string): void {
  const docs = many(el, 'documentation');
  if (!value) {
    docs.splice(0, docs.length);
    return;
  }
  const first = docs[0];
  if (first) first.set('text', value);
  else addTo(el, 'documentation', doc.moddle.create('bpmn:Documentation', { text: value }));
}

/**
 * Makes `flow` the default flow of its source, reporting what that implies:
 * the flow's own condition is removed (W_CONDITION_DROPPED) and a previous
 * default flow of the source loses its marker (reported as a change).
 */
function makeDefaultFlow(doc: Doc, flow: El, cs: ChangeSet): void {
  const source = flow.get<El>('sourceRef');
  const previous = source.get<El | undefined>('default');
  const expr = flow.get<El | undefined>('conditionExpression');
  const resourceKey = resourceKeyOf(doc, expr);
  const condition = expr?.get<string | undefined>('body') ?? (resourceKey ? `${resourceKey}=${String(expr!.$attrs[resourceKey])}` : undefined);
  setDefaultFlow(doc, flow, true);
  if (condition) {
    cs.warn({
      code: 'W_CONDITION_DROPPED',
      message: `Condition "${condition}" of ${idOf(flow)} was removed: a default flow has no condition`,
      element: idOf(flow),
      hint: 'Default flows are taken when no other condition matches; set the condition on another outgoing flow if it is still needed.',
    });
  }
  if (previous && previous !== flow) cs.change(changeOf(previous, `no longer the default flow of ${idOf(source)}`));
}

function setDefaultKey(doc: Doc, el: El, value: string, cs: ChangeSet): void {
  if (is(el, 'bpmn:SequenceFlow')) {
    if (value && parseBool(el, 'default', value)) makeDefaultFlow(doc, el, cs);
    else setDefaultFlow(doc, el, false);
    return;
  }
  if (!descriptorOf(el).propertiesByName?.['default']) {
    throw unknownKey(doc, el, 'default', 'only exclusive/inclusive gateways, activities and sequence flows have a default');
  }
  if (!value) {
    el.set('default', undefined);
    return;
  }
  const flow = doc.require(value, 'bpmn:SequenceFlow', 'sequence flow');
  if (flow.get<El | undefined>('sourceRef') !== el) {
    throw modelError('E_NOT_OUTGOING', `${value} is not an outgoing flow of ${idOf(el)}`, {
      element: idOf(el),
      related: [value],
      candidates: doc.outgoing(el).map(idOf),
      hint: `Outgoing flows of ${idOf(el)}: ${doc.outgoing(el).map(idOf).join(', ') || 'none'}.`,
    });
  }
  makeDefaultFlow(doc, flow, cs);
}

function setLoopKey(doc: Doc, el: El, key: string, value: string, cs: ChangeSet): void {
  const current = el.get<El | undefined>('loopCharacteristics');
  const isMulti = is(current, 'bpmn:MultiInstanceLoopCharacteristics');
  if (key === 'loop') {
    const mode = (value || 'none').trim().toLowerCase();
    if (mode === 'none') {
      el.set('loopCharacteristics', undefined);
      if (current) dropLoop(doc, el, current, mode, cs);
    } else if (mode === 'standard') {
      if (!is(current, 'bpmn:StandardLoopCharacteristics')) {
        const loop = doc.moddle.create('bpmn:StandardLoopCharacteristics');
        loop.$parent = el;
        el.set('loopCharacteristics', loop);
        if (current) dropLoop(doc, el, current, mode, cs);
      }
    } else if (mode === 'parallel' || mode === 'sequential') {
      const multi = isMulti ? current! : createMultiInstance(doc, el);
      multi.set('isSequential', mode === 'sequential');
      if (current && !isMulti) dropLoop(doc, el, current, mode, cs);
    } else {
      throw invalidValue(el, key, `"${value}" is not one of none|standard|parallel|sequential`);
    }
    return;
  }
  const prop = key === 'cardinality' ? 'loopCardinality' : 'completionCondition';
  if (!value) {
    if (isMulti) current!.set(prop, undefined);
    return;
  }
  if (current && !isMulti) {
    throw invalidValue(el, key, `${key} needs a multi-instance loop, but ${idOf(el)} has a standard loop`, 'Set loop=parallel or loop=sequential first.');
  }
  let multi = current;
  if (!multi) {
    multi = createMultiInstance(doc, el);
    cs.note(`${idOf(el)}: created a parallel multi-instance loop for ${key}`);
  }
  multi.set(prop, expression(doc, value, multi));
}

function createMultiInstance(doc: Doc, el: El): El {
  const multi = doc.moddle.create('bpmn:MultiInstanceLoopCharacteristics');
  multi.$parent = el;
  el.set('loopCharacteristics', multi);
  return multi;
}

/** lowerCamel local type for messages, e.g. `multiInstanceLoopCharacteristics`. */
function typeLabel(el: El): string {
  const local = localType(el);
  return local.charAt(0).toLowerCase() + local.slice(1);
}

/** Releases the ids of a removed loop and reports its vendor content (W_PROPERTY_DROPPED). */
function dropLoop(doc: Doc, el: El, old: El, mode: string, cs: ChangeSet): void {
  for (const e of walk(old, { bpmnOnly: true })) {
    const id = e.get<string | undefined>('id');
    if (id) doc.ids.release(id);
  }
  const lost = vendorContent(old);
  if (!lost.length) return;
  const oldId = old.get<string | undefined>('id');
  cs.warn({
    code: 'W_PROPERTY_DROPPED',
    message: `${lost.join(', ')} of the ${typeLabel(old)}${oldId ? ` ${oldId}` : ''} of ${idOf(el)} ${lost.length > 1 ? 'were' : 'was'} dropped: loop=${mode} ${mode === 'none' ? 'removes the loop' : 'replaces it'}`,
    element: idOf(el),
    hint: 'Vendor attributes and extension elements belong to the old loop characteristics; set what the new loop still needs with `bpmn set <file> <id> loop.<prefix>:<attr>=<value>`.',
  });
}

/**
 * A camunda attribute the descriptor types as Boolean (asyncBefore, exclusive,
 * isStartableInTasklist, ...) is written as exactly true / false: the engines
 * read only the exact value "true" (asyncBefore=yes would silently stay off).
 * Other values are written as given.
 */
function vendorValue(doc: Doc, el: El, key: string, value: string, label: string = key): string {
  if (!value) return value;
  const local = camundaLocal(doc, key);
  if (!local || camundaAttr(local)?.type !== 'Boolean') return value;
  return String(parseBool(el, label, value));
}

function setVendorAttribute(doc: Doc, el: El, key: string, value: string): void {
  const idx = key.indexOf(':');
  const prefix = key.slice(0, idx);
  const local = key.slice(idx + 1);
  if (!prefix || !local || prefix === 'xmlns') throw unknownKey(doc, el, key, 'vendor attributes look like prefix:name');
  if (!value) {
    delete el.$attrs[key];
    return;
  }
  doc.declareNamespace(prefix);
  el.$attrs[key] = value;
}

/**
 * Removes an attribute without prefix that BPMN does not define but the
 * reader kept (`assignee="..."` on a user task: the engines validate against
 * the schema and refuse the file, W_C7_DEPLOY_SCHEMA). Only removal: such a
 * key cannot be set. (A business rule task's `calledDecision` is its decision
 * link, see decision.ts.)
 */
function removeUndefinedAttr(el: El, key: string, value: string): boolean {
  if (value || key.includes(':') || descriptorOf(el).propertiesByName?.[key]) return false;
  if (!el.$attrs || !Object.prototype.hasOwnProperty.call(el.$attrs, key)) return false;
  delete el.$attrs[key];
  return true;
}

function setModelProperty(doc: Doc, el: El, key: string, value: string): void {
  if (removeUndefinedAttr(el, key, value)) return;
  const p = descriptorOf(el).propertiesByName?.[key];
  if (!p || key === 'id') throw unknownKey(doc, el, key);
  const blocked = BLOCKED_PROPS[key];
  if (blocked) throw unknownKey(doc, el, key, blocked);
  if (!isSettableProp(doc, p)) throw unknownKey(doc, el, key, `${key} is not an attribute`);
  if (!value) {
    el.set(key, undefined);
    return;
  }
  el.set(key, coerceValue(doc, el, p, value));
}

/** True for a camunda:resource key (any prefix bound to the camunda namespace, or Operaton's: operaton:resource). */
function isResourceKey(doc: Doc, key: string): boolean {
  const [prefix, local] = key.split(':');
  return local === 'resource' && !!prefix && isC7Uri(doc.namespaceUri(prefix));
}

/** The camunda:resource attribute key of an expression, if it has one. */
function resourceKeyOf(doc: Doc, expr: El | undefined): string | undefined {
  if (!expr) return undefined;
  return Object.keys(expr.$attrs ?? {}).find((k) => isResourceKey(doc, k) && expr.$attrs[k] !== undefined && expr.$attrs[k] !== '');
}

/** A body that is one `${...}` / `#{...}` expression (JUEL), not a script. */
function isJuel(body: string): boolean {
  return /^\s*[$#]\{[\s\S]*\}\s*$/.test(body);
}

/**
 * condition= / language= of a sequence flow. The existing expression is
 * updated in place (id and vendor attributes stay). An inline body replacing a
 * script resource drops camunda:resource and, unless language= is given, the
 * script's language; a JUEL body never inherits a script language. Both are
 * reported (W_PROPERTY_DROPPED). A resource condition has no body but is a
 * condition: language= works on it.
 */
function applyCondition(doc: Doc, flow: El, keys: Map<string, string>, cs: ChangeSet): void {
  const existing = flow.get<El | undefined>('conditionExpression');
  const oldBody = existing?.get<string | undefined>('body');
  const oldLanguage = existing?.get<string | undefined>('language');
  const resourceKey = resourceKeyOf(doc, existing);
  const hasCondition = !!existing && (!!oldBody || !!resourceKey);
  if (!keys.has('condition')) {
    const language = keys.get('language') || undefined;
    if (!hasCondition) {
      if (language) throw modelError('E_NO_CONDITION', `${idOf(flow)} has no condition to set a language on`, { element: idOf(flow), hint: 'Set condition=<expression> (or condition.camunda:resource=<uri>) too.' });
      return;
    }
    existing!.set('language', language);
    cs.change(changeOf(flow, language ? `language=${language}` : 'language removed'));
    return;
  }
  const condition = keys.get('condition') ?? '';
  if (!condition) {
    if (keys.get('language')) throw modelError('E_NO_CONDITION', `${idOf(flow)} has no condition to set a language on`, { element: idOf(flow), hint: 'Set condition=<expression> too.' });
    setFlowCondition(doc, flow, undefined);
    cs.change(changeOf(flow, 'condition removed'));
    return;
  }
  assertCondition(condition);
  const dropped: string[] = [];
  let language: string | undefined;
  if (keys.has('language')) language = keys.get('language') || undefined;
  else if (oldLanguage && resourceKey) dropped.push(`language ${oldLanguage}`);
  else if (oldLanguage && isJuel(condition) && oldLanguage.toLowerCase() !== 'juel') dropped.push(`language ${oldLanguage}`);
  else language = oldLanguage;
  if (!existing || !is(existing, 'bpmn:FormalExpression')) {
    setFlowCondition(doc, flow, condition, language);
  } else {
    if (resourceKey) {
      dropped.unshift(`${resourceKey} ${String(existing.$attrs[resourceKey])}`);
      delete existing.$attrs[resourceKey];
    }
    existing.set('body', condition);
    existing.set('language', language);
    const source = flow.get<El | undefined>('sourceRef');
    if (source?.get<El | undefined>('default') === flow) source.set('default', undefined);
  }
  if (dropped.length) {
    cs.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `${dropped.join(' and ')} of the condition of ${idOf(flow)} ${dropped.length > 1 ? 'were' : 'was'} dropped: ${resourceKey ? 'the inline condition replaces the script resource' : `"${condition}" is an expression, not a ${oldLanguage} script`}`,
      element: idOf(flow),
      hint: resourceKey
        ? 'To keep a script resource set condition.camunda:resource=<uri> (and language=<lang>) instead of condition=; to run the inline body as a script add language=<lang>.'
        : `Pass language=${oldLanguage} together with condition= to keep the script language.`,
    });
  }
  cs.change(changeOf(flow, `condition=${condition}${language ? ` (${language})` : ''}`));
}

/* ------------------------------------------------------------------ */
/* nested elements: definition. / loop. / condition.                     */
/* ------------------------------------------------------------------ */

/** Key prefixes that address a nested element without an id of its own. */
export const NESTED_SLOTS = ['definition', 'loop', 'condition'] as const;
export type NestedSlot = (typeof NESTED_SLOTS)[number];

export const SLOT_TEXT: Record<NestedSlot, string> = {
  definition: 'event definition',
  loop: 'loop characteristics',
  condition: 'condition expression',
};

/**
 * `loop.camunda:collection` -> { slot: 'loop', key: 'camunda:collection' }
 * (`definition[1].id` -> { slot: 'definition[1]', key: 'id' }); undefined for
 * keys without a slot prefix.
 */
export function splitNestedKey(key: string): { slot: string; key: string } | undefined {
  const selector = /^(\w+\[[^\]]*\])\.(.*)$/.exec(key);
  if (selector) return { slot: selector[1]!, key: selector[2]! };
  const dot = key.indexOf('.');
  if (dot <= 0) return undefined;
  const colon = key.indexOf(':');
  if (colon >= 0 && colon < dot) return undefined; // a vendor attribute with a dot in its name
  return { slot: key.slice(0, dot), key: key.slice(dot + 1) };
}

/**
 * A slot as written before the `.` of a nested key or an ext type:
 * `definition`, `loop`, `condition`, or one event definition of an event
 * that has several, by position (`definition[1]`, 0-based) or by trigger
 * (`definition[timer]`). `invalid` holds a selector that is neither.
 */
export interface SlotRef {
  slot: NestedSlot;
  /** the prefix as given, e.g. `definition[timer]` */
  text: string;
  index?: number;
  trigger?: Exclude<Trigger, 'none'>;
  invalid?: string;
}

/** Parses a slot prefix (see SlotRef); undefined when `text` is not one of the slots. */
export function parseSlotRef(text: string): SlotRef | undefined {
  const m = /^(\w+)(?:\[\s*([^\]]*?)\s*\])?$/.exec(text.trim());
  if (!m || !(NESTED_SLOTS as readonly string[]).includes(m[1]!)) return undefined;
  const ref: SlotRef = { slot: m[1] as NestedSlot, text: text.trim() };
  const sel = m[2];
  if (sel === undefined) return ref;
  if (/^\d+$/.test(sel)) ref.index = Number(sel);
  else {
    const t = normalizeTrigger(sel);
    if (t && t !== 'none') ref.trigger = t;
    else ref.invalid = sel;
  }
  return ref;
}

/** The event definitions of an event (no lazy collection is created). */
export function definitionsOf(el: El): El[] {
  const defs = ownValue(el, 'eventDefinitions');
  return is(el, 'bpmn:Event') && Array.isArray(defs) ? (defs as El[]) : [];
}

/** `messageEventDefinition MDef` for messages and hints. */
function definitionText(def: El): string {
  const id = def.get<string | undefined>('id');
  return `${typeLabel(def)}${id ? ` ${id}` : ''}`;
}

/** The slots `el` has: definition (events), loop (activities), condition (sequence flows, conditional events). */
export function slotsOf(el: El): NestedSlot[] {
  const out: NestedSlot[] = [];
  if (is(el, 'bpmn:Event')) out.push('definition');
  if (is(el, 'bpmn:Activity')) out.push('loop');
  if (is(el, 'bpmn:SequenceFlow') || definitionsOf(el).some((d) => is(d, 'bpmn:ConditionalEventDefinition'))) out.push('condition');
  return out;
}

/**
 * The nested element a slot names on `el`, or undefined when it does not
 * exist (yet). For an event with several event definitions `definition`
 * is the first one (views use nestedEntries, ops resolveNested); `condition`
 * is the condition of its conditional event definition (only when it has
 * exactly one).
 */
export function nestedElement(el: El, slot: NestedSlot): El | undefined {
  switch (slot) {
    case 'definition':
      return definitionsOf(el)[0];
    case 'loop':
      return is(el, 'bpmn:Activity') ? el.get<El | undefined>('loopCharacteristics') : undefined;
    case 'condition': {
      if (is(el, 'bpmn:SequenceFlow')) return el.get<El | undefined>('conditionExpression');
      const conditional = definitionsOf(el).filter((d) => is(d, 'bpmn:ConditionalEventDefinition'));
      return conditional.length === 1 ? conditional[0]!.get<El | undefined>('condition') : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Every nested element of `el` with the prefix that addresses it: `definition`
 * for the event definition (`definition[<n>]` for each one when an event has
 * several), `loop`, `condition`.
 */
export function nestedEntries(el: El): Array<{ slot: NestedSlot; prefix: string; el: El }> {
  const out: Array<{ slot: NestedSlot; prefix: string; el: El }> = [];
  for (const slot of slotsOf(el)) {
    if (slot === 'definition') {
      const defs = definitionsOf(el);
      defs.forEach((d, i) => out.push({ slot, prefix: defs.length > 1 ? `definition[${i}]` : 'definition', el: d }));
      continue;
    }
    const n = nestedElement(el, slot);
    if (n) out.push({ slot, prefix: slot, el: n });
  }
  return out;
}

/**
 * The nested element a slot reference names, for an operation (set nested
 * keys, ext on a nested element). undefined = the slot exists but is empty
 * (no trigger, no loop, no condition). An event with several event
 * definitions needs a selector (E_AMBIGUOUS_NESTED); a selector that matches
 * nothing is E_NO_NESTED_ELEMENT; a bad selector or one on loop / condition
 * is E_UNKNOWN_KEY. `what` names the key or type in messages; `example`
 * turns a selector prefix into the command a hint shows (default: `set`).
 */
export function resolveNested(el: El, ref: SlotRef, what: string, example?: (prefix: string) => string): El | undefined {
  const id = idOf(el);
  if (ref.slot !== 'definition' && (ref.index !== undefined || ref.trigger || ref.invalid !== undefined)) {
    throw modelError('E_UNKNOWN_KEY', `${what}: only definition. takes a selector ([<n>] or [<trigger>]), not ${ref.slot}.`, { element: id, hint: `Use ${ref.slot}.<key>.` });
  }
  if (ref.invalid !== undefined) {
    throw modelError('E_UNKNOWN_KEY', `${what}: "${ref.invalid}" in ${ref.text} is neither a position nor a trigger`, {
      element: id,
      hint: 'Select an event definition by position (definition[0], definition[1], ...) or by trigger (definition[message], definition[timer], ...).',
    });
  }
  if (ref.slot !== 'definition') return nestedElement(el, ref.slot);
  const defs = definitionsOf(el);
  const listing = defs.map((d, i) => `definition[${i}] = ${definitionText(d)}`).join(', ');
  if (ref.index !== undefined || ref.trigger) {
    const hits = ref.index !== undefined ? (defs[ref.index] ? [defs[ref.index]!] : []) : defs.filter((d) => is(d, TRIGGER_TYPES[ref.trigger!]));
    if (hits.length === 1) return hits[0];
    if (!hits.length) {
      throw modelError('E_NO_NESTED_ELEMENT', `${kindLabel(el)} ${id} has no event definition ${ref.text} (${what})`, {
        element: id,
        hint: defs.length ? `Its event definitions: ${listing}.` : `It has no trigger; give it one first: \`bpmn set <file> ${id} trigger=<trigger>\`.`,
      });
    }
    throw ambiguousNested(el, defs, what, `${hits.length} ${ref.trigger} event definitions`, example);
  }
  if (defs.length > 1) throw ambiguousNested(el, defs, what, `${defs.length} event definitions`, example);
  return defs[0];
}

function ambiguousNested(el: El, defs: El[], what: string, count: string, example?: (prefix: string) => string) {
  const id = idOf(el);
  const listing = defs.map((d, i) => `definition[${i}] = ${definitionText(d)}`).join(', ');
  const triggers = defs.map((d) => (Object.entries(TRIGGER_TYPES) as Array<[string, string]>).find(([, t]) => is(d, t))?.[0]).filter((t): t is string => !!t);
  const unique = triggers.filter((t, i) => triggers.indexOf(t) === i && triggers.lastIndexOf(t) === i);
  const rest = what.replace(/^definition(\[[^\]]*\])?\./, '');
  const show = example ?? ((prefix: string) => `bpmn set <file> ${id} '${prefix}.${rest}=<value>'`);
  return modelError('E_AMBIGUOUS_NESTED', `${kindLabel(el)} ${id} has ${count} (${listing}); ${what} does not say which one`, {
    element: id,
    candidates: defs.map((_, i) => `definition[${i}]`),
    hint: `Name one by position (0-based) or by trigger, e.g. \`${show('definition[1]')}\`${unique.length ? ` or \`${show(`definition[${unique[unique.length - 1]}]`)}\`` : ''} (quote the brackets in a shell). The engines act on only one event definition per event; to keep a single one, set the trigger again: \`bpmn set <file> ${id} trigger=<trigger> ...\`.`,
  });
}

/** Vendor attributes of an element (prefixed, without xmlns / xsi). */
export function vendorAttributes(el: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.$attrs ?? {})) {
    if (!k.includes(':') || k.startsWith('xmlns') || k.startsWith('xsi:') || k.startsWith('xml:') || v === undefined || v === null || typeof v === 'object') continue;
    out[k] = String(v);
  }
  return out;
}

/**
 * The local name when `key` is a camunda attribute (`camunda:assignee` ->
 * `assignee`), else undefined. Operaton's namespace holds the same attributes
 * (`operaton:assignee`): the descriptor's rules apply to it by local name.
 */
function camundaLocal(doc: Doc, key: string): string | undefined {
  const idx = key.indexOf(':');
  if (idx <= 0) return undefined;
  return isC7Uri(doc.namespaceUri(key.slice(0, idx))) ? key.slice(idx + 1) : undefined;
}

/** `key=value` for a hint, single-quoted when the shell would mangle it. */
function shellPair(key: string, value: string): string {
  const pair = `${key}=${value}`;
  return /^[\w.:/,-]*$/.test(value) && /^[\w.:-]*$/.test(key) ? pair : `'${pair.replace(/'/g, "'\\''")}'`;
}

/**
 * Where a camunda attribute that `el` cannot carry belongs instead: a nested
 * slot of `el` (with the trigger an event needs first) or, for a participant,
 * its process. undefined when the descriptor places it nowhere near `el`.
 */
function placeFor(el: El, name: string): { slot?: NestedSlot; prefix?: string; trigger?: Exclude<Trigger, 'none'>; element?: El } | undefined {
  if (is(el, 'bpmn:Event')) {
    const defs = definitionsOf(el);
    const fit = defs.findIndex((d) => attrAppliesTo(name, d));
    if (fit !== -1) return { slot: 'definition', prefix: defs.length > 1 ? `definition[${fit}]` : 'definition' };
    if (slotsOf(el).includes('condition') && attrAppliesTo(name, 'bpmn:FormalExpression')) return { slot: 'condition' };
    const current = triggerOf(el);
    for (const t of kindOf(el)?.triggers ?? []) {
      if (t === 'none' || t === current) continue;
      if (attrAppliesTo(name, TRIGGER_TYPES[t])) return { slot: 'definition', trigger: t };
    }
  }
  if (is(el, 'bpmn:Activity') && attrAppliesTo(name, 'bpmn:MultiInstanceLoopCharacteristics')) return { slot: 'loop' };
  if (is(el, 'bpmn:SequenceFlow') && attrAppliesTo(name, 'bpmn:FormalExpression')) return { slot: 'condition' };
  if (is(el, 'bpmn:Participant')) {
    const process = el.get<El | undefined>('processRef');
    if (process && attrAppliesTo(name, process)) return { element: process };
  }
  return undefined;
}

/**
 * E_WRONG_HOST for a camunda attribute that belongs on a nested element of
 * `el` (or on a participant's process) instead of `el` itself. Attributes the
 * descriptor allows on `el`, unknown ones and other vendors pass.
 */
function assertVendorHost(doc: Doc, el: El, key: string, value: string): void {
  const local = camundaLocal(doc, key);
  if (!local) return;
  const name = `camunda:${local}`;
  if (attrAppliesTo(name, el) !== false) return;
  const place = placeFor(el, name);
  if (!place) return;
  const id = idOf(el);
  if (place.element) {
    throw modelError('E_WRONG_HOST', `${key} is an attribute of the process, not of participant ${id}`, {
      element: id,
      related: [idOf(place.element)],
      hint: `Use \`bpmn set <file> ${idOf(place.element)} ${shellPair(key, value)}\`.`,
    });
  }
  const slot = place.slot!;
  throw modelError('E_WRONG_HOST', `${key} does not belong on ${kindLabel(el)} ${id}: it is an attribute of its ${SLOT_TEXT[slot]}${place.trigger ? ` (${TRIGGER_TYPES[place.trigger].replace('bpmn:', '')})` : ''}`, {
    element: id,
    hint: `Use \`bpmn set <file> ${id} ${place.trigger ? `trigger=${place.trigger} ` : ''}${shellPair(`${place.prefix ?? slot}.${key}`, value)}\`${place.trigger ? ` (${id} needs a ${place.trigger} trigger for it)` : ''}.`,
  });
}

/**
 * E_WRONG_HOST for a zeebe attribute that is not an attribute of BPMN
 * elements but of a zeebe extension element (zeebe:assignee is an attribute
 * of zeebe:assignmentDefinition, zeebe:type of zeebe:taskDefinition): Camunda
 * 8 settings are extension elements, so the hint names the `ext add` that
 * writes it (by the Zeebe descriptor). The attributes the descriptor puts on
 * BPMN elements (zeebe:modelerTemplate) and unknown names pass.
 */
function assertZeebeHost(doc: Doc, el: El, key: string, value: string): void {
  const idx = key.indexOf(':');
  if (idx <= 0 || doc.namespaceUri(key.slice(0, idx)) !== ZEEBE_URI) return;
  const local = key.slice(idx + 1);
  if (zeebeAttr(local)) return;
  const prefix = key.slice(0, idx);
  const id = idOf(el);
  const pair = shellPair(local, value);
  const owners = zeebeTypeNames().filter((t) => zeebeType(t)!.attributes.some((a) => a.name === local));
  const here = owners.filter((t) => zeebeAllowedOn(t, el) === true);
  const loop = is(el, 'bpmn:Activity') && owners.includes('zeebe:loopCharacteristics');
  const message = owners.includes('zeebe:subscription') && (is(el, 'bpmn:ReceiveTask') || is(el, 'bpmn:Event'));
  if (!here.length && !loop && !message) return;
  const target = here[0] ?? (loop ? 'zeebe:loopCharacteristics' : 'zeebe:subscription');
  const type = `${prefix}:${target.slice('zeebe:'.length)}`;
  const msg = message ? (el.get<El | undefined>('messageRef') ?? definitionsOf(el)[0]?.get<El | undefined>('messageRef')) : undefined;
  const msgId = msg ? idOf(msg) : undefined;
  const command = here.length
    ? `\`bpmn ext add <file> ${id} ${type} ${pair}\``
    : loop
      ? `\`bpmn ext add <file> ${id} loop.${type} ${pair}\` (creates a parallel multi-instance loop when there is none)`
      : `\`bpmn ext add <file> ${msgId || '<messageId>'} ${type} ${pair}\` (on the message the event waits for)`;
  throw modelError('E_WRONG_HOST', `${key} is not an attribute of ${kindLabel(el)} ${id}: Camunda 8 reads ${local} on the ${type} extension element`, {
    element: id,
    hint: `Use ${command}.`,
  });
}

/** Keys of a nested element that have their own set key (or are generated). */
const NESTED_BLOCKED: Record<string, string> = {
  body: 'use condition= / when= / timer= / cardinality= / completion=',
};

/** The BPMN types a slot can name (for the key table of `bpmn kinds --json`). */
export const NESTED_TYPES: Record<NestedSlot, readonly string[]> = {
  definition: [
    'bpmn:MessageEventDefinition',
    'bpmn:TimerEventDefinition',
    'bpmn:ErrorEventDefinition',
    'bpmn:SignalEventDefinition',
    'bpmn:EscalationEventDefinition',
    'bpmn:ConditionalEventDefinition',
    'bpmn:LinkEventDefinition',
    'bpmn:CompensateEventDefinition',
    'bpmn:TerminateEventDefinition',
    'bpmn:CancelEventDefinition',
  ],
  loop: ['bpmn:MultiInstanceLoopCharacteristics', 'bpmn:StandardLoopCharacteristics'],
  condition: ['bpmn:FormalExpression'],
};

/**
 * The `<slot>.<key>` keys a nested element of this type accepts: id, its
 * settable BPMN attributes and the camunda attributes the Camunda descriptor
 * places on it (other vendors' attributes are accepted too, unchecked).
 */
export function nestedKeysOf(doc: Doc, slot: NestedSlot, target: El): string[] {
  const keys = ['id', ...genericKeys(doc, target).filter((k) => !NESTED_BLOCKED[k]), ...camundaAttrsFor(target).map((a) => a.name)];
  return [...new Set(keys)].map((k) => `${slot}.${k}`);
}

/** Creates the nested element a non-empty `<slot>.<key>` needs, or explains why it cannot. */
function createNested(doc: Doc, el: El, slot: NestedSlot, key: string, cs: ChangeSet): El {
  const id = idOf(el);
  const local = camundaLocal(doc, key);
  if (slot === 'loop') {
    const multi = doc.moddle.create('bpmn:MultiInstanceLoopCharacteristics');
    checkNestedKey(doc, el, slot, multi, key);
    multi.$parent = el;
    el.set('loopCharacteristics', multi);
    cs.note(`${id}: created a parallel multi-instance loop for loop.${key}`);
    return multi;
  }
  if (slot === 'condition' && is(el, 'bpmn:SequenceFlow') && local === 'resource') {
    const expr = doc.moddle.create('bpmn:FormalExpression');
    expr.$parent = el;
    el.set('conditionExpression', expr);
    const source = el.get<El | undefined>('sourceRef');
    if (source?.get<El | undefined>('default') === el) {
      source.set('default', undefined);
      cs.change(changeOf(el, `no longer the default flow of ${idOf(source)}`));
    }
    return expr;
  }
  if (slot === 'definition') {
    const name = local ? `camunda:${local}` : undefined;
    const trigger = name ? (kindOf(el)?.triggers ?? []).find((t) => t !== 'none' && attrAppliesTo(name, TRIGGER_TYPES[t])) : undefined;
    throw modelError('E_NO_NESTED_ELEMENT', `${kindLabel(el)} ${id} has no event definition to set ${slot}.${key} on (it has no trigger)`, {
      element: id,
      hint: `Give it a trigger first: \`bpmn set <file> ${id} trigger=${trigger ?? '<trigger>'}\` (or in the same command, e.g. trigger=${trigger ?? 'message'} ${slot}.${key}=<value>).`,
    });
  }
  throw modelError('E_NO_NESTED_ELEMENT', `${kindLabel(el)} ${id} has no condition to set ${slot}.${key} on`, {
    element: id,
    hint: is(el, 'bpmn:SequenceFlow')
      ? `Set the condition first (\`bpmn set <file> ${id} condition=<expression>\`), or make it a script resource condition with condition.camunda:resource=<uri> language=<lang>.`
      : `Set the condition first: \`bpmn set <file> ${id} when=<expression>\`.`,
  });
}

/** Refuses a key the nested element cannot carry (E_WRONG_HOST for known camunda attributes, E_UNKNOWN_KEY otherwise). */
function checkNestedKey(doc: Doc, el: El, slot: NestedSlot, target: El, key: string, prefix: string = slot): void {
  const id = idOf(el);
  const full = `${prefix}.${key}`;
  const zi = key.indexOf(':');
  if (zi > 0 && doc.namespaceUri(key.slice(0, zi)) === ZEEBE_URI && !zeebeAttr(key.slice(zi + 1))) {
    // a zeebe setting of a nested element is an extension element of it (loop.zeebe:loopCharacteristics)
    const local = key.slice(zi + 1);
    const owner = zeebeTypeNames().find((t) => zeebeAllowedOn(t, target) === true && zeebeType(t)!.attributes.some((a) => a.name === local));
    if (owner) {
      throw modelError('E_WRONG_HOST', `${key} is not an attribute of the ${typeLabel(target)} of ${kindLabel(el)} ${id}: Camunda 8 reads ${local} on its ${owner} extension element`, {
        element: id,
        hint: `Use \`bpmn ext add <file> ${id} ${prefix}.${key.slice(0, zi)}:${owner.slice('zeebe:'.length)} ${local}=<value>\`.`,
      });
    }
  }
  if (key.includes(':')) {
    const local = camundaLocal(doc, key);
    if (!local || attrAppliesTo(`camunda:${local}`, target) !== false) return;
    const owners = camundaAttr(local)?.owners ?? [];
    const onElement = attrAppliesTo(`camunda:${local}`, el);
    const multi = slot === 'loop' && owners.some((o) => typeIs('bpmn:MultiInstanceLoopCharacteristics', o));
    throw modelError('E_WRONG_HOST', `${key} cannot be set on the ${typeLabel(target)} of ${kindLabel(el)} ${id}${multi ? ': it needs a multi-instance loop' : ''}`, {
      element: id,
      hint: multi
        ? `Set loop=parallel or loop=sequential first (\`bpmn set <file> ${id} loop=parallel ${full}=<value>\`).`
        : onElement
          ? `It is an attribute of ${id} itself: \`bpmn set <file> ${id} ${key}=<value>\`.`
          : `${key} belongs on ${owners.map((o) => o.replace('bpmn:', '')).join(', ')}.`,
    });
  }
  if (key === 'id') return;
  const p = descriptorOf(target).propertiesByName?.[key];
  const blocked = NESTED_BLOCKED[key];
  if (!p || blocked || !isSettableProp(doc, p)) {
    const keys = ['id', ...genericKeys(doc, target).filter((k) => !NESTED_BLOCKED[k])].map((k) => `${prefix}.${k}`);
    throw modelError('E_UNKNOWN_KEY', `Unknown key "${full}" for ${kindLabel(el)} ${id}: a ${typeLabel(target)} has no settable attribute ${key}${blocked ? ` (${blocked})` : ''}`, {
      element: id,
      candidates: keys,
      hint: `Keys of the ${SLOT_TEXT[slot]}: ${keys.join(', ')}, or a vendor attribute ${prefix}.<prefix>:<attr>.`,
    });
  }
}

/** A script resource replaces an inline body: the body goes, reported as W_PROPERTY_DROPPED. */
function dropConditionBody(el: El, expr: El, cs: ChangeSet, key = 'camunda:resource'): void {
  const body = expr.get<string | undefined>('body');
  if (!body) return;
  expr.set('body', undefined);
  cs.warn({
    code: 'W_PROPERTY_DROPPED',
    message: `The condition "${body}" of ${idOf(el)} was dropped: a script resource condition has no inline body`,
    element: idOf(el),
    hint: `To go back to an inline condition remove the resource and set the body in one command: \`bpmn set <file> ${idOf(el)} condition.${key}= '${is(el, 'bpmn:SequenceFlow') ? 'condition' : 'when'}=<expression>'\`.`,
  });
}

/**
 * Removing the script resource of a condition that has no inline body would
 * leave an empty condition: the engines deploy it, and every evaluation fails
 * ("condition script returns null" / "condition expression returns
 * non-Boolean"). Refused unless the same command gives the inline condition
 * (`condition=` on a flow, which may also remove it; `when=` on an event).
 */
function assertConditionKept(doc: Doc, el: El, target: El, key: string, full: string): void {
  if (!isResourceKey(doc, key) || resourceKeyOf(doc, target) !== key) return;
  if (target.get<string | undefined>('body')?.trim()) return;
  const id = idOf(el);
  const flow = is(el, 'bpmn:SequenceFlow');
  throw invalidValue(
    el,
    full,
    `removing the script resource ${String(target.$attrs[key])} would leave ${flow ? 'the condition' : 'the condition of the conditional event'} empty (it has no inline body); the engines would fail every evaluation of an empty condition`,
    flow
      ? `Replace it with an inline condition in the same command: \`bpmn set <file> ${id} ${full}= 'condition=\${...}'\`, or remove the whole condition: \`bpmn set <file> ${id} condition=\`.`
      : `Replace it with an inline condition in the same command: \`bpmn set <file> ${id} ${full}= 'when=\${...}'\` (a conditional event always needs a condition), or point it at another script: \`bpmn set <file> ${id} ${full}=<uri>\`.`,
  );
}

/**
 * Applies one `<slot>.<key>=<value>` (see the module contract). `replacing`:
 * the same command sets the flow's inline condition (condition=), so a
 * removed script resource leaves nothing empty behind.
 */
function applyNestedKey(doc: Doc, el: El, slot: string, key: string, value: string, cs: ChangeSet, replacing = false): void {
  const full = `${slot}.${key}`;
  if (key.includes(':')) value = vendorValue(doc, el, key, value, full);
  const slots = slotsOf(el);
  const ref = parseSlotRef(slot);
  if (!ref || !slots.includes(ref.slot) || !key) {
    throw unknownKey(doc, el, full, slots.length ? `nested keys of a ${kindLabel(el)} start with ${slots.map((s) => `${s}.`).join(' or ')}` : `a ${kindLabel(el)} has no nested element to address`);
  }
  const s = ref.slot;
  let target = resolveNested(el, ref, full);
  if (!target) {
    if (!value) return; // nothing to remove
    target = createNested(doc, el, s, key, cs);
  }
  if (value) checkNestedKey(doc, el, s, target, key, ref.text);
  if (s === 'condition' && value && isResourceKey(doc, key)) dropConditionBody(el, target, cs, key);
  if (s === 'condition' && !value && !replacing) assertConditionKept(doc, el, target, key, full);
  if (key.includes(':')) {
    setVendorAttribute(doc, target, key, value);
  } else if (key === 'id') {
    if (!value) throw invalidValue(el, full, 'an id cannot be empty');
    if (idOf(target)) renameId(doc, target, value);
    else {
      doc.claimId(value);
      target.set('id', value);
    }
  } else if (!removeUndefinedAttr(target, key, value)) {
    checkNestedKey(doc, el, s, target, key, ref.text);
    const p = descriptorOf(target).propertiesByName![key]!;
    const coerced = value ? coerceValue(doc, el, p, value, full) : undefined;
    if (is(target, 'bpmn:CompensateEventDefinition') && key === 'activityRef' && isEl(coerced)) assertCompensationInScope(doc, el, coerced, full);
    target.set(key, coerced);
  }
  cs.change(changeOf(el, value ? `${full}=${value}` : `${full} removed`));
}

/**
 * The activity a compensation throw event names (activityRef) must be an
 * activity of the event's own scope (directly, not inside a sub-process of
 * it); a throw event in an event sub-process may also name an activity of the
 * scope around the event sub-process. Camunda 7, CIB seven and Operaton refuse
 * anything else ("no activity with id ... in scope"); BPMN 2.0 says the same
 * (the activity is compensated from within its scope).
 */
function assertCompensationInScope(doc: Doc, event: El, activity: El, full: string): void {
  if (!is(activity, 'bpmn:Activity')) return;
  const scope = doc.scopeOf(event);
  if (!scope) return;
  const scopes = [scope];
  if (is(scope, 'bpmn:SubProcess') && scope.get<boolean | undefined>('triggeredByEvent')) {
    const outer = doc.scopeOf(scope);
    if (outer) scopes.push(outer);
  }
  const actual = doc.scopeOf(activity);
  if (actual && scopes.includes(actual)) return;
  const candidates = scopes.flatMap((sc) => many(sc, 'flowElements').filter((e) => is(e, 'bpmn:Activity') && !(is(e, 'bpmn:SubProcess') && e.get<boolean | undefined>('triggeredByEvent'))).map(idOf));
  const id = idOf(event);
  throw modelError('E_CROSS_SCOPE', `${full}=${idOf(activity)}: ${idOf(activity)} is in ${actual ? idOf(actual) : '?'}, not in the scope of ${id} (${scopes.map(idOf).join(' / ')}); a compensation event can only compensate activities of its own scope`, {
    element: id,
    related: [idOf(activity)],
    candidates,
    hint: `Name an activity of ${scopes.map(idOf).join(' or ')}: ${candidates.join(', ') || 'none'}. To compensate ${idOf(activity)}, throw the compensation inside ${actual ? idOf(actual) : 'its scope'} (e.g. an event sub-process or an intermediate throw event there). The engines refuse the file otherwise.`,
  });
}

/* ------------------------------------------------------------------ */
/* events                                                               */
/* ------------------------------------------------------------------ */

/** The trigger of an event plus its details, as `set`/`add` options (read from the model). */
export function currentTrigger(el: El): { trigger: Trigger; opts: TriggerOptions } {
  const trigger = triggerOf(el) ?? 'none';
  const opts: TriggerOptions = {};
  const def = (el.get<El[] | undefined>('eventDefinitions') ?? [])[0];
  const body = (p: string): string | undefined => def?.get<El | undefined>(p)?.get<string | undefined>('body');
  const ref = (p: string): El | undefined => def?.get<El | undefined>(p);
  const named = (p: string): string | undefined => ref(p)?.get<string | undefined>('name') ?? ref(p)?.get<string | undefined>('id');
  if (def) {
    switch (trigger) {
      case 'timer': {
        const cycle = body('timeCycle');
        const duration = body('timeDuration');
        const date = body('timeDate');
        if (cycle) Object.assign(opts, { timer: cycle, timerKind: 'cycle' });
        else if (duration) Object.assign(opts, { timer: duration, timerKind: 'duration' });
        else if (date) Object.assign(opts, { timer: date, timerKind: 'date' });
        break;
      }
      case 'message':
        opts.message = named('messageRef');
        break;
      case 'error':
        opts.error = named('errorRef');
        opts.errorCode = ref('errorRef')?.get<string | undefined>('errorCode');
        break;
      case 'signal':
        opts.signal = named('signalRef');
        break;
      case 'escalation':
        opts.escalation = named('escalationRef');
        opts.escalationCode = ref('escalationRef')?.get<string | undefined>('escalationCode');
        break;
      case 'conditional':
        opts.when = body('condition');
        break;
      case 'link':
        opts.link = def.get<string | undefined>('name');
        break;
      default:
        break;
    }
  }
  if (is(el, 'bpmn:BoundaryEvent') && el.get<boolean | undefined>('cancelActivity') === false) opts.nonInterrupting = true;
  if (is(el, 'bpmn:StartEvent') && el.get<boolean | undefined>('isInterrupting') === false) opts.nonInterrupting = true;
  for (const k of Object.keys(opts) as Array<keyof TriggerOptions>) if (opts[k] === undefined) delete opts[k];
  return { trigger, opts };
}

const ALWAYS_INTERRUPTING: Trigger[] = ['error', 'cancel', 'compensate'];

/**
 * True when an event with this trigger can never be non-interrupting:
 * error/cancel/compensate boundary events, error/compensate and untyped
 * start events, and every event that is neither a boundary nor a start event.
 */
export function interruptingOnly(el: El, trigger: Trigger): boolean {
  if (is(el, 'bpmn:BoundaryEvent')) return ALWAYS_INTERRUPTING.includes(trigger);
  if (is(el, 'bpmn:StartEvent')) return ALWAYS_INTERRUPTING.includes(trigger) || trigger === 'none';
  return true;
}

/** W_PROPERTY_DROPPED for a non-interrupting flag that a trigger change had to clear. */
export function warnNonInterruptingDropped(cs: ChangeSet, el: El, trigger: Trigger): void {
  const position = is(el, 'bpmn:BoundaryEvent') ? 'boundary' : 'start';
  cs.warn({
    code: 'W_PROPERTY_DROPPED',
    message: `nonInterrupting of ${idOf(el)} was dropped: ${trigger === 'none' ? 'untyped' : trigger} ${position} events are always interrupting`,
    element: idOf(el),
    hint: `${idOf(el)} now interrupts${position === 'boundary' ? ' its host activity' : ' the enclosing process'}; pick a message, timer, signal, escalation or conditional trigger to keep it non-interrupting.`,
  });
}

/** Throws unless `el` may be non-interrupting with the given trigger. */
function assertNonInterruptingAllowed(doc: Doc, el: El, trigger: Trigger): void {
  if (is(el, 'bpmn:BoundaryEvent')) {
    if (ALWAYS_INTERRUPTING.includes(trigger)) {
      throw modelError('E_INVALID_TRIGGER', `${trigger} boundary events are always interrupting (${idOf(el)})`, {
        element: idOf(el),
        hint: 'Only message, timer, signal, escalation and conditional boundary events can be non-interrupting.',
      });
    }
    return;
  }
  if (is(el, 'bpmn:StartEvent')) {
    const scope = doc.scopeOf(el);
    if (!scope || !is(scope, 'bpmn:SubProcess') || !scope.get<boolean | undefined>('triggeredByEvent')) {
      throw modelError('E_INVALID_TRIGGER', `Start event ${idOf(el)} is not inside an event sub-process and cannot be non-interrupting`, {
        element: idOf(el),
        hint: 'Only start events of an eventSubProcess can be non-interrupting.',
      });
    }
    if (interruptingOnly(el, trigger)) {
      throw modelError('E_INVALID_TRIGGER', `A${trigger === 'none' ? 'n untyped' : ` ${trigger}`} start event cannot be non-interrupting (${idOf(el)})`, {
        element: idOf(el),
        hint: 'Only message, timer, signal, escalation and conditional start events can be non-interrupting.',
      });
    }
    return;
  }
  throw invalidValue(el, 'nonInterrupting', 'only boundary events and start events of event sub-processes can be non-interrupting');
}

function setNonInterrupting(doc: Doc, el: El, value: boolean): void {
  if (value) assertNonInterruptingAllowed(doc, el, triggerOf(el) ?? 'none');
  if (is(el, 'bpmn:BoundaryEvent')) el.set('cancelActivity', !value);
  else if (is(el, 'bpmn:StartEvent')) el.set('isInterrupting', !value);
  else assertNonInterruptingAllowed(doc, el, 'none');
}

/**
 * Message flows touching `event` that its current kind/trigger cannot serve
 * (the rules `connect` applies when creating one): only untyped or message
 * events take part, throw events send, catch events receive.
 */
export function messageFlowConflicts(doc: Doc, event: El): Array<{ flow: El; why: string }> {
  if (!is(event, 'bpmn:Event')) return [];
  const trigger = triggerOf(event) ?? 'none';
  const out: Array<{ flow: El; why: string }> = [];
  for (const flow of doc.messageFlows()) {
    const sends = flow.get<El | undefined>('sourceRef') === event;
    const receives = flow.get<El | undefined>('targetRef') === event;
    if (!sends && !receives) continue;
    let why: string | undefined;
    if (trigger !== 'none' && trigger !== 'message') why = `a ${trigger} event cannot ${sends ? 'send' : 'receive'} messages`;
    else if (sends && !is(event, 'bpmn:ThrowEvent')) why = 'catching events cannot send messages';
    else if (receives && !is(event, 'bpmn:CatchEvent')) why = 'throwing events cannot receive messages';
    if (why) out.push({ flow, why });
  }
  return out;
}

/**
 * After a kind/trigger change: throws E_INVALID_TRIGGER when a message flow
 * that fitted `event` before (`before` = conflicting flow ids beforehand) no
 * longer does, so the model never ends up with a message flow `connect` would refuse.
 */
export function assertMessageFlowsFit(doc: Doc, event: El, before: Set<string>): void {
  const broken = messageFlowConflicts(doc, event).filter((c) => !before.has(idOf(c.flow)));
  const first = broken[0];
  if (!first) return;
  const src = first.flow.get<El | undefined>('sourceRef');
  const tgt = first.flow.get<El | undefined>('targetRef');
  throw modelError(
    'E_INVALID_TRIGGER',
    `${kindLabel(event)} ${idOf(event)} would break message flow ${idOf(first.flow)} (${src ? idOf(src) : '?'} -> ${tgt ? idOf(tgt) : '?'}): ${first.why}`,
    {
      element: idOf(event),
      related: broken.map((c) => idOf(c.flow)),
      hint: `Remove the message flow first (\`bpmn remove ${broken.map((c) => idOf(c.flow)).join(' ')}\`) or keep a message / untyped event.`,
    },
  );
}

function applyEventKeys(doc: Doc, el: El, keys: Map<string, string>, cs: ChangeSet): void {
  const def = kindOf(el);
  const allowed = def?.triggers ?? [];
  const current = currentTrigger(el);
  let requested: Trigger | undefined;
  if (keys.has('trigger')) {
    const raw = keys.get('trigger') ?? '';
    requested = raw ? normalizeTrigger(raw) : 'none';
    if (!requested) throw invalidValue(el, 'trigger', `unknown trigger "${raw}"`, `Allowed on ${def?.kind ?? kindLabel(el)}: ${allowed.join(', ')}.`);
  }
  const given: Record<string, unknown> = {};
  let nonInterrupting: boolean | undefined;
  for (const [key, value] of keys) {
    if (key === 'trigger') continue;
    if (key === 'nonInterrupting') {
      nonInterrupting = value ? parseBool(el, key, value) : false;
      continue;
    }
    const implied = TRIGGER_OF_KEY[key]!;
    if (requested === undefined) requested = implied;
    else if (requested !== implied) throw invalidValue(el, key, `${key} belongs to the ${implied} trigger, not ${requested}`);
    if (!value && key !== 'errorCode' && key !== 'escalationCode') {
      throw invalidValue(el, key, `${key} needs a value`, 'Use trigger=none to remove the trigger.');
    }
    given[key] = value || undefined;
  }
  const trigger = requested ?? current.trigger;
  if (nonInterrupting !== undefined && requested === undefined && !Object.keys(given).length) {
    setNonInterrupting(doc, el, nonInterrupting);
    cs.change(changeOf(el, `nonInterrupting=${nonInterrupting}`));
    return;
  }
  if (!allowed.includes(trigger)) {
    throw modelError('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def?.kind ?? kindLabel(el)} ${idOf(el)}`, {
      element: idOf(el),
      hint: `Allowed triggers: ${allowed.join(', ') || 'none'}.`,
    });
  }
  const merged: TriggerOptions = trigger === current.trigger ? { ...current.opts, ...given } : { ...given };
  // a new timer value is classified again (R... cycle, P... duration, else date)
  if (given['timer'] !== undefined) delete merged.timerKind;
  // the existing non-interrupting flag follows the event unless the new trigger cannot have it
  let dropNonInterrupting = false;
  if (nonInterrupting !== undefined) merged.nonInterrupting = nonInterrupting;
  else if (current.opts.nonInterrupting && interruptingOnly(el, trigger)) {
    merged.nonInterrupting = false;
    dropNonInterrupting = true;
  } else if (current.opts.nonInterrupting) merged.nonInterrupting = true;
  else delete merged.nonInterrupting;
  if (merged.nonInterrupting) assertNonInterruptingAllowed(doc, el, trigger);
  const conflictsBefore = new Set(messageFlowConflicts(doc, el).map((c) => idOf(c.flow)));
  for (const w of applyTrigger(doc, el, trigger, merged)) cs.warn(w);
  assertMessageFlowsFit(doc, el, conflictsBefore);
  if (dropNonInterrupting) warnNonInterruptingDropped(cs, el, trigger);
  const details = Object.entries(given)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  cs.change(changeOf(el, [`trigger=${trigger}`, ...details, ...(nonInterrupting !== undefined ? [`nonInterrupting=${nonInterrupting}`] : [])].join(' ')));
}

/* ------------------------------------------------------------------ */
/* rename                                                               */
/* ------------------------------------------------------------------ */

/** Renames an element id, re-pointing every reference (incl. string refs like calledElement). */
export function renameId(doc: Doc, el: El, newId: string): void {
  const old = idOf(el);
  if (old === newId) return;
  doc.claimId(newId);
  el.set('id', newId);
  if (old) doc.ids.release(old);
  // id-valued attributes of vendor extension elements are plain strings in the model
  const vendorRefs = idReferenceAttrs().filter((r) => is(el, r.target));
  for (const e of walk(doc.definitions)) {
    if (is(e, 'bpmn:CallActivity') && e.get<string | undefined>('calledElement') === old) e.set('calledElement', newId);
    if (!descriptorOf(e).isGeneric) continue;
    const any = e as unknown as Record<string, unknown>;
    if (e.$type === 'zeebe:calledElement' && any['processId'] === old) any['processId'] = newId;
    if (!vendorRefs.length) continue;
    const [prefix, local] = e.$type.split(':');
    if (!prefix || !local || !isC7Uri(doc.namespaceUri(prefix))) continue;
    for (const ref of vendorRefs) {
      if (ref.element !== `camunda:${local}`) continue;
      if (any[ref.attr] === old) any[ref.attr] = newId;
      if (e.$attrs?.[ref.attr] === old) e.$attrs[ref.attr] = newId;
    }
  }
  doc.invalidate();
}

/* ------------------------------------------------------------------ */
/* read                                                                 */
/* ------------------------------------------------------------------ */

/** Structured, settable view of an element's properties (used by `show <id>`). */
export function readProperties(doc: Doc, el: El): Record<string, unknown> {
  const out: Record<string, unknown> = { id: idOf(el) };
  const name = el.get<string | undefined>('name');
  if (name) out['name'] = name;
  const docs = (ownValue(el, 'documentation') as El[] | undefined) ?? [];
  const text = docs
    .map((d) => d.get<string | undefined>('text'))
    .filter(Boolean)
    .join('\n');
  if (text) out['doc'] = text;
  for (const p of descriptorOf(el).properties ?? []) {
    if (p.name === 'id' || p.name === 'name' || p.name === 'default' || !isSettableProp(doc, p)) continue;
    const v = ownValue(el, p.name);
    if (v === undefined || v === null || v === '') continue;
    out[p.name] = p.isReference && isEl(v) ? idOf(v) : v;
  }
  for (const [k, v] of Object.entries(el.$attrs ?? {})) {
    if (k.startsWith('xmlns') || typeof v === 'object') continue;
    out[k] = v;
  }
  if (is(el, 'bpmn:SequenceFlow')) {
    const cond = el.get<El | undefined>('conditionExpression');
    const body = cond?.get<string | undefined>('body');
    if (body) out['condition'] = body;
    const language = cond?.get<string | undefined>('language');
    if (language) out['language'] = language;
    const src = el.get<El | undefined>('sourceRef');
    const tgt = el.get<El | undefined>('targetRef');
    if (src) out['source'] = idOf(src);
    if (tgt) out['target'] = idOf(tgt);
    if (src?.get<El | undefined>('default') === el) out['default'] = true;
  } else {
    const def = ownValue(el, 'default');
    if (isEl(def)) out['default'] = idOf(def);
  }
  if (is(el, 'bpmn:Event')) {
    const { trigger, opts } = currentTrigger(el);
    out['trigger'] = trigger;
    const { timerKind: _ignored, ...rest } = opts;
    Object.assign(out, rest);
  }
  if (is(el, 'bpmn:Activity')) {
    const loop = el.get<El | undefined>('loopCharacteristics');
    if (is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
      out['loop'] = loop!.get<boolean | undefined>('isSequential') ? 'sequential' : 'parallel';
      const card = loop!.get<El | undefined>('loopCardinality')?.get<string | undefined>('body');
      const done = loop!.get<El | undefined>('completionCondition')?.get<string | undefined>('body');
      if (card) out['cardinality'] = card;
      if (done) out['completion'] = done;
    } else if (is(loop, 'bpmn:StandardLoopCharacteristics')) {
      out['loop'] = 'standard';
    }
  }
  if (is(el, 'bpmn:SubProcess')) {
    const requested = expansionRequests.get(doc)?.get(idOf(el));
    out['expanded'] = requested ?? diExpansionState(doc.definitions).get(idOf(el)) ?? true;
  }
  if (is(el, 'bpmn:FlowNode')) {
    const lanes = doc.lanesOf(el);
    const lane = lanes[lanes.length - 1];
    if (lane) out['lane'] = idOf(lane);
  }
  if (is(el, 'bpmn:SendTask') || is(el, 'bpmn:ReceiveTask')) {
    const message = ownValue(el, 'messageRef');
    if (isEl(message)) out['message'] = message.get<string | undefined>('name') ?? idOf(message);
  }
  for (const { prefix, el: nestedEl } of nestedEntries(el)) {
    // an event with several event definitions: each under its position (definition[1]: timerEventDefinition)
    if (prefix.includes('[')) out[prefix] = typeLabel(nestedEl);
    const nestedId = nestedEl.get<string | undefined>('id');
    if (nestedId) out[`${prefix}.id`] = nestedId;
    for (const [k, v] of Object.entries(vendorAttributes(nestedEl))) out[`${prefix}.${k}`] = v;
  }
  return out;
}
