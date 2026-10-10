/**
 * Read-only lookup over the Camunda 8 (Zeebe) descriptor (`zeebe-bpmn-moddle`,
 * resources/zeebe.json, inlined as zeebe-descriptor.ts), used for validation
 * (platform/c8.ts) and for placing zeebe extension elements (ops/ext.ts).
 *
 * Like the Camunda 7 descriptor (platform/descriptor.ts) it is DATA: it is
 * never registered with a BpmnModdle instance, so zeebe content stays generic
 * (`el.$type === 'zeebe:taskDefinition'`, attributes as plain properties) and
 * the serialisation stays byte-stable.
 *
 * Names: functions accept `zeebe:taskDefinition`, `taskDefinition` or
 * `TaskDefinition`; results use the XML spelling (`zeebe:taskDefinition`) for
 * zeebe element types and `bpmn:<Type>` for BPMN types.
 *
 * API:
 *  - zeebeType(name)            -> { name, type, allowedIn, attributes, children } of a zeebe
 *                                  extension element type, or undefined (mixins are no element types)
 *  - zeebeTypeNames()           -> every zeebe element type (XML spelling)
 *  - zeebeAllowedOn(name, el)   -> whether the type may sit in el's bpmn:extensionElements
 *                                  (false for a type that only appears nested; undefined: unknown)
 *  - zeebeContainersOf(name)    -> zeebe element types that hold `name` as a child
 *                                  (zeebe:input -> zeebe:ioMapping)
 *  - zeebeNestedOnly(name)      -> the type only appears inside its container (zeebe:input, zeebe:header)
 *  - zeebeAttr(name)            -> { name, type, owners } for a zeebe ATTRIBUTE of BPMN elements
 *                                  (zeebe:modelerTemplate on flow elements, ...), or undefined
 *  - zeebeAttrs()               -> all of them
 *  - C8_PLATFORM_VERSION        -> what `new --target camunda8` writes as modeler:executionPlatformVersion
 *
 * Corrections where the descriptor (zeebe-bpmn-moddle 2.0.0) differs from what
 * Camunda 8.9 reads (engine-checked, test/c8-profile.test.ts):
 *  - zeebe:subscription has no allowedIn; the engine reads it on bpmn:Message.
 *  - zeebe:properties has no allowedIn: it may sit anywhere.
 *  - zeebe:publishMessage is not in the descriptor; Camunda 8.9 accepts it on a
 *    send task and in a message event definition (it does not execute it yet:
 *    c8.ts W_C8_UNSUPPORTED_IMPLEMENTATION).
 */
import { is, type El } from '../model.js';
import { typeIs } from './descriptor.js';
import { ZEEBE_DESCRIPTOR } from './zeebe-descriptor.js';

export const ZEEBE_PREFIX = 'zeebe';
/** modeler:executionPlatformVersion written by `new --target camunda8` (the Camunda 8 version the profile was checked against). */
export const C8_PLATFORM_VERSION = '8.9.0';

export interface ZeebeProperty {
  name: string;
  /** primitive (String, Boolean, Integer) or `zeebe:<Type>` */
  type: string;
  isAttr: boolean;
  isMany: boolean;
  isBody: boolean;
}

export interface ZeebeElementType {
  /** XML spelling, e.g. `zeebe:taskDefinition` */
  name: string;
  /** descriptor spelling, e.g. `zeebe:TaskDefinition` */
  type: string;
  /** where it may appear: BPMN types (in their extensionElements), '*', or zeebe element types (XML spelling) it is a child of */
  allowedIn: string[];
  /** attributes, also those of mixins (bindingType / versionTag of zeebe:calledDecision) */
  attributes: ZeebeProperty[];
  /** child element types (XML spelling), e.g. zeebe:input and zeebe:output of zeebe:ioMapping */
  children: string[];
  /** the element holds text (zeebe:userTaskForm) */
  body: boolean;
}

export interface ZeebeAttr {
  /** XML name, e.g. `zeebe:modelerTemplate` */
  name: string;
  type: string;
  /** BPMN types that may carry it */
  owners: string[];
}

interface RawProperty {
  name: string;
  type?: string;
  isAttr?: boolean;
  isMany?: boolean;
  isBody?: boolean;
}

interface RawType {
  name: string;
  extends?: string[];
  superClass?: string[];
  properties?: RawProperty[];
  meta?: { allowedIn?: string[] };
}

