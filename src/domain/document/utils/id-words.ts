import { nameWords } from './slug.js';

export const lcfirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
export const ucfirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
export const localName = (type: string): string => type.slice(type.indexOf(':') + 1);

export const PREFIXED = /^([A-Za-z][A-Za-z0-9]*)_(.+)$/;
const GLUED = /^([A-Za-z]+)(\d+)$/;

/** The Camunda Modeler's first start event says nothing about a file's conventions. */
const TOOL_DEFAULTS = new Set(['StartEvent_1']);
const HASH = /^[01][0-9a-z]{6}$/;

function stem(id: string): string {
  const underscoreIndex = id.indexOf('_');
  return underscoreIndex === -1 ? id : id.slice(underscoreIndex + 1);
}

/**
 * The part of an id that says what the element is; undefined for tool defaults,
 * Camunda Modeler hashes (Activity_0k3x9qa), numbers and machine ids (sid-6F1C..., UUIDs).
 * A collision suffix belongs to the stem (reviewOrder_2); `Task_12` is a number, not a suffix.
 */
export function speakingStem(id: string): string | undefined {
  if (TOOL_DEFAULTS.has(id) || GLUED.test(id)) return undefined;
  const suffixed = /^(.+)_(\d+)$/.exec(id);
  if (suffixed && (suffixed[1]!.includes('_') || nameWords(suffixed[1]).length > 1)) {
    const base = speakingStem(suffixed[1]!);
    return base ? `${base}_${suffixed[2]}` : undefined;
  }
  const idStem = stem(id);
  if (HASH.test(idStem) || /^\d+$/.test(idStem) || !/[A-Za-z]/.test(idStem)) return undefined;
  const digits = idStem.replace(/[^0-9]/g, '').length;
  if (digits >= 3 && digits * 4 >= idStem.length && !hasWord(idStem)) return undefined;
  return idStem;
}

/**
 * A run of four or more letters with one that is no hex digit (`AfterCheck2024`);
 * machine ids have none (`sid-6F1C3A2B-...`, `a3f2c1de`).
 */
function hasWord(text: string): boolean {
  return (text.match(/[A-Za-z]{4,}/g) ?? []).some((run) => /[g-z]/i.test(run));
}

/** The words that tie an unnamed element's id to its place (Gateway_AfterCheckInvoice). */
export type ContextWord = 'After' | 'Before' | 'On' | 'In';
export const CONTEXT_WORDS = new Set(['after', 'before', 'on', 'in']);

export function stemWords(stem: string): string[] {
  return stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

export function beginAlike(one: string, other: string): boolean {
  const first = (slug: string): string => (stemWords(slug)[0] ?? '').toLowerCase();
  return first(one) === first(other);
}

/**
 * A word for an unnamed element of a kind (MessageStart, Exclusive, UserTask, Main). With a
 * context the prefix says enough for every kind but the events, so it is ''.
 */
export function kindWord(key: string, trigger: string | undefined, withContext = false): string {
  const triggerWord = trigger && trigger !== 'none' ? ucfirst(trigger) : '';
  switch (key) {
    case 'startEvent':
      return `${triggerWord}Start`;
    case 'endEvent':
      return `${triggerWord}End`;
    case 'boundaryEvent':
      return triggerWord || 'Boundary';
    case 'intermediateCatchEvent':
      return triggerWord || 'Catch';
    case 'intermediateThrowEvent':
      return triggerWord ? `${triggerWord}Throw` : 'Intermediate';
  }
  if (withContext) return '';
  if (/^[a-z]+Gateway$/.test(key)) return ucfirst(key.slice(0, -'Gateway'.length));
  if (key === 'bpmn:Process' || key === 'bpmn:Collaboration' || key === 'bpmn:Definitions') return 'Main';
  return ucfirst(localName(key));
}

export const caseLike = (name: string, lowerFirst: boolean): string => (lowerFirst ? lcfirst(name) : ucfirst(name));
