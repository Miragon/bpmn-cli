/**
 * Semantic model I/O on top of bpmn-moddle.
 *
 * The AI-facing layer never touches DI. This module owns parsing, serialising,
 * tree traversal and the small set of invariants bpmn-moddle does NOT maintain
 * on its own ($parent links, lazy collections).
 *
 * No file access here (the core also runs in the browser): reading and the
 * atomic write live in src/node/files.ts.
 *
 * Ids: only BPMN and DI elements (bpmn:, bpmndi:, dc:, di:) form the id space
 * (indexById, the duplicate-id check). Vendor extension elements (camunda:,
 * zeebe:, any generic element) and everything inside bpmn:extensionElements
 * carry vendor data: a camunda:formField id only has to be unique within its
 * form, so those ids are never indexed, resolved or checked.
 */
import { BpmnModdle, type ImportWarning } from 'bpmn-moddle';
import type { ModdleElement } from 'moddle';

export type El = ModdleElement;

export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const TARGET_NS = 'http://bpmn.io/schema/bpmn';

export interface Model {
  moddle: BpmnModdle;
  definitions: El;
  /** warnings produced while importing (unknown attributes, dropped elements, ...) */
  importWarnings: ImportWarning[];
}

export class ModelError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export function createModdle(): BpmnModdle {
  return new BpmnModdle();
}

/* ------------------------------------------------------------------ */
/* type helpers                                                        */
/* ------------------------------------------------------------------ */

export function is(el: unknown, type: string): boolean {
  return !!el && typeof el === 'object' && typeof (el as El).$instanceOf === 'function' && (el as El).$instanceOf(type);
}

export function isAny(el: unknown, types: string[]): boolean {
  return types.some((t) => is(el, t));
}

/** Local (unprefixed) type name, e.g. "UserTask" for "bpmn:UserTask". */
export function localType(el: El): string {
  return el.$type.split(':')[1] ?? el.$type;
}

/* ------------------------------------------------------------------ */
/* collections & parenting                                             */
/* ------------------------------------------------------------------ */

/** Returns the (lazily created) many-valued property of an element. */
export function many(el: El, prop: string): El[] {
  return el.get<El[]>(prop);
}

/** True when `prop` is a reference (not containment) property of `el`. */
export function isReferenceProp(el: El, prop: string): boolean {
  const descriptor = el.$descriptor as { propertiesByName?: Record<string, { isReference?: boolean }> };
  return !!descriptor.propertiesByName?.[prop]?.isReference;
}

/** Pushes children into a many-valued property; sets $parent for containment properties. */
export function addTo(parent: El, prop: string, ...children: El[]): void {
  const list = many(parent, prop);
  const contained = !isReferenceProp(parent, prop);
  for (const child of children) {
    if (!list.includes(child)) list.push(child);
    if (contained) child.$parent = parent;
  }
}

/** Inserts children at a given index of a many-valued property; sets $parent for containment. */
export function insertInto(parent: El, prop: string, index: number, ...children: El[]): void {
  const list = many(parent, prop);
  const at = Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, ...children);
  if (!isReferenceProp(parent, prop)) for (const child of children) child.$parent = parent;
}

/** Removes an element from a many-valued property (no cascade). */
export function removeFrom(parent: El, prop: string, child: El): boolean {
  const list = parent.get<El[] | undefined>(prop);
  if (!list) return false;
  const idx = list.indexOf(child);
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}

/** Sets a single-valued property; `undefined` deletes it (bpmn-moddle semantics). */
export function setProp(el: El, prop: string, value: unknown): void {
  el.set(prop, value);
}

/* ------------------------------------------------------------------ */
/* traversal                                                            */
/* ------------------------------------------------------------------ */

function isModdleElement(v: unknown): v is El {
  return !!v && typeof v === 'object' && typeof (v as El).$type === 'string' && '$descriptor' in (v as object);
}

const BPMN_TYPE = /^(bpmn|bpmndi|dc|di):/;

/** True for elements of BPMN itself or its diagram interchange; false for vendor extension elements (typed or generic). */
export function isBpmnElement(el: El): boolean {
  const descriptor = el.$descriptor as { isGeneric?: boolean };
  return !descriptor.isGeneric && BPMN_TYPE.test(el.$type);
}

export interface WalkOptions {
  /**
   * Skip vendor content: elements outside BPMN/DI and the values of
   * bpmn:extensionElements are neither visited nor descended into.
   */
  bpmnOnly?: boolean;
}

