import { kindLabel } from './kinds.js';
import { localType, type El } from './moddle.js';

/** The subset of a moddle property descriptor the mutations rely on. */
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

/** `userTask Activity_Check "Check"` */
export function labelOf(el: El): string {
  const name = el.get<string | undefined>('name');
  return `${kindLabel(el)} ${el.get<string>('id')}${name ? ` "${name}"` : ''}`;
}

export function isEl(v: unknown): v is El {
  return !!v && typeof v === 'object' && typeof (v as El).$type === 'string';
}

/** `multiInstanceLoopCharacteristics` */
export function typeLabel(el: El): string {
  const local = localType(el);
  return local.charAt(0).toLowerCase() + local.slice(1);
}

export function vendorAttributes(el: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.$attrs ?? {})) {
    if (!k.includes(':') || k.startsWith('xmlns') || k.startsWith('xsi:') || k.startsWith('xml:') || v === undefined || v === null || typeof v === 'object') continue;
    out[k] = String(v);
  }
  return out;
}

export function vendorContent(def: El): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(def.$attrs ?? {})) if (!k.startsWith('xmlns') && !k.startsWith('xsi:') && typeof v !== 'object') out.push(k);
  for (const ext of def.get<El | undefined>('extensionElements')?.get<El[] | undefined>('values') ?? []) out.push(ext.$type);
  if ((def.get<El[] | undefined>('documentation') ?? []).length) out.push('documentation');
  return out;
}
