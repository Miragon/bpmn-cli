/**
 * Read-only lookup over the Camunda 7 descriptor (`camunda-bpmn-moddle`,
 * resources/camunda.json, inlined as camunda-descriptor.ts), used for
 * validation and for placing vendor attributes on the right element.
 *
 * The descriptor is DATA here: it is never registered with a BpmnModdle
 * instance. Registering it would make camunda content typed, which changes
 * how files are parsed and serialised (attribute order, defaults, dropped
 * unknown content) and breaks the byte-stable roundtrip. Camunda content
 * therefore stays generic in the model (`el.$attrs['camunda:assignee']`,
 * generic `camunda:inputOutput` elements); this module only answers
 * questions about it.
 *
 * Names: every function accepts prefixed or bare names in either spelling
 * (`camunda:assignee` / `assignee`; `camunda:inputOutput` / `camunda:InputOutput`
 * / `InputOutput`). Results use the XML spelling: attributes `camunda:<name>`,
 * element types `camunda:<lowerCamel>` (what generic elements carry as `$type`).
 * BPMN types are `bpmn:<Type>` (what `is(el, type)` takes).
 *
 * API:
 *  - camundaAttr(name)          -> { name, type, owners } for a camunda ATTRIBUTE of a
 *                                  BPMN element (owners = BPMN types that carry it, with
 *                                  camunda mixins such as AsyncCapable resolved), or undefined
 *  - camundaAttrs()             -> all of them
 *  - attrAppliesTo(name, el)    -> true / false (undefined: not a known camunda attribute)
 *  - camundaAttrsFor(el)        -> the camunda attributes a BPMN element may carry
 *  - isCamundaType(name)        -> true for camunda EXTENSION ELEMENT types (inputOutput, formField, ...)
 *  - camundaType(name)          -> { name, type, allowedIn, properties, bpmnSuperTypes }
 *  - allowedOn(name, el)        -> whether that extension element may sit in el's extensionElements
 *  - allowedParents(name)       -> where an extension element may appear: BPMN types (in
 *                                  bpmn:extensionElements), '*' (anywhere) or camunda element
 *                                  types (as a child, e.g. camunda:connector); [] = only nested
 *  - containersOf(name)         -> camunda element types that hold this one as a child
 *                                  (camunda:inputParameter -> camunda:inputOutput)
 *  - idReferenceAttrs()         -> id-valued attributes of camunda extension elements
 *                                  (camunda:errorEventDefinition@errorRef -> bpmn:Error)
 *  - typeIs(bpmnType, superType) -> BPMN type hierarchy check without an element
 *  - platformOf(definitions)    -> 'camunda7' | 'camunda8' | undefined (the engine a file targets;
 *                                  the same decision as platform/detect.ts detectPlatform)
 *  - isC7Uri(uri) / C7_URIS     -> the namespaces this descriptor describes by local name: camunda
 *                                  and Operaton's copy of it (operaton:asyncBefore is camunda:asyncBefore)
 *  - C7_DEFAULT_TTL / C7_PLATFORM_VERSION -> what `new --target camunda7` writes
 *
 * Two placement lists of the descriptor are corrected to what the engines
 * accept (ALLOWED_IN_OVERRIDES): camunda:executionListener and camunda:potentialStarter.
 */
import { createModdle, type El } from '../model.js';
import { CAMUNDA_DESCRIPTOR } from './camunda-descriptor.js';
import { detectPlatformOf } from './detect.js';

export const CAMUNDA_PREFIX = 'camunda';
export const CAMUNDA_URI = 'http://camunda.org/schema/1.0/bpmn';
/**
 * Operaton's own namespace. Its element and attribute types are the camunda
 * ones under another URI. Operaton 2.1 reads it first and falls back to the
 * camunda namespace; Camunda 7 and CIB seven ignore it (engine-checked).
 */
export const OPERATON_URI = 'http://operaton.org/schema/1.0/bpmn';
/** Namespaces whose content this descriptor describes, by local name (the Camunda 7 family). */
export const C7_URIS: ReadonlySet<string> = new Set([CAMUNDA_URI, OPERATON_URI]);

