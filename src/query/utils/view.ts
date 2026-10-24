import { KindError } from '../../model/KindError.js';
import { kindLabel, kindOf, parseKind, triggerOf } from '../../model/utils/kinds.js';
import { groupName, is, localType, peek, shownId, walk, type El } from '../../model/utils/moddle.js';
import { usageError } from '../../shared/utils/errors.js';

export function nameOf(el: El): string | undefined {
  if (is(el, 'bpmn:Group')) return groupName(el);
  const n = peek<unknown>(el, 'name');
  return typeof n === 'string' && n ? n : undefined;
}

export function ownNameOf(el: El | undefined): string | undefined {
  const n = el ? peek<unknown>(el, 'name') : undefined;
  return typeof n === 'string' && n ? n : undefined;
}

/** Drops undefined-valued keys so JSON output stays compact. */
export function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as Array<keyof T>) if (obj[key] === undefined) delete obj[key];
  return obj;
}

export function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length ? items : undefined;
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

/**
 * Kind label for any element: the canonical kind (incl. trigger) for kinds the
 * AI can create, else the lowerCamel local type (`sequenceFlow`, `lane`,
 * `participant`, `messageFlow`, `association`, `dataAssociation`, ...).
 */
export function labelOf(el: El): string {
  if (kindOf(el)) return kindLabel(el);
  if (is(el, 'bpmn:DataAssociation')) return 'dataAssociation';
  const local = localType(el);
  return local.charAt(0).toLowerCase() + local.slice(1);
}

export function isEventSubProcess(el: El): boolean {
  return is(el, 'bpmn:SubProcess') && peek<boolean>(el, 'triggeredByEvent') === true;
}

export function refLabel(ref: El | undefined): string {
  if (!ref) return '?';
  return nameOf(ref) ?? shownId(ref);
}

export function bodyOf(expr: El | undefined): string | undefined {
  if (!expr) return undefined;
  const body = peek<unknown>(expr, 'body');
  return typeof body === 'string' && body ? body : undefined;
}

/** camunda:resource (any prefix) of an expression. */
export function resourceOf(expr: El | undefined): { key: string; value: string } | undefined {
  if (!expr) return undefined;
  const key = Object.keys(expr.$attrs ?? {}).find((k) => /:resource$/.test(k) && !k.startsWith('xmlns'));
  const value = key ? expr.$attrs[key] : undefined;
  return key && typeof value === 'string' && value ? { key, value } : undefined;
}

/** The process and every sub-process nested in it, in tree order. */
export function scopesWithin(process: El): El[] {
  return [...walk(process)].filter((e) => is(e, 'bpmn:Process') || is(e, 'bpmn:SubProcess'));
}

/** Non-kind labels `find --kind` also accepts. */
const EXTRA_KINDS = ['sequenceFlow', 'messageFlow', 'association', 'dataAssociation', 'process', 'collaboration', 'message', 'error', 'signal', 'escalation'];

export function kindFilter(kind: string): (el: El) => boolean {
  try {
    const { def, trigger } = parseKind(kind);
    return (el) => kindOf(el)?.kind === def.kind && (!trigger || triggerOf(el) === trigger);
  } catch (err) {
    if (!(err instanceof KindError)) throw err;
    const token = kind.trim().toLowerCase();
    const extra = EXTRA_KINDS.find((k) => k.toLowerCase() === token);
    if (extra) return (el) => labelOf(el) === extra;
    throw usageError(err.message, { candidates: [...err.candidates, ...EXTRA_KINDS.filter((k) => k.toLowerCase().includes(token))] });
  }
}
