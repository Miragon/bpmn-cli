import { kindLabel } from '../Kinds.js';
import type { El } from './moddle.js';

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

/** `userTask userTask_check "Check"` */
export function labelOf(el: El): string {
  const name = el.get<string | undefined>('name');
  return `${kindLabel(el)} ${el.get<string>('id')}${name ? ` "${name}"` : ''}`;
}

export function isEl(value: unknown): value is El {
  return !!value && typeof value === 'object' && typeof (value as El).$type === 'string';
}

export function vendorAttributes(el: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [attrName, attrValue] of Object.entries(el.$attrs ?? {})) {
    if (!attrName.includes(':') || attrName.startsWith('xmlns') || attrName.startsWith('xsi:') || attrName.startsWith('xml:') || attrValue === undefined || attrValue === null || typeof attrValue === 'object') continue;
    out[attrName] = String(attrValue);
  }
  return out;
}

export function vendorContent(def: El): string[] {
  const out: string[] = [];
  for (const [attrName, attrValue] of Object.entries(def.$attrs ?? {})) if (!attrName.startsWith('xmlns') && !attrName.startsWith('xsi:') && typeof attrValue !== 'object') out.push(attrName);
  for (const ext of def.get<El | undefined>('extensionElements')?.get<El[] | undefined>('values') ?? []) out.push(ext.$type);
  if ((def.get<El[] | undefined>('documentation') ?? []).length) out.push('documentation');
  return out;
}