/** True for the camunda and the operaton namespace: look their names up here by local name. */
export function isC7Uri(uri: string | undefined): boolean {
  return uri !== undefined && C7_URIS.has(uri);
}

/** A camunda attribute that BPMN elements carry (`camunda:assignee` on a userTask). */
export interface CamundaAttr {
  /** XML name, e.g. `camunda:assignee` */
  name: string;
  /** descriptor type: String | Boolean | Integer */
  type: string;
  /** BPMN types that may carry it (test with `is(el, owner)`), e.g. ['bpmn:UserTask'] */
  owners: string[];
}

export interface CamundaProperty {
  name: string;
  /** prefixed type: primitive (String, Boolean, Integer), `camunda:<Type>` or `bpmn:<Type>` */
  type: string;
  isAttr: boolean;
  isMany: boolean;
  isReference: boolean;
  isBody: boolean;
}

/** A camunda extension element type (`camunda:inputOutput`). */
export interface CamundaElementType {
  /** XML spelling, e.g. `camunda:inputOutput` */
  name: string;
  /** descriptor spelling, e.g. `camunda:InputOutput` */
  type: string;
  /** where it may appear, resolved (see allowedParents) */
  allowedIn: string[];
  /** own properties plus those inherited from camunda super types */
  properties: CamundaProperty[];
  /** BPMN super types (camunda:errorEventDefinition is a bpmn:ErrorEventDefinition) */
  bpmnSuperTypes: string[];
}

/** An id-valued attribute of a camunda extension element. */
export interface VendorIdRef {
  /** element type in XML spelling, e.g. `camunda:errorEventDefinition` */
  element: string;
  /** attribute name on that element, e.g. `errorRef` */
  attr: string;
  /** BPMN type of the referenced element, e.g. `bpmn:Error` */
  target: string;
}

/* ------------------------------------------------------------------ */
/* raw descriptor                                                       */
/* ------------------------------------------------------------------ */

interface RawProperty {
  name: string;
  type?: string;
  isAttr?: boolean;
  isMany?: boolean;
  isReference?: boolean;
  isBody?: boolean;
}

interface RawType {
  name: string;
  extends?: string[];
  superClass?: string[];
  isAbstract?: boolean;
  properties?: RawProperty[];
  meta?: { allowedIn?: string[] };
}

interface Index {
  types: Map<string, RawType>; // key: `camunda:<Type>`
  hosts: Map<string, string[]>; // camunda type -> BPMN types receiving its properties
  attrs: Map<string, CamundaAttr>; // key: local attribute name
  elements: Map<string, CamundaElementType>; // key: `camunda:<Type>`
}

const PRIMITIVES = new Set(['String', 'Boolean', 'Integer', 'Real', 'Element']);

/**
 * Corrections of `meta.allowedIn` where the descriptor is narrower than what
 * the engines (Camunda 7, CIB seven, Operaton) accept, so a lookup never
 * flags valid content: execution listeners work on every flow node, sequence
 * flow and process (the list lacks sendTask, transaction, adHocSubProcess);
 * potential starters (no allowedIn at all) belong to processes and start events.
 */
const ALLOWED_IN_OVERRIDES: Record<string, string[]> = {
  'camunda:ExecutionListener': ['bpmn:FlowNode', 'bpmn:SequenceFlow', 'bpmn:Process'],
  'camunda:PotentialStarter': ['bpmn:Process', 'bpmn:StartEvent'],
};

let cached: Index | undefined;

/** The descriptor (inlined from camunda-bpmn-moddle by tools/gen-camunda-descriptor.mjs: no file access, browser-safe). */
function load(): { types: RawType[] } {
  return CAMUNDA_DESCRIPTOR as unknown as { types: RawType[] };
}

/** `InputOutput` / `inputOutput` / `camunda:inputOutput` -> `camunda:InputOutput` (descriptor key). */
function typeKey(name: string): string {
  const local = name.startsWith(`${CAMUNDA_PREFIX}:`) ? name.slice(CAMUNDA_PREFIX.length + 1) : name;
  return `${CAMUNDA_PREFIX}:${local.charAt(0).toUpperCase()}${local.slice(1)}`;
}

