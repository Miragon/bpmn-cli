/**
 * Event definitions (triggers): timer / message / error / signal / escalation /
 * conditional / link / compensate / terminate / cancel.
 *
 *  - applyTrigger(): sets the event's trigger. When the event already has
 *    exactly one definition of that trigger, it is updated in place (other
 *    event definitions of an event that has several are dropped, reported as
 *    W_PROPERTY_DROPPED): only the
 *    details that differ (message, error, signal, escalation, condition, timer,
 *    link) change, so its id, vendor attributes (camunda:topic ...), extension
 *    elements and expression elements survive. A new inline condition (when=)
 *    replacing a script resource drops camunda:resource and its language, and
 *    a `${...}` condition drops a script language (W_PROPERTY_DROPPED). Otherwise (a trigger KIND
 *    change, 'none') the eventDefinitions are replaced by the one for
 *    `trigger` ('none' removes them) and vendor content of the replaced
 *    definitions is returned as W_PROPERTY_DROPPED warnings. Root
 *    bpmn:Message / bpmn:Error /
 *    bpmn:Signal / bpmn:Escalation elements by name when missing (ids:
 *    Message_<Slug>, Error_<Slug>, Signal_<Slug>, Escalation_<Slug>; errorCode /
 *    escalationCode from opts). Timer strings are classified: starts with "R"
 *    -> timeCycle, starts with "P" -> timeDuration, else timeDate (override
 *    with opts.timerKind). `nonInterrupting` sets cancelActivity=false on
 *    boundary events and isInterrupting=false on start events (rejected for
 *    error/cancel/compensate boundary events: E_INVALID_TRIGGER).
 *  - describeTrigger(): short human text of the trigger details, e.g.
 *    "PT2D", "message OrderReceived", "error PaymentFailed (PAY-001)", "" when none.
 *  - triggerDetails(): the same as structured data for --json views.
 */
import type { Doc } from '../document.js';
import { modelError, type Warning } from '../errors.js';
import { kindOf, triggerOf, TRIGGER_TYPES, type Trigger } from '../kinds.js';
import { addTo, is, many, walk, type El } from '../model.js';
import { isC7Uri } from '../platform/descriptor.js';
import type { TriggerOptions } from './types.js';

export interface TriggerDetails {
  trigger: Trigger;
  timer?: { kind: 'cycle' | 'duration' | 'date'; value: string };
  message?: { id: string; name?: string };
  error?: { id: string; name?: string; code?: string };
  signal?: { id: string; name?: string };
  escalation?: { id: string; name?: string; code?: string };
  condition?: string;
  link?: string;
  nonInterrupting?: boolean;
}

/** Root element types a trigger may reference, with their id prefix. */
export type RootRefType = 'bpmn:Message' | 'bpmn:Error' | 'bpmn:Signal' | 'bpmn:Escalation';

const ROOT_PREFIX: Record<RootRefType, string> = {
  'bpmn:Message': 'Message',
  'bpmn:Error': 'Error',
  'bpmn:Signal': 'Signal',
  'bpmn:Escalation': 'Escalation',
};

/** Triggers that must interrupt (never non-interrupting). */
const INTERRUPTING_ONLY: Trigger[] = ['error', 'cancel', 'compensate'];
/** Start event triggers that are only valid inside an event sub-process. */
const EVENT_SUBPROCESS_ONLY: Trigger[] = ['error', 'escalation', 'compensate'];

function idOf(el: El): string {
  return el.get<string>('id');
}

/* ------------------------------------------------------------------ */
/* root elements (Message / Error / Signal / Escalation)                */
/* ------------------------------------------------------------------ */

/**
 * Finds a root Message/Error/Signal/Escalation by id or name, creating it
 * (id `<Prefix>_<Slug>`) when missing. `extra` (errorCode / escalationCode)
 * is applied to found elements too. Returns whether it was created.
 */
