/**
 * The nested elements without an id of their own that `set` and `ext`
 * address with a prefix: `definition.` (the event definition, `definition[<n>]`
 * / `definition[<trigger>]` of an event that has several), `loop.` (the loop
 * characteristics), `condition.` (the condition expression of a sequence flow
 * or a conditional event).
 */
import { modelError } from '../../shared/utils/errors.js';
import { kindLabel, normalizeTrigger, TRIGGER_TYPES, type Trigger } from '../../model/kinds.js';
import { is, type El } from '../../model/utils/moddle.js';
import { idOf, ownValue, typeLabel } from './elements.js';

/** Key prefixes that address a nested element without an id of its own. */
export const NESTED_SLOTS = ['definition', 'loop', 'condition'] as const;
export type NestedSlot = (typeof NESTED_SLOTS)[number];

export const SLOT_TEXT: Record<NestedSlot, string> = {
  definition: 'event definition',
  loop: 'loop characteristics',
  condition: 'condition expression',
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