/** `camunda:InputOutput` -> `camunda:inputOutput` (XML / generic $type spelling). */
function xmlName(key: string): string {
  const local = key.slice(CAMUNDA_PREFIX.length + 1);
  return `${CAMUNDA_PREFIX}:${local.charAt(0).toLowerCase()}${local.slice(1)}`;
}

/** `camunda:assignee` / `assignee` -> `assignee`. */
function attrKey(name: string): string {
  return name.startsWith(`${CAMUNDA_PREFIX}:`) ? name.slice(CAMUNDA_PREFIX.length + 1) : name;
}

/** Prefixes a descriptor type reference: bare names are camunda types, primitives stay. */
function qualify(type: string): string {
  if (type.includes(':') || PRIMITIVES.has(type)) return type;
  return `${CAMUNDA_PREFIX}:${type}`;
}

function index(): Index {
  if (cached) return cached;
  const raw = load();
  const types = new Map<string, RawType>();
  for (const t of raw.types) types.set(typeKey(t.name), t);

  // camunda types that inherit from T (their hosts receive T's properties too)
  const subTypes = new Map<string, string[]>();
  for (const [key, t] of types) {
    for (const sup of t.superClass ?? []) {
      const q = qualify(sup);
      if (!q.startsWith(`${CAMUNDA_PREFIX}:`)) continue;
      const k = typeKey(q);
      subTypes.set(k, [...(subTypes.get(k) ?? []), key]);
    }
  }

  const hosts = new Map<string, string[]>();
  const hostsOf = (key: string, seen: Set<string>): string[] => {
    const known = hosts.get(key);
    if (known) return known;
    if (seen.has(key)) return [];
    seen.add(key);
    const t = types.get(key);
    const out = new Set<string>();
    for (const ext of t?.extends ?? []) {
      const q = qualify(ext);
      if (q.startsWith('bpmn:')) out.add(q);
      else if (q.startsWith(`${CAMUNDA_PREFIX}:`)) for (const h of hostsOf(typeKey(q), seen)) out.add(h);
    }
    for (const sub of subTypes.get(key) ?? []) for (const h of hostsOf(sub, seen)) out.add(h);
    const list = [...out];
    hosts.set(key, list);
    return list;
  };
  for (const key of types.keys()) hostsOf(key, new Set());

  // attributes of BPMN elements: properties of types that have hosts
  const attrs = new Map<string, CamundaAttr>();
  for (const [key, t] of types) {
    const owners = hosts.get(key) ?? [];
    if (!owners.length) continue;
    for (const p of t.properties ?? []) {
      if (!p.isAttr) continue;
      const local = attrKey(p.name);
      const prev = attrs.get(local);
      if (prev) {
        for (const o of owners) if (!prev.owners.includes(o)) prev.owners.push(o);
      } else {
        attrs.set(local, { name: `${CAMUNDA_PREFIX}:${local}`, type: p.type ?? 'String', owners: [...owners] });
      }
    }
  }

  // extension element types: everything that is not a pure mixin (no `extends`)
  const elements = new Map<string, CamundaElementType>();
  const propsOf = (key: string, seen: Set<string>): CamundaProperty[] => {
    if (seen.has(key)) return [];
    seen.add(key);
    const t = types.get(key);
    if (!t) return [];
    const inherited = (t.superClass ?? [])
      .map(qualify)
      .filter((s) => s.startsWith(`${CAMUNDA_PREFIX}:`))
      .flatMap((s) => propsOf(typeKey(s), seen));
    const own = (t.properties ?? []).map((p) => ({
      name: attrKey(p.name),
      type: qualify(p.type ?? 'String'),
      isAttr: !!p.isAttr,
      isMany: !!p.isMany,
      isReference: !!p.isReference,
      isBody: !!p.isBody,
    }));
    const byName = new Map<string, CamundaProperty>();
    for (const p of [...inherited, ...own]) byName.set(p.name, p);
    return [...byName.values()];
  };
  for (const [key, t] of types) {
    if (t.extends?.length) continue; // mixin: its properties are attributes of BPMN elements
    const allowedIn: string[] = [];
    for (const a of ALLOWED_IN_OVERRIDES[key] ?? t.meta?.allowedIn ?? []) {
      const q = qualify(a);
      if (q === '*' || a === '*') allowedIn.push('*');
      else if (q.startsWith('bpmn:')) allowedIn.push(q);
      else {
        const k = typeKey(q);
        const h = hosts.get(k) ?? [];
        if (h.length) allowedIn.push(...h);
        else allowedIn.push(xmlName(k));
      }
    }
    elements.set(key, {
      name: xmlName(key),
      type: key,
      allowedIn: [...new Set(allowedIn)],
      properties: propsOf(key, new Set()),
      bpmnSuperTypes: (t.superClass ?? []).map(qualify).filter((s) => s.startsWith('bpmn:')),
    });
  }
  cached = { types, hosts, attrs, elements };
  return cached;
}

