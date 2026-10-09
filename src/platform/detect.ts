/**
 * Which engine a file targets: the one detector behind the validation
 * profile (detectPlatform / resolvePlatform) and Doc.platform()
 * (platform/descriptor.ts platformOf, used when the CLI creates content).
 *
 * Order of evidence:
 *  1. an explicit choice (`validate --platform c7|c8|none`, MutationOptions.platform);
 *  2. `modeler:executionPlatform` on bpmn:definitions (what Camunda Modeler
 *     writes): "Camunda Platform" -> c7, "Camunda Cloud" -> c8 (also
 *     "Camunda 7/8", "Operaton", "CIB seven", "Zeebe");
 *  3. the vendor namespace the content actually uses: camunda:* or operaton:*
 *     attributes and extension elements -> c7, zeebe:* -> c8; both -> the one
 *     used more often;
 *  4. a declared but unused namespace (xmlns:camunda or xmlns:operaton
 *     without xmlns:zeebe -> c7, and the other way round);
 *  otherwise none (plain BPMN: no profile runs).
 *
 * The Camunda 7 family (c7) is Camunda 7, CIB seven and Operaton. They read
 * the camunda namespace; Operaton also reads its own namespace (first, with
 * camunda as the fallback), which Camunda 7 and CIB seven ignore. A file that
 * uses the operaton namespace therefore targets Operaton: `operaton` says so
 * (and the detail line), and the profile reads its content the way Operaton
 * does (platform/c7.ts).
 */
import { KNOWN_NAMESPACES, type Doc } from '../document.js';
import { isBpmnElement, walk, type El } from '../model.js';
import { CAMUNDA_URI, C7_URIS, OPERATON_URI, ZEEBE_URI } from './descriptor.js';

export { C7_URIS, OPERATON_URI } from './descriptor.js';
export const MODELER_URI = 'http://camunda.org/schema/modeler/1.0';

export type Platform = 'c7' | 'c8' | 'none';
export type PlatformChoice = Platform | 'auto';
export const PLATFORM_CHOICES: readonly PlatformChoice[] = ['auto', 'c7', 'c8', 'none'];

export interface PlatformInfo {
  platform: Platform;
  /** what decided it */
  source: 'option' | 'executionPlatform' | 'namespace-use' | 'namespace-declaration' | 'none';
  /** one line for humans, e.g. `modeler:executionPlatform "Camunda Platform"` */
  detail: string;
  /**
   * c7 only: true when the file uses the operaton namespace, which only
   * Operaton reads (Camunda 7 and CIB seven ignore it); the profile then reads
   * operaton:* before camunda:* like Operaton does.
   */
  operaton?: boolean;
}

type Source = Doc | El;

function definitionsOf(source: Source): El {
  return (source as Doc).definitions ?? (source as El);
}

/** prefix -> namespace URI for every xmlns declaration in the document (definitions first). */
export function namespaceMap(source: Source): Map<string, string> {
  const definitions = definitionsOf(source);
  const map = new Map<string, string>();
  const take = (attrs: Record<string, unknown> | undefined): void => {
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (k.startsWith('xmlns:') && typeof v === 'string' && !map.has(k.slice(6))) map.set(k.slice(6), v);
    }
  };
  take(definitions.$attrs as Record<string, unknown>);
  for (const el of walk(definitions)) {
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
export function namespaceUsage(source: Source, ns = namespaceMap(source)): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (uri: string | undefined): void => {
    if (uri) counts.set(uri, (counts.get(uri) ?? 0) + 1);
  };
  for (const el of walk(definitionsOf(source))) {
    if (isBpmnElement(el)) {
      for (const k of Object.keys(el.$attrs ?? {})) bump(uriOfName(k, ns));
    } else {
      bump(uriOfElement(el, ns));
    }
  }
  return counts;
}