/**
 * Depth-first walk over the containment tree (non-reference properties only).
 * Generic "any" elements (vendor extensions) are visited but not descended into
 * beyond their $children; with `bpmnOnly` they are skipped entirely.
 */
export function* walk(root: El, opts: WalkOptions = {}): Generator<El> {
  const seen = new Set<El>();
  const stack: El[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    if (seen.has(el)) continue;
    seen.add(el);
    if (opts.bpmnOnly && !isBpmnElement(el)) continue;
    yield el;
    if (opts.bpmnOnly && is(el, 'bpmn:ExtensionElements')) continue;
    const descriptor = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
    if (descriptor.isGeneric) {
      const children = (el as unknown as { $children?: unknown[] }).$children;
      if (Array.isArray(children)) for (const c of children) if (isModdleElement(c)) stack.push(c);
      continue;
    }
    for (const p of descriptor.properties ?? []) {
      if (p.isReference) continue;
      const v = el.get<unknown>(p.name);
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) if (isModdleElement(v[i])) stack.push(v[i] as El);
      } else if (isModdleElement(v)) {
        stack.push(v);
      }
    }
  }
}

/** Re-establishes $parent for every element in the containment tree. */
export function relink(root: El): void {
  const seen = new Set<El>();
  const visit = (el: El): void => {
    if (seen.has(el)) return;
    seen.add(el);
    const descriptor = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
    if (descriptor.isGeneric) return;
    for (const p of descriptor.properties ?? []) {
      if (p.isReference) continue;
      const v = el.get<unknown>(p.name);
      const kids = Array.isArray(v) ? v : [v];
      for (const k of kids) {
        if (isModdleElement(k)) {
          k.$parent = el;
          visit(k);
        }
      }
    }
  };
  visit(root);
}

/** True for diagram interchange elements (bpmndi:, dc:, di:), which the AI never addresses. */
export function isDiElement(el: El): boolean {
  return /^(bpmndi|dc|di):/.test(el.$type);
}

/**
 * Map of id -> element for the BPMN and DI elements of the containment tree
 * (vendor extension content is never indexed, see the module header). With
 * `semanticOnly` the diagram interchange (shapes, edges, planes) is left out
 * too, so that DI ids are neither resolvable nor suggested.
 */
export function indexById(root: El, opts: { semanticOnly?: boolean } = {}): Map<string, El> {
  const map = new Map<string, El>();
  for (const el of walk(root, { bpmnOnly: true })) {
    if (opts.semanticOnly && isDiElement(el)) continue;
    const id = el.get<string | undefined>('id');
    if (id) map.set(id, el);
  }
  return map;
}

export function findById(model: Model, id: string): El | undefined {
  return indexById(model.definitions).get(id);
}

/** All references to `target` in the tree: [holder, propertyName, isMany]. */
export function findReferences(root: El, target: El): Array<{ holder: El; prop: string; isMany: boolean }> {
  const refs: Array<{ holder: El; prop: string; isMany: boolean }> = [];
  for (const el of walk(root)) {
    const descriptor = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean; isMany?: boolean }> };
    if (descriptor.isGeneric) continue;
    for (const p of descriptor.properties ?? []) {
      if (!p.isReference) continue;
      const v = el.get<unknown>(p.name);
      if (p.isMany) {
        if (Array.isArray(v) && v.includes(target)) refs.push({ holder: el, prop: p.name, isMany: true });
      } else if (v === target) {
        refs.push({ holder: el, prop: p.name, isMany: false });
      }
    }
  }
  return refs;
}

/* ------------------------------------------------------------------ */
/* roots                                                                */
/* ------------------------------------------------------------------ */

export function rootElements(defs: El): El[] {
  return many(defs, 'rootElements');
}

export function processes(defs: El): El[] {
  return rootElements(defs).filter((e) => is(e, 'bpmn:Process'));
}

export function collaboration(defs: El): El | undefined {
  return rootElements(defs).find((e) => is(e, 'bpmn:Collaboration'));
}

/**
 * The element bpmn-auto-layout will lay out: the collaboration if one exists,
 * else the first process.
 */
export function layoutRoot(defs: El): El | undefined {
  return collaboration(defs) ?? processes(defs)[0];
}

/* ------------------------------------------------------------------ */
/* parse / serialise                                                    */
/* ------------------------------------------------------------------ */