export function ensureRootElement(doc: Doc, type: RootRefType, nameOrId: string, extra: Record<string, string | undefined> = {}): { el: El; created: boolean } {
  const key = nameOrId.trim();
  if (!key) {
    throw modelError('E_INVALID_VALUE', `The ${ROOT_PREFIX[type].toLowerCase()} name is empty`, { hint: 'Pass a name, e.g. --message OrderReceived.' });
  }
  const existing = doc.rootElementsOfType(type);
  let el = existing.find((e) => idOf(e) === key) ?? existing.find((e) => e.get<string | undefined>('name') === key);
  let created = false;
  if (!el) {
    el = doc.create(type, { id: doc.newId(ROOT_PREFIX[type], key), name: key });
    addTo(doc.definitions, 'rootElements', el);
    created = true;
  }
  for (const [prop, value] of Object.entries(extra)) {
    if (value !== undefined) el.set(prop, value || undefined);
  }
  doc.invalidate();
  return { el, created };
}

/* ------------------------------------------------------------------ */
/* timers                                                               */
/* ------------------------------------------------------------------ */

const TIMER_KINDS = ['cycle', 'duration', 'date'] as const;
type TimerKind = (typeof TIMER_KINDS)[number];

/** Classifies an ISO 8601 timer string: R... -> cycle, P... -> duration, else date (an unknown override is E_INVALID_VALUE). */
export function classifyTimer(value: string, override?: string): TimerKind {
  if (override !== undefined) {
    if (!(TIMER_KINDS as ReadonlyArray<string>).includes(override)) {
      throw modelError('E_INVALID_VALUE', `Unknown timer kind "${override}"; use one of ${TIMER_KINDS.join(', ')}`, {
        candidates: [...TIMER_KINDS],
        hint: 'Drop --timer-kind to classify from the value (R... -> cycle, P... -> duration, else date).',
      });
    }
    return override as TimerKind;
  }
  const v = value.trim();
  if (/^R/i.test(v)) return 'cycle';
  if (/^P/i.test(v)) return 'duration';
  return 'date';
}

const TIMER_PROPS: Record<'cycle' | 'duration' | 'date', string> = {
  cycle: 'timeCycle',
  duration: 'timeDuration',
  date: 'timeDate',
};

function expression(doc: Doc, body: string): El {
  return doc.moddle.create('bpmn:FormalExpression', { body });
}

/* ------------------------------------------------------------------ */
/* event definitions                                                    */
/* ------------------------------------------------------------------ */

function buildDefinition(doc: Doc, event: El, trigger: Exclude<Trigger, 'none'>, opts: TriggerOptions): El {
  const type = TRIGGER_TYPES[trigger];
  switch (trigger) {
    case 'timer': {
      const def = doc.moddle.create(type, {});
      if (opts.timer !== undefined) {
        const value = opts.timer.trim();
        if (!value) throw modelError('E_INVALID_VALUE', 'The timer value is empty', { hint: 'Use ISO 8601: PT5M (duration), R/PT1H (cycle) or 2030-01-01T00:00:00Z (date).' });
        def.set(TIMER_PROPS[classifyTimer(value, opts.timerKind)], expression(doc, value));
      }
      return def;
    }
    case 'message':
      return doc.moddle.create(type, opts.message ? { messageRef: ensureRootElement(doc, 'bpmn:Message', opts.message).el } : {});
    case 'error':
      return doc.moddle.create(type, opts.error ? { errorRef: ensureRootElement(doc, 'bpmn:Error', opts.error, { errorCode: opts.errorCode }).el } : {});
    case 'signal':
      return doc.moddle.create(type, opts.signal ? { signalRef: ensureRootElement(doc, 'bpmn:Signal', opts.signal).el } : {});
    case 'escalation':
      return doc.moddle.create(
        type,
        opts.escalation ? { escalationRef: ensureRootElement(doc, 'bpmn:Escalation', opts.escalation, { escalationCode: opts.escalationCode }).el } : {},
      );
    case 'conditional': {
      if (opts.when !== undefined && !opts.when.trim()) {
        throw modelError('E_INVALID_VALUE', 'The condition expression is empty', { hint: "Quote expressions with single quotes, e.g. --when '${approved}'." });
      }
      return doc.moddle.create(type, opts.when ? { condition: expression(doc, opts.when) } : {});
    }
    case 'link': {
      const name = opts.link ?? event.get<string | undefined>('name');
      return doc.moddle.create(type, name ? { name } : {});
    }
    default:
      return doc.moddle.create(type, {});
  }
}

/* ------------------------------------------------------------------ */
/* in-place update (same trigger)                                       */
/* ------------------------------------------------------------------ */