/** Types the engine reads that zeebe-bpmn-moddle 2.0.0 does not describe (see the module header). */
const EXTRA_TYPES: RawType[] = [
  {
    name: 'PublishMessage',
    superClass: ['Element'],
    properties: [
      { name: 'correlationKey', isAttr: true, type: 'String' },
      { name: 'messageId', isAttr: true, type: 'String' },
      { name: 'timeToLive', isAttr: true, type: 'String' },
    ],
    meta: { allowedIn: ['bpmn:SendTask', 'bpmn:MessageEventDefinition'] },
  },
];

/** allowedIn corrections (see the module header). */
const ALLOWED_IN_OVERRIDES: Record<string, string[]> = {
  'zeebe:Subscription': ['bpmn:Message'],
  'zeebe:Properties': ['*'],
};

const PRIMITIVES = new Set(['String', 'Boolean', 'Integer', 'Real', 'Element']);

interface Index {
  elements: Map<string, ZeebeElementType>; // key: `zeebe:<Type>`
  attrs: Map<string, ZeebeAttr>; // key: local attribute name
}

let cached: Index | undefined;

function qualify(type: string): string {
  if (type.includes(':') || PRIMITIVES.has(type)) return type;
  return `${ZEEBE_PREFIX}:${type}`;
}

/** `TaskDefinition` / `taskDefinition` / `zeebe:taskDefinition` -> `zeebe:TaskDefinition`. */
function typeKey(name: string): string {
  const local = name.startsWith(`${ZEEBE_PREFIX}:`) ? name.slice(ZEEBE_PREFIX.length + 1) : name;
  return `${ZEEBE_PREFIX}:${local.charAt(0).toUpperCase()}${local.slice(1)}`;
}

/** `zeebe:TaskDefinition` -> `zeebe:taskDefinition`. */
function xmlName(key: string): string {
  const local = key.slice(ZEEBE_PREFIX.length + 1);
  return `${ZEEBE_PREFIX}:${local.charAt(0).toLowerCase()}${local.slice(1)}`;
}

function index(): Index {
  if (cached) return cached;
  const raw = [...((ZEEBE_DESCRIPTOR as unknown as { types: RawType[] }).types ?? []), ...EXTRA_TYPES];
  const types = new Map<string, RawType>();
  for (const t of raw) types.set(typeKey(t.name), t);

  // mixins: types that `extends` others. Extending BPMN types adds attributes to BPMN elements
  // (zeebe:modelerTemplate); extending zeebe types adds attributes to those (bindingType)
  const mixinAttrs = new Map<string, ZeebeProperty[]>(); // zeebe type key -> attributes added by mixins
  const hostsOfMixin = new Map<string, string[]>(); // mixin key -> BPMN types (zeebe:ZeebeServiceTask -> service task, ...)
  const attrs = new Map<string, ZeebeAttr>();
  for (const [key, t] of types) {
    if (!t.extends?.length) continue;
    const bpmn = t.extends.map(qualify).filter((e) => e.startsWith('bpmn:'));
    hostsOfMixin.set(key, bpmn);
    for (const p of t.properties ?? []) {
      if (!p.isAttr) continue;
      if (bpmn.length) {
        const prev = attrs.get(p.name);
        if (prev) {
          for (const o of bpmn) if (!prev.owners.includes(o)) prev.owners.push(o);
        } else {
          attrs.set(p.name, { name: `${ZEEBE_PREFIX}:${p.name}`, type: p.type ?? 'String', owners: [...bpmn] });
        }
      }
      for (const e of t.extends.map(qualify).filter((x) => x.startsWith(`${ZEEBE_PREFIX}:`))) {
        const k = typeKey(e);
        mixinAttrs.set(k, [...(mixinAttrs.get(k) ?? []), { name: p.name, type: qualify(p.type ?? 'String'), isAttr: true, isMany: false, isBody: false }]);
      }
    }
  }

  const ownProps = (key: string, seen = new Set<string>()): ZeebeProperty[] => {
    if (seen.has(key)) return [];
    seen.add(key);
    const t = types.get(key);
    if (!t) return [];
    const inherited = (t.superClass ?? []).map(qualify).filter((s) => s.startsWith(`${ZEEBE_PREFIX}:`)).flatMap((s) => ownProps(typeKey(s), seen));
    const own = (t.properties ?? []).map((p) => ({ name: p.name, type: qualify(p.type ?? 'String'), isAttr: !!p.isAttr, isMany: !!p.isMany, isBody: !!p.isBody }));
    return [...inherited, ...own, ...(mixinAttrs.get(key) ?? [])];
  };

  // abstract super types (zeebe:InputOutputParameter of zeebe:Input / zeebe:Output) are no elements either
  const supers = new Set([...types.values()].flatMap((t) => (t.superClass ?? []).map(qualify).filter((s) => s.startsWith(`${ZEEBE_PREFIX}:`)).map(typeKey)));
  const elements = new Map<string, ZeebeElementType>();
  for (const [key, t] of types) {
    if (t.extends?.length) continue; // a mixin, not an element type
    if (supers.has(key) && !t.meta?.allowedIn) continue;
    const props = ownProps(key);
    const allowedIn: string[] = [];
    for (const a of ALLOWED_IN_OVERRIDES[key] ?? t.meta?.allowedIn ?? []) {
      if (a === '*') allowedIn.push('*');
      else if (a.startsWith('bpmn:')) allowedIn.push(a);
      else {
        const k = typeKey(qualify(a));
        const hosts = hostsOfMixin.get(k);
        if (hosts) allowedIn.push(...hosts);
        else allowedIn.push(xmlName(k));
      }
    }
    elements.set(key, {
      name: xmlName(key),
      type: key,
      allowedIn: [...new Set(allowedIn)],
      attributes: props.filter((p) => p.isAttr),
      children: [...new Set(props.filter((p) => !p.isAttr && !p.isBody && p.type.startsWith(`${ZEEBE_PREFIX}:`)).map((p) => xmlName(typeKey(p.type))))],
      body: props.some((p) => p.isBody),
    });
  }
  // a self-referencing property (zeebe:IoMapping.ioMapping) is no child element
  for (const e of elements.values()) e.children = e.children.filter((c) => c !== e.name);
  cached = { elements, attrs };
  return cached;
}

