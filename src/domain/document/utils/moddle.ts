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
const TARGET_NS = 'http://bpmn.io/schema/bpmn';

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
export function peek<TValue>(el: El | undefined, prop: string): TValue | undefined {
  return el ? ((el as unknown as Record<string, unknown>)[prop] as TValue | undefined) : undefined;
}

export function list(el: El | undefined, prop: string): El[] {
  const value = peek<unknown>(el, prop);
  return Array.isArray(value) ? (value as El[]) : [];
}

export function shownId(el: El | undefined): string {
  return peek<string>(el, 'id') ?? '?';
}

export function is(el: unknown, type: string): boolean {
  return !!el && typeof el === 'object' && typeof (el as El).$instanceOf === 'function' && (el as El).$instanceOf(type);
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

function isReferenceProp(el: El, prop: string): boolean {
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

function isModdleElement(value: unknown): value is El {
  return !!value && typeof value === 'object' && typeof (value as El).$type === 'string' && '$descriptor' in (value as object);
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
      if (Array.isArray(children)) for (const child of children) if (isModdleElement(child)) stack.push(child);
      continue;
    }
    for (const property of descriptor.properties ?? []) {
      if (property.isReference) continue;
      const value = el.get<unknown>(property.name);
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--) if (isModdleElement(value[index])) stack.push(value[index] as El);
      } else if (isModdleElement(value)) {
        stack.push(value);
      }
    }
  }
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

export function findReferences(root: El, target: El): Array<{ holder: El; prop: string; isMany: boolean }> {
  const refs: Array<{ holder: El; prop: string; isMany: boolean }> = [];
  for (const el of walk(root)) {
    const descriptor = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean; isMany?: boolean }> };
    if (descriptor.isGeneric) continue;
    for (const property of descriptor.properties ?? []) {
      if (!property.isReference) continue;
      const value = el.get<unknown>(property.name);
      if (property.isMany) {
        if (Array.isArray(value) && value.includes(target)) refs.push({ holder: el, prop: property.name, isMany: true });
      } else if (value === target) {
        refs.push({ holder: el, prop: property.name, isMany: false });
      }
    }
  }
  return refs;
}

function rootElements(defs: El): El[] {
  return many(defs, 'rootElements');
}

export function processes(defs: El): El[] {
  return rootElements(defs).filter((element) => is(element, 'bpmn:Process'));
}

export function collaboration(defs: El): El | undefined {
  return rootElements(defs).find((element) => is(element, 'bpmn:Collaboration'));
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
    const error = err as Error & { warnings?: ImportWarning[] };
    throw new ModelError(`Cannot parse BPMN XML: ${error.message.split('\n')[0]}`, 'PARSE_ERROR', {
      message: error.message,
      warnings: (error.warnings ?? []).map((warning) => warning.message),
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
 * Each property's references are set in document order, each resolved as written or trimmed.
 */
function resolvePaddedReferences(result: ImportResult): ImportWarning[] {
  const byId = result.elementsById;
  const padded = result.references.filter((reference) => reference.id !== reference.id.trim() && !byId[reference.id] && byId[reference.id.trim()]);
  if (!padded.length) return result.warnings;
  const rebuilt = new Map<El, Set<string>>();
  for (const reference of padded) {
    const property = (reference.element.$descriptor as { propertiesByName?: Record<string, { name: string; isMany?: boolean }> }).propertiesByName?.[reference.property];
    if (!property) continue;
    if (!property.isMany) {
      reference.element.set(property.name, byId[reference.id.trim()]);
      continue;
    }
    const seen = rebuilt.get(reference.element) ?? new Set<string>();
    rebuilt.set(reference.element, seen);
    if (seen.has(reference.property)) continue;
    seen.add(reference.property);
    const list = result.references.filter((sibling) => sibling.element === reference.element && sibling.property === reference.property).map((sibling) => byId[sibling.id] ?? byId[sibling.id.trim()]).filter((sibling): sibling is El => !!sibling);
    const collection = reference.element.get<El[]>(property.name);
    collection.splice(0, collection.length, ...list);
  }
  return result.warnings.filter((warning) => !(/^unresolved reference/.test(warning.message) && padded.some((reference) => reference.element === warning.element && reference.property === warning.property && reference.id === warning.value)));
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
      const property = (target.$descriptor as { propertiesByName?: Record<string, { name: string; isMany?: boolean; isReference?: boolean }> }).propertiesByName?.[name];
      const current = property && !property.isMany && !property.isReference && Object.prototype.hasOwnProperty.call(target, property.name) ? (target as unknown as Record<string, unknown>)[property.name] : undefined;
      if (current && current !== value && typeof current === 'object' && typeof (current as El).$type === 'string') found.push({ holder: target, prop: property!.name, lost: current as El, kept: value as El });
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