/* ------------------------------------------------------------------ */
/* BPMN type hierarchy                                                  */
/* ------------------------------------------------------------------ */

let probeModdle: ReturnType<typeof createModdle> | undefined;
const subtypeCache = new Map<string, boolean>();

/** True when BPMN type `type` is `superType` or a subtype of it (`bpmn:UserTask` is a `bpmn:Activity`). */
export function typeIs(type: string, superType: string): boolean {
  if (superType === '*') return true;
  const key = `${type}<${superType}`;
  const hit = subtypeCache.get(key);
  if (hit !== undefined) return hit;
  let result = false;
  try {
    probeModdle ??= createModdle();
    result = probeModdle.create(type).$instanceOf(superType);
  } catch {
    result = false;
  }
  subtypeCache.set(key, result);
  return result;
}

function elementIs(el: El | string, superType: string): boolean {
  if (typeof el === 'string') return typeIs(el, superType);
  return superType === '*' || (typeof el.$instanceOf === 'function' && el.$instanceOf(superType));
}

/* ------------------------------------------------------------------ */
/* attributes                                                           */
/* ------------------------------------------------------------------ */

/** The camunda attribute `name` (`camunda:assignee` or `assignee`) of BPMN elements, or undefined. */
export function camundaAttr(name: string): CamundaAttr | undefined {
  if (name.includes(':') && !name.startsWith(`${CAMUNDA_PREFIX}:`)) return undefined;
  return index().attrs.get(attrKey(name));
}

/** Every camunda attribute of BPMN elements. */
export function camundaAttrs(): CamundaAttr[] {
  return [...index().attrs.values()];
}

/**
 * Whether the camunda attribute may be written on `el` (an element or a BPMN
 * type name); undefined when `name` is not a known camunda attribute.
 */
export function attrAppliesTo(name: string, el: El | string): boolean | undefined {
  const attr = camundaAttr(name);
  if (!attr) return undefined;
  return attr.owners.some((o) => elementIs(el, o));
}

/** The camunda attributes `el` (an element or a BPMN type name) may carry. */
export function camundaAttrsFor(el: El | string): CamundaAttr[] {
  return camundaAttrs().filter((a) => a.owners.some((o) => elementIs(el, o)));
}

/* ------------------------------------------------------------------ */
/* extension element types                                              */
/* ------------------------------------------------------------------ */

/** True for camunda extension element types (`camunda:inputOutput`, `camunda:formField`, ...). */
export function isCamundaType(name: string): boolean {
  return !!camundaType(name);
}

/** The camunda extension element type `name`, or undefined (mixins such as AsyncCapable are not element types). */
export function camundaType(name: string): CamundaElementType | undefined {
  if (name.includes(':') && !name.startsWith(`${CAMUNDA_PREFIX}:`)) return undefined;
  return index().elements.get(typeKey(name));
}

/**
 * Where an extension element of type `name` may appear: BPMN types (inside
 * their bpmn:extensionElements; camunda mixins resolved, e.g.
 * camunda:connector -> bpmn:ServiceTask, bpmn:BusinessRuleTask, bpmn:SendTask,
 * bpmn:MessageEventDefinition), '*' (any element), or camunda element types in
 * XML spelling (as a child of that vendor element). [] = the type only appears
 * nested inside another vendor element (see containersOf) or is unknown.
 */
export function allowedParents(name: string): string[] {
  return camundaType(name)?.allowedIn ?? [];
}