export async function parseXml(xml: string, moddle: BpmnModdle = createModdle()): Promise<Model> {
  let result;
  const overwrites = watchOverwrites(moddle);
  try {
    result = await moddle.fromXML(xml);
  } catch (err) {
    const e = err as Error & { warnings?: ImportWarning[] };
    throw new ModelError(`Cannot parse BPMN XML: ${e.message.split('\n')[0]}`, 'PARSE_ERROR', {
      message: e.message,
      warnings: (e.warnings ?? []).map((w) => w.message),
    });
  } finally {
    overwrites.stop();
  }
  const definitions = result.rootElement;
  if (!is(definitions, 'bpmn:Definitions')) {
    throw new ModelError('Root element is not bpmn:Definitions', 'PARSE_ERROR');
  }
  return { moddle, definitions, importWarnings: [...result.warnings, ...overwrites.warnings()] };
}

/** `<bpmn:userTask id="Activity_X">` / `standardLoopCharacteristics SL` for import warnings. */
function elementText(el: El, tag = false): string {
  const id = (el as unknown as Record<string, unknown>)['id'];
  const local = localType(el);
  const name = local.charAt(0).toLowerCase() + local.slice(1);
  if (tag) return `<${el.$type.split(':')[0]}:${name}${typeof id === 'string' ? ` id="${id}"` : ''}>`;
  return `${name}${typeof id === 'string' ? ` ${id}` : ''}`;
}

/**
 * Watches bpmn-moddle while it reads a file: a BPMN element that appears
 * twice where the schema allows one (two loopCharacteristics on a task, two
 * extensionElements, two conditionExpressions) is silently overwritten by
 * the reader, the first one is lost. Each overwrite becomes an import warning
 * (`duplicate element: ...`), which document.ts counts as lossy: the file can
 * be read and shown, but writing it back (and losing the first element)
 * needs --force (E_IMPORT_LOSSY). Only the semantic model is watched (diagram
 * interchange is redrawn anyway).
 */
function watchOverwrites(moddle: BpmnModdle): { stop(): void; warnings(): ImportWarning[] } {
  type Props = { set(target: El, name: string, value: unknown): void };
  const props = (moddle as unknown as { properties: Props }).properties;
  const own = Object.prototype.hasOwnProperty.call(props, 'set');
  const original = props.set;
  const found: Array<{ holder: El; prop: string; lost: El; kept: El }> = [];
  props.set = function set(this: Props, target: El, name: string, value: unknown): void {
    if (value && typeof value === 'object' && typeof (value as El).$type === 'string' && /^bpmn:/.test(target.$type)) {
      const p = (target.$descriptor as { propertiesByName?: Record<string, { name: string; isMany?: boolean; isReference?: boolean }> }).propertiesByName?.[name];
      const current = p && !p.isMany && !p.isReference && Object.prototype.hasOwnProperty.call(target, p.name) ? (target as unknown as Record<string, unknown>)[p.name] : undefined;
      if (current && current !== value && typeof current === 'object' && typeof (current as El).$type === 'string') found.push({ holder: target, prop: p!.name, lost: current as El, kept: value as El });
    }
    original.call(this, target, name, value);
  };
  return {
    stop(): void {
      if (own) props.set = original;
      else delete (props as Partial<Props>).set;
    },
    warnings(): ImportWarning[] {
      return found.map(({ holder, prop, lost, kept }) => ({
        message: `duplicate element: ${elementText(holder, true)} has more than one ${prop} (the schema allows one); only the last one, ${elementText(kept)}, can be kept, ${elementText(lost)} would be dropped`,
        element: holder,
        property: prop,
      }));
    },
  };
}

export async function serialize(model: Model): Promise<string> {
  const { xml } = await model.moddle.toXML(model.definitions, { format: true });
  return xml;
}

/** Creates a fresh definitions element with one process. */
export function createDefinitions(
  moddle: BpmnModdle,
  opts: { definitionsId?: string; processId: string; processName?: string; executable?: boolean },
): El {
  const defs = moddle.create('bpmn:Definitions', {
    id: opts.definitionsId ?? 'Definitions_1',
    targetNamespace: TARGET_NS,
  });
  const process = moddle.create('bpmn:Process', {
    id: opts.processId,
    ...(opts.processName ? { name: opts.processName } : {}),
    isExecutable: opts.executable ?? true,
  });
  addTo(defs, 'rootElements', process);
  return defs;
}