/** The zeebe extension element type `name`, or undefined. */
export function zeebeType(name: string): ZeebeElementType | undefined {
  if (name.includes(':') && !name.startsWith(`${ZEEBE_PREFIX}:`)) return undefined;
  return index().elements.get(typeKey(name));
}

/** Every zeebe extension element type, XML spelling. */
export function zeebeTypeNames(): string[] {
  return [...index().elements.values()].map((e) => e.name);
}

function elementIs(el: El | string, type: string): boolean {
  if (type === '*') return true;
  return typeof el === 'string' ? typeIs(el, type) : is(el, type);
}

/**
 * Whether an extension element of type `name` may sit in the extensionElements
 * of `el` (an element or a BPMN type name): false for a type that only appears
 * inside its container (zeebe:input, zeebe:header). undefined when the type is
 * unknown or the descriptor says nothing about its placement.
 */
export function zeebeAllowedOn(name: string, el: El | string): boolean | undefined {
  const t = zeebeType(name);
  if (!t) return undefined;
  if (zeebeNestedOnly(name)) return false;
  const bpmn = t.allowedIn.filter((a) => a === '*' || a.startsWith('bpmn:'));
  if (!bpmn.length) return undefined;
  return bpmn.some((a) => elementIs(el, a));
}

/** Zeebe element types (XML spelling) that hold `name` as a child (zeebe:header -> zeebe:taskHeaders). */
export function zeebeContainersOf(name: string): string[] {
  const t = zeebeType(name);
  if (!t) return [];
  return [...index().elements.values()].filter((e) => e.children.includes(t.name)).map((e) => e.name);
}

/**
 * True for a type that only appears inside a container without attributes of
 * its own (zeebe:input in zeebe:ioMapping, zeebe:header in zeebe:taskHeaders,
 * zeebe:executionListener in zeebe:executionListeners). zeebe:taskHeaders is
 * not: it also sits in extensionElements (and in an execution listener).
 */
export function zeebeNestedOnly(name: string): boolean {
  const containers = zeebeContainersOf(name);
  return containers.length > 0 && containers.every((c) => (zeebeType(c)?.attributes.length ?? 1) === 0);
}

/** The zeebe attribute `name` (`zeebe:modelerTemplate` or `modelerTemplate`) of BPMN elements, or undefined. */
export function zeebeAttr(name: string): ZeebeAttr | undefined {
  if (name.includes(':') && !name.startsWith(`${ZEEBE_PREFIX}:`)) return undefined;
  return index().attrs.get(name.startsWith(`${ZEEBE_PREFIX}:`) ? name.slice(ZEEBE_PREFIX.length + 1) : name);
}

/** Every zeebe attribute of BPMN elements. */
export function zeebeAttrs(): ZeebeAttr[] {
  return [...index().attrs.values()];
}