/**
 * Whether an extension element of type `name` may sit in the extensionElements
 * of `el` (BPMN element or type name). undefined when `name` is not a camunda
 * element type or the descriptor says nothing about its placement.
 */
export function allowedOn(name: string, el: El | string): boolean | undefined {
  const t = camundaType(name);
  if (!t || !t.allowedIn.length) return undefined;
  return t.allowedIn.some((a) => a === '*' || (a.startsWith('bpmn:') && elementIs(el, a)));
}

/** Camunda element types (XML spelling) that hold `name` as a child property (camunda:inputParameter -> camunda:inputOutput). */
export function containersOf(name: string): string[] {
  const target = camundaType(name);
  if (!target) return [];
  const { types, elements } = index();
  // a child slot typed with a super type accepts the subtype too (camunda:value in a list's items)
  const accepted = new Set<string>([target.type]);
  const addSupers = (key: string): void => {
    for (const sup of types.get(key)?.superClass ?? []) {
      const q = qualify(sup);
      if (!q.startsWith(`${CAMUNDA_PREFIX}:`)) continue;
      const k = typeKey(q);
      if (!accepted.has(k)) {
        accepted.add(k);
        addSupers(k);
      }
    }
  };
  addSupers(target.type);
  const out: string[] = [];
  for (const e of elements.values()) {
    if (e.properties.some((p) => !p.isAttr && !p.isReference && p.type.startsWith(`${CAMUNDA_PREFIX}:`) && accepted.has(typeKey(p.type)))) out.push(e.name);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* id references inside vendor extensions                               */
/* ------------------------------------------------------------------ */

let idRefs: VendorIdRef[] | undefined;

/**
 * Id-valued attributes of camunda extension elements: attribute references
 * they declare or inherit from their BPMN super type (camunda:errorEventDefinition
 * extends bpmn:ErrorEventDefinition, so its `errorRef` names a bpmn:Error).
 * In a file these elements are generic, so the reference is a plain string
 * that has to be kept in sync by hand (rename, remove).
 */
export function idReferenceAttrs(): VendorIdRef[] {
  if (idRefs) return idRefs;
  const out: VendorIdRef[] = [];
  probeModdle ??= createModdle();
  for (const e of index().elements.values()) {
    for (const p of e.properties) {
      if (p.isReference && p.isAttr) out.push({ element: e.name, attr: p.name, target: p.type });
    }
    for (const sup of e.bpmnSuperTypes) {
      let descriptor: { properties?: Array<{ name: string; type: string; isReference?: boolean; isAttr?: boolean }> } | undefined;
      try {
        descriptor = probeModdle.getElementDescriptor(probeModdle.getType(sup)) as typeof descriptor;
      } catch {
        descriptor = undefined;
      }
      for (const p of descriptor?.properties ?? []) {
        if (!p.isReference || !p.isAttr) continue;
        if (!out.some((r) => r.element === e.name && r.attr === p.name)) out.push({ element: e.name, attr: p.name, target: qualifyBpmn(p.type) });
      }
    }
  }
  idRefs = out;
  return out;
}

function qualifyBpmn(type: string): string {
  return type.includes(':') ? type : `bpmn:${type}`;
}

/* ------------------------------------------------------------------ */
/* execution platform of a file                                         */
/* ------------------------------------------------------------------ */

export const ZEEBE_URI = 'http://camunda.org/schema/zeebe/1.0';

/** History time to live Camunda Modeler writes on new C7 processes (days). */
export const C7_DEFAULT_TTL = '180';
/** modeler:executionPlatformVersion written by `new --target camunda7` (the Modeler's current C7 default). */
export const C7_PLATFORM_VERSION = '7.24.0';

/**
 * The engine a file targets: `camunda7` (Camunda 7, CIB seven, Operaton),
 * `camunda8`, or undefined for plain BPMN. One decision with the validation
 * profile: platform/detect.ts detectPlatformOf (modeler:executionPlatform,
 * else the vendor namespace the content uses, else a declared one).
 */
export function platformOf(definitions: El): 'camunda7' | 'camunda8' | undefined {
  const p = detectPlatformOf(definitions).platform;
  return p === 'c7' ? 'camunda7' : p === 'c8' ? 'camunda8' : undefined;
}