/** The executionPlatform attribute of bpmn:definitions (any prefix bound to the modeler namespace). */
export function executionPlatform(source: Source, ns = namespaceMap(source)): string | undefined {
  for (const [k, v] of Object.entries(definitionsOf(source).$attrs ?? {})) {
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

const OPERATON_NOTE = 'only Operaton reads the operaton namespace, Camunda 7 and CIB seven ignore it';

/** Detects the target engine from bpmn:definitions (see the module header). */
export function detectPlatformOf(definitions: El): PlatformInfo {
  const ns = namespaceMap(definitions);
  const usage = namespaceUsage(definitions, ns);
  const camunda = usage.get(CAMUNDA_URI) ?? 0;
  const operaton = usage.get(OPERATON_URI) ?? 0;
  const c7 = [...C7_URIS].reduce((n, uri) => n + (usage.get(uri) ?? 0), 0);
  const c8 = usage.get(ZEEBE_URI) ?? 0;
  const declared = executionPlatform(definitions, ns);
  const withOperaton = (info: PlatformInfo): PlatformInfo =>
    info.platform === 'c7' && operaton > 0 ? { ...info, operaton: true, ...(info.source === 'namespace-use' ? {} : { detail: `${info.detail}; ${operaton} operaton attribute(s)/element(s): ${OPERATON_NOTE}` }) } : info;
  if (declared !== undefined) {
    const p = fromExecutionPlatform(declared);
    if (p) return withOperaton({ platform: p, source: 'executionPlatform', detail: `modeler:executionPlatform "${declared}"` });
  }
  if (c7 || c8) {
    const platform: Platform = c7 >= c8 ? 'c7' : 'c8';
    const parts = [camunda ? `${camunda} camunda` : '', operaton ? `${operaton} operaton` : '', c8 ? `${c8} zeebe` : ''].filter(Boolean).join(' and ');
    const note = platform === 'c7' && operaton ? `; ${OPERATON_NOTE}` : '';
    return withOperaton({ platform, source: 'namespace-use', detail: `${parts} attribute(s)/element(s)${note}` });
  }
  const uris = new Set(ns.values());
  const declaredC7 = [...C7_URIS].filter((u) => uris.has(u));
  const declaresC8 = uris.has(ZEEBE_URI);
  const prefixOf = (uri: string): string => [...ns.entries()].find(([, u]) => u === uri)?.[0] ?? '';
  if (declaredC7.length > 0 !== declaresC8) {
    const decl = declaresC8 ? `xmlns:${prefixOf(ZEEBE_URI)}` : declaredC7.map((u) => `xmlns:${prefixOf(u)}`).join(' and ');
    return { platform: declaresC8 ? 'c8' : 'c7', source: 'namespace-declaration', detail: `${decl} declared (no vendor content yet)` };
  }
  if (declaredC7.length && declaresC8) {
    const decl = [...declaredC7.map((u) => `xmlns:${prefixOf(u)}`), `xmlns:${prefixOf(ZEEBE_URI)}`].join(' and ');
    return { platform: 'none', source: 'none', detail: `${decl} declared, but no vendor content tells which engine` };
  }
  return { platform: 'none', source: 'none', detail: declared !== undefined ? `unknown modeler:executionPlatform "${declared}", no vendor content` : 'no executionPlatform and no vendor namespace' };
}

/** Detects the target engine of a document (see the module header). */
export function detectPlatform(doc: Doc): PlatformInfo {
  return detectPlatformOf(doc.definitions);
}

/** The platform for a choice: an explicit one wins, `auto` detects. */
export function resolvePlatform(doc: Doc, choice: PlatformChoice = 'auto'): PlatformInfo {
  if (choice === 'auto') return detectPlatform(doc);
  const info: PlatformInfo = { platform: choice, source: 'option', detail: '--platform option' };
  if (choice !== 'c7') return info;
  // the explicit choice says which profile runs; how Operaton content is read still comes from the file
  const detected = detectPlatform(doc);
  return detected.operaton ? { ...info, operaton: true, detail: `--platform option; the file uses the operaton namespace: ${OPERATON_NOTE}` } : info;
}
