/**
 * The small reads every mutation shares: an element's moddle descriptor, its
 * own values (without moddle's lazy collections), its id, its vendor content.
 */
import { kindLabel } from '../../model/kinds.js';
import { localType, type El } from '../../model/utils/moddle.js';

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

/** The id of an element, `''` without one. */
export function idOf(el: El): string {
  return el.get<string | undefined>('id') ?? '';
}

/** `userTask Activity_Check "Check"`: kind label, id and name, for messages. */
export function labelOf(el: El): string {
  const name = el.get<string | undefined>('name');
  return `${kindLabel(el)} ${el.get<string>('id')}${name ? ` "${name}"` : ''}`;
}

/** True for moddle elements (typed or generic). */
export function isEl(v: unknown): v is El {
  return !!v && typeof v === 'object' && typeof (v as El).$type === 'string';
}

/** lowerCamel local type for messages, e.g. `multiInstanceLoopCharacteristics`. */
export function typeLabel(el: El): string {
  const local = localType(el);
  return local.charAt(0).toLowerCase() + local.slice(1);
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