type RefTrigger = 'message' | 'error' | 'signal' | 'escalation';

/** Reference property, root type and code option of the triggers that point at a root element. */
const REF_TRIGGERS: Record<RefTrigger, { prop: string; type: RootRefType; code?: 'errorCode' | 'escalationCode' }> = {
  message: { prop: 'messageRef', type: 'bpmn:Message' },
  error: { prop: 'errorRef', type: 'bpmn:Error', code: 'errorCode' },
  signal: { prop: 'signalRef', type: 'bpmn:Signal' },
  escalation: { prop: 'escalationRef', type: 'bpmn:Escalation', code: 'escalationCode' },
};

function isRefTrigger(trigger: Trigger): trigger is RefTrigger {
  return trigger in REF_TRIGGERS;
}

/** Re-points the root reference when the named element differs (codes are applied to it as when creating). */
function updateReference(doc: Doc, def: El, trigger: RefTrigger, opts: TriggerOptions): void {
  const spec = REF_TRIGGERS[trigger];
  const name = opts[trigger];
  if (name === undefined) return;
  const extra = spec.code ? { [spec.code]: opts[spec.code] } : {};
  const { el } = ensureRootElement(doc, spec.type, name, extra);
  if (def.get<El | undefined>(spec.prop) !== el) def.set(spec.prop, el);
}

/** Sets the body of an expression property, keeping an existing expression element (id, language, vendor attributes). */
function updateExpression(doc: Doc, def: El, prop: string, body: string, from: string = prop): void {
  const expr = def.get<El | undefined>(from);
  if (!expr) {
    def.set(prop, expression(doc, body));
    return;
  }
  if (from !== prop) {
    def.set(from, undefined);
    def.set(prop, expr);
    expr.$parent = def;
  }
  if (expr.get<string | undefined>('body') !== body) expr.set('body', body);
}

function updateTimer(doc: Doc, def: El, opts: TriggerOptions): void {
  if (opts.timer === undefined) return;
  const value = opts.timer.trim();
  if (!value) throw modelError('E_INVALID_VALUE', 'The timer value is empty', { hint: 'Use ISO 8601: PT5M (duration), R/PT1H (cycle) or 2030-01-01T00:00:00Z (date).' });
  const prop = TIMER_PROPS[classifyTimer(value, opts.timerKind)];
  const current = Object.values(TIMER_PROPS).find((p) => def.get<El | undefined>(p)) ?? prop;
  updateExpression(doc, def, prop, value, current);
  for (const p of Object.values(TIMER_PROPS)) if (p !== prop && def.get<El | undefined>(p)) def.set(p, undefined);
}

/**
 * A new inline condition of a conditional event: like a sequence flow's
 * condition (ops/set.ts), it replaces a script resource (camunda:resource and
 * its language go) and a `${...}` body does not keep a script language; both
 * are reported (W_PROPERTY_DROPPED).
 */
