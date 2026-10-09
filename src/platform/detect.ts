/**
 * Which engine a file targets, for the platform validation profile.
 *
 * Order of evidence:
 *  1. an explicit choice (`validate --platform c7|c8|none`, MutationOptions.platform);
 *  2. `modeler:executionPlatform` on bpmn:definitions (what Camunda Modeler
 *     writes): "Camunda Platform" -> c7, "Camunda Cloud" -> c8;
 *  3. the vendor namespace the content actually uses: camunda:* attributes or
 *     extension elements -> c7 (CIB seven and Operaton read the camunda
 *     namespace too; Operaton's own namespace counts as c7 as well), zeebe:*
 *     -> c8; both -> the one used more often;
 *  4. a declared but unused namespace (xmlns:camunda without xmlns:zeebe -> c7,
 *     and the other way round);
 *  otherwise none (plain BPMN: no profile runs).
 *
 * platform/descriptor.ts platformOf() answers the same question cheaply from
 * the declarations alone (used when the CLI creates content); this module
 * adds the usage count and says why it decided.
 */
import { KNOWN_NAMESPACES, type Doc } from '../document.js';
import { isBpmnElement, walk, type El } from '../model.js';
import { CAMUNDA_URI, ZEEBE_URI } from './descriptor.js';

export const MODELER_URI = 'http://camunda.org/schema/modeler/1.0';
/** Operaton's own namespace (Operaton also reads the camunda namespace). */
export const OPERATON_URI = 'http://operaton.org/schema/1.0/bpmn';
/** Namespaces whose content the Camunda 7 profile checks. */
export const C7_URIS: ReadonlySet<string> = new Set([CAMUNDA_URI, OPERATON_URI]);

export type Platform = 'c7' | 'c8' | 'none';
export type PlatformChoice = Platform | 'auto';
export const PLATFORM_CHOICES: readonly PlatformChoice[] = ['auto', 'c7', 'c8', 'none'];

export interface PlatformInfo {
  platform: Platform;
  /** what decided it */
  source: 'option' | 'executionPlatform' | 'namespace-use' | 'namespace-declaration' | 'none';
  /** one line for humans, e.g. `modeler:executionPlatform "Camunda Platform"` */
  detail: string;
}

/** prefix -> namespace URI for every xmlns declaration in the document (definitions first). */
export function namespaceMap(doc: Doc): Map<string, string> {
  const map = new Map<string, string>();
  const take = (attrs: Record<string, unknown> | undefined): void => {
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (k.startsWith('xmlns:') && typeof v === 'string' && !map.has(k.slice(6))) map.set(k.slice(6), v);
    }
  };
  take(doc.definitions.$attrs as Record<string, unknown>);
  for (const el of walk(doc.definitions)) {
    if (isBpmnElement(el)) take(el.$attrs as Record<string, unknown>);
    else take(el as unknown as Record<string, unknown>);
  }
  return map;
}

/** Namespace URI of a prefixed name (`camunda:assignee`): the document's declaration, else the well-known prefix. */
export function uriOfName(name: string, ns: Map<string, string>): string | undefined {
  const i = name.indexOf(':');
  if (i <= 0) return undefined;
  const prefix = name.slice(0, i);
  if (prefix === 'xmlns') return undefined;
  return ns.get(prefix) ?? KNOWN_NAMESPACES[prefix];
}

/** Namespace URI of a generic (vendor) element. */
export function uriOfElement(el: El, ns: Map<string, string>): string | undefined {
  const d = el.$descriptor as { isGeneric?: boolean; ns?: { uri?: string } };
  return d.ns?.uri ?? uriOfName(el.$type, ns);
}

/** How often each namespace URI is used by attributes and elements of the document. */
export function namespaceUsage(doc: Doc, ns = namespaceMap(doc)): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (uri: string | undefined): void => {
    if (uri) counts.set(uri, (counts.get(uri) ?? 0) + 1);
  };
  for (const el of walk(doc.definitions)) {
    if (isBpmnElement(el)) {
      for (const k of Object.keys(el.$attrs ?? {})) bump(uriOfName(k, ns));
    } else {
      bump(uriOfElement(el, ns));
    }
  }
  return counts;
}

/** The executionPlatform attribute of bpmn:definitions (any prefix bound to the modeler namespace). */
export function executionPlatform(doc: Doc, ns = namespaceMap(doc)): string | undefined {
  for (const [k, v] of Object.entries(doc.definitions.$attrs ?? {})) {
    if (!k.endsWith(':executionPlatform') && k !== 'executionPlatform') continue;
    const uri = uriOfName(k, ns);
    if (uri && uri !== MODELER_URI) continue;
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function fromExecutionPlatform(value: string): Platform | undefined {
  const v = value.trim().toLowerCase();
  if (v.startsWith('camunda platform') || v.startsWith('camunda 7') || v.startsWith('operaton') || v.startsWith('cib seven') || v.startsWith('cibseven')) return 'c7';
  if (v.startsWith('camunda cloud') || v.startsWith('camunda 8') || v.startsWith('zeebe')) return 'c8';
  return undefined;
}

/** Detects the target engine of a document (see the module header). */
export function detectPlatform(doc: Doc): PlatformInfo {
  const ns = namespaceMap(doc);
  const declared = executionPlatform(doc, ns);
  if (declared !== undefined) {
    const p = fromExecutionPlatform(declared);
    if (p) return { platform: p, source: 'executionPlatform', detail: `modeler:executionPlatform "${declared}"` };
  }
  const usage = namespaceUsage(doc, ns);
  const c7 = [...C7_URIS].reduce((n, uri) => n + (usage.get(uri) ?? 0), 0);
  const c8 = usage.get(ZEEBE_URI) ?? 0;
  if (c7 || c8) {
    const platform: Platform = c7 >= c8 ? 'c7' : 'c8';
    const parts = [c7 ? `${c7} camunda` : '', c8 ? `${c8} zeebe` : ''].filter(Boolean).join(' and ');
    return { platform, source: 'namespace-use', detail: `${parts} attribute(s)/element(s)` };
  }
  const uris = new Set(ns.values());
  const declaresC7 = [...C7_URIS].some((u) => uris.has(u));
  const declaresC8 = uris.has(ZEEBE_URI);
  if (declaresC7 !== declaresC8) {
    return { platform: declaresC7 ? 'c7' : 'c8', source: 'namespace-declaration', detail: `xmlns:${declaresC7 ? 'camunda' : 'zeebe'} declared (no vendor content yet)` };
  }
  return { platform: 'none', source: 'none', detail: declared !== undefined ? `unknown modeler:executionPlatform "${declared}", no vendor content` : 'no executionPlatform and no vendor namespace' };
}

/** The platform for a choice: an explicit one wins, `auto` detects. */
export function resolvePlatform(doc: Doc, choice: PlatformChoice = 'auto'): PlatformInfo {
  if (choice !== 'auto') return { platform: choice, source: 'option', detail: '--platform option' };
  return detectPlatform(doc);
}
