/**
 * Nested elements without an id of their own, which `set` and `ext` address by a key
 * prefix: `definition.` (or `definition[<n>]` / `definition[<trigger>]`), `loop.`, `condition.`.
 */
import { modelError } from './errors.js';
import { kindLabel, normalizeTrigger, TRIGGER_TYPES, type Trigger } from './kinds.js';
import { is, type El } from './moddle.js';
import { idOf, ownValue, typeLabel } from './elements.js';

export const NESTED_SLOTS = ['definition', 'loop', 'condition'] as const;
export type NestedSlot = (typeof NESTED_SLOTS)[number];

export const SLOT_TEXT: Record<NestedSlot, string> = {
  definition: 'event definition',
  loop: 'loop characteristics',
  condition: 'condition expression',
};

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

/** `loop.camunda:collection` -> { slot: 'loop', key: 'camunda:collection' } */
export function splitNestedKey(key: string): { slot: string; key: string } | undefined {
  const selector = /^(\w+\[[^\]]*\])\.(.*)$/.exec(key);
  if (selector) return { slot: selector[1]!, key: selector[2]! };
  const dot = key.indexOf('.');
  if (dot <= 0) return undefined;
  const colon = key.indexOf(':');
  if (colon >= 0 && colon < dot) return undefined; // a vendor attribute with a dot in its name
  return { slot: key.slice(0, dot), key: key.slice(dot + 1) };
}

/** `definition[1]` selects by 0-based position, `definition[timer]` by trigger. */
export interface SlotRef {
  slot: NestedSlot;
  text: string;
  index?: number;
  trigger?: Exclude<Trigger, 'none'>;
  invalid?: string;
}

export function parseSlotRef(text: string): SlotRef | undefined {
  const match = /^(\w+)(?:\[\s*([^\]]*?)\s*\])?$/.exec(text.trim());
  if (!match || !(NESTED_SLOTS as readonly string[]).includes(match[1]!)) return undefined;
  const ref: SlotRef = { slot: match[1] as NestedSlot, text: text.trim() };
  const sel = match[2];
  if (sel === undefined) return ref;
  if (/^\d+$/.test(sel)) ref.index = Number(sel);
  else {
    const trigger = normalizeTrigger(sel);
    if (trigger && trigger !== 'none') ref.trigger = trigger;
    else ref.invalid = sel;
  }
  return ref;
}

export function definitionsOf(el: El): El[] {
  const defs = ownValue(el, 'eventDefinitions');
  return is(el, 'bpmn:Event') && Array.isArray(defs) ? (defs as El[]) : [];
}

function definitionText(def: El): string {
  const id = def.get<string | undefined>('id');
  return `${typeLabel(def)}${id ? ` ${id}` : ''}`;
}

export function slotsOf(el: El): NestedSlot[] {
  const out: NestedSlot[] = [];
  if (is(el, 'bpmn:Event')) out.push('definition');
  if (is(el, 'bpmn:Activity')) out.push('loop');
  if (is(el, 'bpmn:SequenceFlow') || definitionsOf(el).some((definition) => is(definition, 'bpmn:ConditionalEventDefinition'))) out.push('condition');
  return out;
}

/**
 * With several event definitions, `definition` is the first one (ops use resolveNested);
 * `condition` of an event needs exactly one conditional event definition.
 */
export function nestedElement(el: El, slot: NestedSlot): El | undefined {
  switch (slot) {
    case 'definition':
      return definitionsOf(el)[0];
    case 'loop':
      return is(el, 'bpmn:Activity') ? el.get<El | undefined>('loopCharacteristics') : undefined;
    case 'condition': {
      if (is(el, 'bpmn:SequenceFlow')) return el.get<El | undefined>('conditionExpression');
      const conditional = definitionsOf(el).filter((definition) => is(definition, 'bpmn:ConditionalEventDefinition'));
      return conditional.length === 1 ? conditional[0]!.get<El | undefined>('condition') : undefined;
    }
    default:
      return undefined;
  }
}

export function nestedEntries(el: El): Array<{ slot: NestedSlot; prefix: string; el: El }> {
  const out: Array<{ slot: NestedSlot; prefix: string; el: El }> = [];
  for (const slot of slotsOf(el)) {
    if (slot === 'definition') {
      const defs = definitionsOf(el);
      defs.forEach((definition, index) => out.push({ slot, prefix: defs.length > 1 ? `definition[${index}]` : 'definition', el: definition }));
      continue;
    }
    const nested = nestedElement(el, slot);
    if (nested) out.push({ slot, prefix: slot, el: nested });
  }
  return out;
}

/**
 * Undefined when the slot exists but is empty. An event with several event definitions
 * needs a selector. `example` turns a prefix into the command a hint shows.
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
  const listing = defs.map((definition, index) => `definition[${index}] = ${definitionText(definition)}`).join(', ');
  if (ref.index !== undefined || ref.trigger) {
    const hits = ref.index !== undefined ? (defs[ref.index] ? [defs[ref.index]!] : []) : defs.filter((definition) => is(definition, TRIGGER_TYPES[ref.trigger!]));
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
  const listing = defs.map((definition, index) => `definition[${index}] = ${definitionText(definition)}`).join(', ');
  const triggers = defs.map((definition) => (Object.entries(TRIGGER_TYPES) as Array<[string, string]>).find(([, type]) => is(definition, type))?.[0]).filter((trigger): trigger is string => !!trigger);
  const unique = triggers.filter((trigger, index) => triggers.indexOf(trigger) === index && triggers.lastIndexOf(trigger) === index);
  const rest = what.replace(/^definition(\[[^\]]*\])?\./, '');
  const show = example ?? ((prefix: string) => `bpmn set <file> ${id} '${prefix}.${rest}=<value>'`);
  return modelError('E_AMBIGUOUS_NESTED', `${kindLabel(el)} ${id} has ${count} (${listing}); ${what} does not say which one`, {
    element: id,
    candidates: defs.map((_definition, index) => `definition[${index}]`),
    hint: `Name one by position (0-based) or by trigger, e.g. \`${show('definition[1]')}\`${unique.length ? ` or \`${show(`definition[${unique[unique.length - 1]}]`)}\`` : ''} (quote the brackets in a shell). The engines act on only one event definition per event; to keep a single one, set the trigger again: \`bpmn set <file> ${id} trigger=<trigger> ...\`.`,
  });
}