function updateCondition(doc: Doc, event: El, def: El, opts: TriggerOptions): Warning[] {
  if (opts.when === undefined) return [];
  if (!opts.when.trim()) {
    throw modelError('E_INVALID_VALUE', 'The condition expression is empty', { hint: "Quote expressions with single quotes, e.g. --when '${approved}'." });
  }
  const expr = def.get<El | undefined>('condition');
  const dropped: string[] = [];
  if (expr && expr.get<string | undefined>('body') !== opts.when) {
    const resourceKey = Object.keys(expr.$attrs ?? {}).find((k) => /^[^:]+:resource$/.test(k) && isC7Uri(doc.namespaceUri(k.split(':')[0]!)));
    const language = expr.get<string | undefined>('language');
    if (resourceKey) {
      dropped.push(`${resourceKey} ${String(expr.$attrs[resourceKey])}`);
      delete expr.$attrs[resourceKey];
    }
    if (language && (resourceKey || (/^\s*[$#]\{[\s\S]*\}\s*$/.test(opts.when) && language.toLowerCase() !== 'juel'))) {
      dropped.push(`language ${language}`);
      expr.set('language', undefined);
    }
  }
  updateExpression(doc, def, 'condition', opts.when);
  if (!dropped.length) return [];
  return [
    {
      code: 'W_PROPERTY_DROPPED',
      message: `${dropped.join(' and ')} of the condition of ${idOf(event)} ${dropped.length > 1 ? 'were' : 'was'} dropped: the new inline condition replaces ${dropped[0]!.startsWith('language') ? 'the script' : 'the script resource'}`,
      element: idOf(event),
      hint: 'To keep a script condition set condition.camunda:resource=<uri> or condition.language=<lang> after when=.',
    },
  ];
}

/** Applies the trigger options to an existing definition of the same trigger, touching only what differs. */
function updateDefinition(doc: Doc, event: El, def: El, trigger: Exclude<Trigger, 'none'>, opts: TriggerOptions): Warning[] {
  if (isRefTrigger(trigger)) updateReference(doc, def, trigger, opts);
  else if (trigger === 'timer') updateTimer(doc, def, opts);
  else if (trigger === 'conditional') return updateCondition(doc, event, def, opts);
  else if (trigger === 'link' && opts.link !== undefined && def.get<string | undefined>('name') !== opts.link) def.set('name', opts.link || undefined);
  return [];
}

/* ------------------------------------------------------------------ */
/* replacement (trigger kind change)                                    */
/* ------------------------------------------------------------------ */

/**
 * Vendor content of a nested element (event definition, loop characteristics,
 * expression): prefixed attributes, extension elements, documentation.
 */
export function vendorContent(def: El): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(def.$attrs ?? {})) if (!k.startsWith('xmlns') && !k.startsWith('xsi:') && typeof v !== 'object') out.push(k);
  for (const ext of def.get<El | undefined>('extensionElements')?.get<El[] | undefined>('values') ?? []) out.push(ext.$type);
  if ((def.get<El[] | undefined>('documentation') ?? []).length) out.push('documentation');
  return out;
}

/** Removes the event's definitions (ids released) and reports the vendor content that goes with them. */
function dropDefinitions(doc: Doc, event: El, trigger: Trigger): Warning[] {
  const defs = [...(event.get<El[] | undefined>('eventDefinitions') ?? [])];
  event.set('eventDefinitions', undefined);
  const warnings: Warning[] = [];
  for (const def of defs) {
    for (const e of walk(def, { bpmnOnly: true })) {
      const id = e.get<string | undefined>('id');
      if (id) doc.ids.release(id);
    }
    const lost = vendorContent(def);
    if (!lost.length) continue;
    const defId = def.get<string | undefined>('id');
    warnings.push({
      code: 'W_PROPERTY_DROPPED',
      message: `${lost.join(', ')} of the ${def.$type.replace('bpmn:', '')}${defId ? ` ${defId}` : ''} of ${idOf(event)} ${lost.length > 1 ? 'were' : 'was'} dropped: the trigger changed to ${trigger}`,
      element: idOf(event),
      hint: 'Vendor attributes and extension elements belong to the old event definition; re-create what the new trigger still needs in the XML, or keep the old trigger and change only its details (e.g. `bpmn set <file> <id> message=<Name>`).',
    });
  }
  return warnings;
}

/**
 * An event with several event definitions set to the trigger of one of them:
 * that one stays (id, details and vendor content), the others go (ids
 * released), reported as one W_PROPERTY_DROPPED.
 */
function dropOtherDefinitions(doc: Doc, event: El, keep: El, trigger: Trigger): Warning[] {
  const defs = [...(event.get<El[] | undefined>('eventDefinitions') ?? [])];
  const others = defs.filter((d) => d !== keep);
  event.set('eventDefinitions', [keep]);
  for (const def of others) {
    for (const e of walk(def, { bpmnOnly: true })) {
      const id = e.get<string | undefined>('id');
      if (id) doc.ids.release(id);
    }
  }
  const text = (d: El): string => {
    const local = d.$type.replace('bpmn:', '');
    const id = d.get<string | undefined>('id');
    const lost = vendorContent(d);
    return `${local.charAt(0).toLowerCase()}${local.slice(1)}${id ? ` ${id}` : ''}${lost.length ? ` (with ${lost.join(', ')})` : ''}`;
  };
  return [
    {
      code: 'W_PROPERTY_DROPPED',
      message: `${others.map(text).join(', ')} of ${idOf(event)} ${others.length > 1 ? 'were' : 'was'} dropped: trigger=${trigger} keeps only its ${text(keep).replace(/ \(with .*\)$/, '')} (an event acts on one event definition)`,
      element: idOf(event),
      hint: 'Set the trigger of the definition the event should keep; the others cannot be kept on the same event.',
    },
  ];
}

function isEventSubProcess(el: El | undefined): boolean {
  return !!el && is(el, 'bpmn:SubProcess') && !!el.get<boolean | undefined>('triggeredByEvent');
}

function applyInterrupting(doc: Doc, event: El, trigger: Trigger, opts: TriggerOptions): void {
  const want = opts.nonInterrupting;
  const interruptingOnly = INTERRUPTING_ONLY.includes(trigger);
  if (is(event, 'bpmn:BoundaryEvent')) {
    if (want === true) {
      if (interruptingOnly) {
        throw modelError('E_INVALID_TRIGGER', `A ${trigger} boundary event cannot be non-interrupting`, {
          element: idOf(event),
          hint: 'Only message, timer, signal, escalation and conditional boundary events can be non-interrupting.',
        });
      }
      event.set('cancelActivity', false);
    } else if (want === false || (interruptingOnly && event.get<boolean>('cancelActivity') === false)) {
      event.set('cancelActivity', undefined);
    }
    return;
  }
  if (is(event, 'bpmn:StartEvent')) {
    if (want === true) {
      if (!isEventSubProcess(doc.scopeOf(event))) {
        throw modelError('E_INVALID_TRIGGER', `Start event ${idOf(event)} is not inside an event sub-process and cannot be non-interrupting`, {
          element: idOf(event),
          hint: 'Only start events of an eventSubProcess can be non-interrupting.',
        });
      }
      if (interruptingOnly || trigger === 'none') {
        throw modelError('E_INVALID_TRIGGER', `A ${trigger} start event cannot be non-interrupting`, {
          element: idOf(event),
          hint: 'Only message, timer, signal, escalation and conditional start events can be non-interrupting.',
        });
      }
      event.set('isInterrupting', false);
    } else if (want === false || (interruptingOnly && event.get<boolean>('isInterrupting') === false)) {
      event.set('isInterrupting', undefined);
    }
    return;
  }
  if (want === true) {
    throw modelError('E_INVALID_TRIGGER', `nonInterrupting only applies to boundary events and event sub-process start events (${idOf(event)} is a ${kindOf(event)?.kind ?? event.$type})`, {
      element: idOf(event),
    });
  }
}

/**
 * Sets the event's trigger. Validates the trigger against the event kind
 * and its position (start event triggers restricted to event sub-processes,
 * non-interrupting rules), then updates the existing definition in place
 * (same trigger) or swaps the event definitions (see the module contract).
 * Returns the warnings about vendor content a swap dropped.
 */
export function applyTrigger(doc: Doc, event: El, trigger: Trigger, opts: TriggerOptions = {}): Warning[] {
  if (!is(event, 'bpmn:Event')) {
    throw modelError('E_WRONG_KIND', `${idOf(event)} is not an event and cannot have a trigger`, { element: idOf(event) });
  }
  const def = kindOf(event);
  const allowed = def?.triggers ?? [];
  if (!def || !allowed.includes(trigger)) {
    throw modelError('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def?.kind ?? event.$type}. Allowed: ${allowed.join(', ')}`, {
      element: idOf(event),
      candidates: allowed,
    });
  }
  if (is(event, 'bpmn:StartEvent') && EVENT_SUBPROCESS_ONLY.includes(trigger) && !isEventSubProcess(doc.scopeOf(event))) {
    throw modelError('E_INVALID_TRIGGER', `A startEvent:${trigger} is only allowed inside an event sub-process (${idOf(event)} is not)`, {
      element: idOf(event),
      hint: `Create the event sub-process together with its start in one command: \`add eventSubProcess "Handle errors" --${trigger === 'compensate' ? 'error <Name>' : `${trigger} <Name>`}\` (or eventSubProcess:${trigger}); or add the start with --in <eventSubProcessId> in the same \`apply\` batch as the eventSubProcess.`,
    });
  }
  applyInterrupting(doc, event, trigger, opts);
  const defs = event.get<El[] | undefined>('eventDefinitions') ?? [];
  // the one definition of that trigger is kept (also when the event has others besides it, which go)
  const matching = trigger !== 'none' ? defs.filter((d) => is(d, TRIGGER_TYPES[trigger])) : [];
  const same = matching.length === 1 ? matching[0] : undefined;
  if (same && trigger !== 'none') {
    const others = defs.length > 1 ? dropOtherDefinitions(doc, event, same, trigger) : [];
    const warnings = updateDefinition(doc, event, same, trigger, opts);
    doc.invalidate();
    return [...others, ...warnings];
  }
  const fresh = trigger !== 'none' ? buildDefinition(doc, event, trigger, opts) : undefined;
  const warnings = dropDefinitions(doc, event, trigger);
  if (fresh) addTo(event, 'eventDefinitions', fresh);
  doc.invalidate();
  return warnings;
}

