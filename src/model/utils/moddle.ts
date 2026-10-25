/**
 * Semantic model I/O on top of bpmn-moddle, plus the invariants it does not maintain itself
 * ($parent links, lazy collections). No file access: the core also runs in the browser.
 * Only BPMN and DI ids form the id space: a camunda:formField id is unique only in its form.
 */
import { BpmnModdle, type ImportResult, type ImportWarning } from 'bpmn-moddle';
import type { ModdleElement } from 'moddle';
import { ModelError } from '../ModelError.js';

export type El = ModdleElement;

export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const TARGET_NS = 'http://bpmn.io/schema/bpmn';

export interface Model {
  moddle: BpmnModdle;
  definitions: El;
  importWarnings: ImportWarning[];
}

export function createModdle(): BpmnModdle {
  return new BpmnModdle();
}

export function idOf(el: El): string {
  return el.get<string>('id');
}

/** Unlike `el.get`, never makes bpmn-moddle create an empty collection. */
export function peek<T>(el: El | undefined, prop: string): T | undefined {
  return el ? ((el as unknown as Record<string, unknown>)[prop] as T | undefined) : undefined;
}

export function list(el: El | undefined, prop: string): El[] {
  const v = peek<unknown>(el, prop);
  return Array.isArray(v) ? (v as El[]) : [];
}

export function shownId(el: El | undefined): string {
  return peek<string>(el, 'id') ?? '?';
}

export function is(el: unknown, type: string): boolean {
  return !!el && typeof el === 'object' && typeof (el as El).$instanceOf === 'function' && (el as El).$instanceOf(type);
}

export function isAny(el: unknown, types: string[]): boolean {
  return types.some((t) => is(el, t));
}

/** A group has no `name`: it is the value of its category value. */
export function groupName(group: El): string | undefined {
  return group.get<El | undefined>('categoryValueRef')?.get<string | undefined>('value') || undefined;
}

export function nameOf(el: El): string | undefined {
  return is(el, 'bpmn:Group') ? groupName(el) : el.get<string | undefined>('name');
}

export function localType(el: El): string {
  return el.$type.split(':')[1] ?? el.$type;
}

export function many(el: El, prop: string): El[] {
  return el.get<El[]>(prop);
}

export function isReferenceProp(el: El, prop: string): boolean {
  const descriptor = el.$descriptor as { propertiesByName?: Record<string, { isReference?: boolean }> };
  return !!descriptor.propertiesByName?.[prop]?.isReference;
}

export function addTo(parent: El, prop: string, ...children: El[]): void {
  const list = many(parent, prop);
  const contained = !isReferenceProp(parent, prop);
  for (const child of children) {
    if (!list.includes(child)) list.push(child);
    if (contained) child.$parent = parent;
  }
}

export function insertInto(parent: El, prop: string, index: number, ...children: El[]): void {
  const list = many(parent, prop);
  const at = Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, ...children);
  if (!isReferenceProp(parent, prop)) for (const child of children) child.$parent = parent;
}

/** No cascade. */
export function removeFrom(parent: El, prop: string, child: El): boolean {
  const list = parent.get<El[] | undefined>(prop);
  if (!list) return false;
  const idx = list.indexOf(child);
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}

/** `undefined` deletes the property. */
export function setProp(el: El, prop: string, value: unknown): void {
  el.set(prop, value);
}

function isModdleElement(v: unknown): v is El {
  return !!v && typeof v === 'object' && typeof (v as El).$type === 'string' && '$descriptor' in (v as object);
}

const BPMN_TYPE = /^(bpmn|bpmndi|dc|di):/;

/** False for vendor extension elements, typed or generic. */
export function isBpmnElement(el: El): boolean {
  const descriptor = el.$descriptor as { isGeneric?: boolean };
  return !descriptor.isGeneric && BPMN_TYPE.test(el.$type);
}

export interface WalkOptions {
  /** skip vendor elements and everything inside bpmn:extensionElements */
  bpmnOnly?: boolean;
}

/** Depth-first over containment; generic vendor elements are entered only through $children. */
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

export function isDiElement(el: El): boolean {
  return /^(bpmndi|dc|di):/.test(el.$type);
}

/** `semanticOnly` leaves out DI too, so DI ids are neither resolvable nor suggested. */
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

export function rootElements(defs: El): El[] {
  return many(defs, 'rootElements');
}

export function processes(defs: El): El[] {
  return rootElements(defs).filter((e) => is(e, 'bpmn:Process'));
}

export function collaboration(defs: El): El | undefined {
  return rootElements(defs).find((e) => is(e, 'bpmn:Collaboration'));
}

/** What bpmn-auto-layout lays out. */
export function layoutRoot(defs: El): El | undefined {
  return collaboration(defs) ?? processes(defs)[0];
}

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
  return { moddle, definitions, importWarnings: [...resolvePaddedReferences(result), ...overwrites.warnings()] };
}

/**
 * The XSD types IDREF and QName collapse whitespace, but bpmn-moddle looks up a padded reference
 * as written and drops it ("unresolved reference"). Resolves those by the trimmed id instead.
 */
function resolvePaddedReferences(result: ImportResult): ImportWarning[] {
  const byId = result.elementsById;
  const padded = result.references.filter((r) => r.id !== r.id.trim() && !byId[r.id] && byId[r.id.trim()]);
  if (!padded.length) return result.warnings;
  const rebuilt = new Map<El, Set<string>>();
  for (const r of padded) {
    const property = (r.element.$descriptor as { propertiesByName?: Record<string, { name: string; isMany?: boolean }> }).propertiesByName?.[r.property];
    if (!property) continue;
    if (!property.isMany) {
      r.element.set(property.name, byId[r.id.trim()]);
      continue;
    }
    const seen = rebuilt.get(r.element) ?? new Set<string>();
    rebuilt.set(r.element, seen);
    if (seen.has(r.property)) continue;
    seen.add(r.property);
    // the property's references in document order, each resolved as written or trimmed
    const list = result.references.filter((x) => x.element === r.element && x.property === r.property).map((x) => byId[x.id] ?? byId[x.id.trim()]).filter((x): x is El => !!x);
    const collection = r.element.get<El[]>(property.name);
    collection.splice(0, collection.length, ...list);
  }
  return result.warnings.filter((w) => !(/^unresolved reference/.test(w.message) && padded.some((r) => r.element === w.element && r.property === w.property && r.id === w.value)));
}

function elementText(el: El, tag = false): string {
  const id = (el as unknown as Record<string, unknown>)['id'];
  const local = localType(el);
  const name = local.charAt(0).toLowerCase() + local.slice(1);
  if (tag) return `<${el.$type.split(':')[0]}:${name}${typeof id === 'string' ? ` id="${id}"` : ''}>`;
  return `${name}${typeof id === 'string' ? ` ${id}` : ''}`;
}

/**
 * bpmn-moddle silently keeps only the last of an element the schema allows once (two
 * loopCharacteristics on a task): each overwrite becomes a lossy `duplicate element` warning.
 * DI is not watched, it is redrawn anyway.
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
