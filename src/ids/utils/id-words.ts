import { nameWords } from './slug.js';

export const lcfirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
export const ucfirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const localName = (type: string): string => type.slice(type.indexOf(':') + 1);

export const PREFIXED = /^([A-Za-z][A-Za-z0-9]*)_(.+)$/;
/** A number glued to its prefix: `flow12`, `f3`. */
export const GLUED = /^([A-Za-z]+)(\d+)$/;

/** Tool defaults that say nothing about a file's conventions (the Camunda Modeler's first start event). */
export const TOOL_DEFAULTS = new Set(['StartEvent_1']);
export const HASH = /^[01][0-9a-z]{6}$/;

/** The id without its prefix (`serviceTask_checkStock` -> `checkStock`). */
export function stem(id: string): string {
  const i = id.indexOf('_');
  return i === -1 ? id : id.slice(i + 1);
}

/**
 * The part of an id that says what the element is (`CheckInvoice` of
 * Activity_CheckInvoice, `checkOrder` of a bare checkOrder), or undefined
 * for ids that say nothing: tool defaults (StartEvent_1), Camunda Modeler
 * hashes (Activity_0k3x9qa), numbers (Task_12, flow12) and machine ids
 * (sid-6F1C..., UUIDs: mostly digits).
 */
export function speakingStem(id: string): string | undefined {
  if (TOOL_DEFAULTS.has(id) || GLUED.test(id)) return undefined;
  // a collision suffix belongs to the stem (reviewOrder_2, Activity_Check_2); `Task_12` is a number, not a suffix
  const suffixed = /^(.+)_(\d+)$/.exec(id);
  if (suffixed && (suffixed[1]!.includes('_') || nameWords(suffixed[1]).length > 1)) {
    const base = speakingStem(suffixed[1]!);
    return base ? `${base}_${suffixed[2]}` : undefined;
  }
  const s = stem(id);
  if (HASH.test(s) || /^\d+$/.test(s) || !/[A-Za-z]/.test(s)) return undefined;
  const digits = s.replace(/[^0-9]/g, '').length;
  if (digits >= 3 && digits * 4 >= s.length && !hasWord(s)) return undefined;
  return s;
}

/**
 * Whether a stem with many digits still has a word (`AfterCheck2024`,
 * `Order01001`): a run of four or more letters with one that is no hex digit.
 * Machine ids have none (`sid-6F1C3A2B-...`, UUIDs, `a3f2c1de`).
 */
function hasWord(s: string): boolean {
  return (s.match(/[A-Za-z]{4,}/g) ?? []).some((run) => /[g-z]/i.test(run));
}

/** The words that tie an unnamed element's id to its place (Gateway_AfterCheckInvoice, Event_TimerOnReview, Event_StartInPayment). */
export type ContextWord = 'After' | 'Before' | 'On' | 'In';
export const CONTEXT_WORDS = new Set(['after', 'before', 'on', 'in']);

/** The words of an id stem, split at case changes, between letters and digits and at separators (`After4AugenPrinzip` -> After, 4, Augen, Prinzip). */
export function stemWords(stem: string): string[] {
  return stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** Whether two ends begin with the same word (the unnamed elements after one anchor), which fitPair keeps apart at their ends. */
export function beginAlike(a: string, b: string): boolean {
  const first = (x: string): string => (stemWords(x)[0] ?? '').toLowerCase();
  return first(a) === first(b);
}

export type PrefixClass = 'kind' | 'triggerKind' | 'literal';

/**
 * Prefixes that name a type but are also the usual generic prefix of their
 * family: `Task_` on a plain task may be the old modeler's type name or a
 * `Task_` for every task. Such a prefix counts as the family's prefix, and
 * on its own type it says nothing about type-named prefixes.
 */
export const GENERIC = new Set(['task']);

/**
 * `kind`: the prefix names the element's type (serviceTask_, EndEvent_),
 * `triggerKind`: its trigger and type (messageBoundaryEvent_), else a
 * `literal` (Task_, End_, Activity_). The bpmn-cli prefix of the family is a
 * literal even where it is the type name (Lane_, Message_, LaneSet_): it says
 * nothing about type-named prefixes; so is `Task_` (GENERIC).
 */
export function prefixClass(prefix: string, typeNames: string[], trigger: string | undefined, family: string): PrefixClass {
  const p = prefix.toLowerCase();
  if (p === family.toLowerCase() || GENERIC.has(p)) return 'literal';
  if (typeNames.some((n) => n.toLowerCase() === p)) return 'kind';
  if (trigger && typeNames.some((n) => `${trigger}${n}`.toLowerCase() === p)) return 'triggerKind';
  return 'literal';
}

/**
 * A word for an element of a kind (the start of an unnamed element's body,
 * the label of an unnamed flow end): Start, MessageStart, End, ErrorEnd,
 * Timer (catch and boundary events), MessageThrow, Intermediate; Exclusive,
 * Parallel (gateways); Task, UserTask, SubProcess; LaneSet, ...; Main (a
 * process, collaboration or definitions). With a context, the prefix says
 * enough for every kind but the events (Gateway_AfterCheckInvoice): ''.
 */
export function kindWord(key: string, trigger: string | undefined, withContext = false): string {
  const t = trigger && trigger !== 'none' ? ucfirst(trigger) : '';
  switch (key) {
    case 'startEvent':
      return `${t}Start`;
    case 'endEvent':
      return `${t}End`;
    case 'boundaryEvent':
      return t || 'Boundary';
    case 'intermediateCatchEvent':
      return t || 'Catch';
    case 'intermediateThrowEvent':
      return t ? `${t}Throw` : 'Intermediate';
  }
  if (withContext) return '';
  if (/^[a-z]+Gateway$/.test(key)) return ucfirst(key.slice(0, -'Gateway'.length));
  // the one process of a file, the collaboration of its pools, the definitions of an unnamed new file (defs_main)
  if (key === 'bpmn:Process' || key === 'bpmn:Collaboration' || key === 'bpmn:Definitions') return 'Main';
  return ucfirst(localName(key));
}