/* ------------------------------------------------------------------ */
/* description                                                          */
/* ------------------------------------------------------------------ */

function refInfo(ref: El | undefined, codeProp?: string): { id: string; name?: string; code?: string } | undefined {
  if (!ref) return undefined;
  const name = ref.get<string | undefined>('name');
  const code = codeProp ? ref.get<string | undefined>(codeProp) : undefined;
  return { id: idOf(ref), ...(name ? { name } : {}), ...(code ? { code } : {}) };
}

function bodyOf(expr: El | undefined): string | undefined {
  return expr?.get<string | undefined>('body');
}

/** Structured trigger details of an event (undefined for non-events). */
export function triggerDetails(event: El): TriggerDetails | undefined {
  if (!is(event, 'bpmn:Event')) return undefined;
  const trigger = triggerOf(event) ?? 'none';
  const details: TriggerDetails = { trigger };
  const def = many(event, 'eventDefinitions')[0];
  if (def) {
    switch (trigger) {
      case 'timer': {
        for (const kind of ['cycle', 'duration', 'date'] as const) {
          const value = bodyOf(def.get<El | undefined>(TIMER_PROPS[kind]));
          if (value) details.timer = { kind, value };
        }
        break;
      }
      case 'message': {
        const info = refInfo(def.get<El | undefined>('messageRef'));
        if (info) details.message = info;
        break;
      }
      case 'error': {
        const info = refInfo(def.get<El | undefined>('errorRef'), 'errorCode');
        if (info) details.error = info;
        break;
      }
      case 'signal': {
        const info = refInfo(def.get<El | undefined>('signalRef'));
        if (info) details.signal = info;
        break;
      }
      case 'escalation': {
        const info = refInfo(def.get<El | undefined>('escalationRef'), 'escalationCode');
        if (info) details.escalation = info;
        break;
      }
      case 'conditional': {
        const condition = bodyOf(def.get<El | undefined>('condition'));
        if (condition) details.condition = condition;
        break;
      }
      case 'link': {
        const link = def.get<string | undefined>('name');
        if (link) details.link = link;
        break;
      }
      default:
        break;
    }
  }
  if (is(event, 'bpmn:BoundaryEvent') && event.get<boolean>('cancelActivity') === false) details.nonInterrupting = true;
  if (is(event, 'bpmn:StartEvent') && event.get<boolean>('isInterrupting') === false) details.nonInterrupting = true;
  return details;
}

function named(info: { id: string; name?: string; code?: string } | undefined, fallback: string): string {
  if (!info) return fallback;
  return `${fallback} ${info.name ?? info.id}${info.code ? ` (${info.code})` : ''}`;
}

/** Short human text of the trigger, e.g. "PT2D", "message OrderReceived"; "" when none. */
export function describeTrigger(event: El): string {
  const d = triggerDetails(event);
  if (!d || d.trigger === 'none') return '';
  switch (d.trigger) {
    case 'timer':
      return d.timer ? d.timer.value : 'timer';
    case 'message':
      return named(d.message, 'message');
    case 'error':
      return named(d.error, 'error');
    case 'signal':
      return named(d.signal, 'signal');
    case 'escalation':
      return named(d.escalation, 'escalation');
    case 'conditional':
      return d.condition ? `condition ${d.condition}` : 'conditional';
    case 'link':
      return d.link ? `link ${d.link}` : 'link';
    default:
      return d.trigger;
  }
}
