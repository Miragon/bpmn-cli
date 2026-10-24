/**
 * The Camunda 8 (Zeebe) descriptor (`zeebe-bpmn-moddle`, resources/zeebe.json,
 * inlined as zeebe-descriptor.ts; see VendorDescriptor), used for validation
 * (platform/profiles/C8Profile.ts) and for placing zeebe extension elements (ops/ext.ts).
 *
 *  - type(name)                 -> { name, type, allowedIn, attributes, children } of a zeebe
 *                                  extension element type, or undefined (mixins are no element types)
 *  - allowedOn(name, el)        -> whether the type may sit in el's bpmn:extensionElements
 *                                  (false for a type that only appears nested; undefined: unknown)
 *  - containersOf(name)         -> zeebe element types that hold `name` as a child
 *                                  (zeebe:input -> zeebe:ioMapping)
 *  - nestedOnly(name)           -> the type only appears inside its container (zeebe:input, zeebe:header)
 *  - attr(name)                 -> { name, type, owners } for a zeebe ATTRIBUTE of BPMN elements
 *                                  (zeebe:modelerTemplate on flow elements, ...), or undefined
 *
 * Corrections where the descriptor (zeebe-bpmn-moddle 2.0.0) differs from what
 * Camunda 8.9 reads (engine-checked, test/c8-profile.test.ts):
 *  - zeebe:subscription has no allowedIn; the engine reads it on bpmn:Message.
 *  - zeebe:properties has no allowedIn: it may sit anywhere.
 *  - zeebe:publishMessage is not in the descriptor; Camunda 8.9 accepts it on a
 *    send task and in a message event definition (it does not execute it yet:
 *    platform/profiles/C8Profile.ts W_C8_UNSUPPORTED_IMPLEMENTATION).
 */
import { is, type El } from '../model/utils/moddle.js';
import { VendorDescriptor, type RawType, type VendorAttr, type VendorElementType, type VendorIndex } from './VendorDescriptor.js';
import { ZEEBE_DESCRIPTOR } from './zeebe-descriptor.js';

export const ZEEBE_URI = 'http://camunda.org/schema/zeebe/1.0';
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

export interface ZeebeElementType extends VendorElementType {
  /** attributes, also those of mixins (bindingType / versionTag of zeebe:calledDecision) */
  attributes: ZeebeProperty[];
  /** child element types (XML spelling), e.g. zeebe:input and zeebe:output of zeebe:ioMapping */
  children: string[];
  /** the element holds text (zeebe:userTaskForm) */
  body: boolean;
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

/**
 * Types that occur at most once in bpmn:extensionElements: the Zeebe model
 * reads one element of each; Camunda 8.9 refuses a second zeebe:adHoc,
 * zeebe:conditionalFilter or zeebe:publishMessage (engine-checked,
 * test/c8-profile.test.ts).
 */
const SINGLES = [
  'zeebe:ioMapping',
  'zeebe:taskHeaders',
  'zeebe:properties',
  'zeebe:taskDefinition',
  'zeebe:formDefinition',
  'zeebe:assignmentDefinition',
  'zeebe:priorityDefinition',
  'zeebe:taskSchedule',
  'zeebe:calledElement',
  'zeebe:calledDecision',
  'zeebe:loopCharacteristics',
  'zeebe:subscription',
  'zeebe:script',
  'zeebe:userTask',
  'zeebe:versionTag',
  'zeebe:executionListeners',
  'zeebe:taskListeners',
  'zeebe:linkedResources',
  'zeebe:adHoc',
  'zeebe:conditionalFilter',
  'zeebe:publishMessage',
];

export class ZeebeDescriptor extends VendorDescriptor<ZeebeElementType> {
  constructor() {
    super('zeebe', ZEEBE_URI, new Set([ZEEBE_URI]), SINGLES);
  }

  /**
   * Whether an extension element of type `name` may sit in the extensionElements
   * of `el` (an element or a BPMN type name): false for a type that only appears
   * inside its container (zeebe:input, zeebe:header). undefined when the type is
   * unknown or the descriptor says nothing about its placement.
   */
  override allowedOn(name: string, el: El | string): boolean | undefined {
    const t = this.type(name);
    if (!t) return undefined;
    if (this.nestedOnly(name)) return false;
    const bpmn = t.allowedIn.filter((a) => a === '*' || a.startsWith('bpmn:'));
    if (!bpmn.length) return undefined;
    return bpmn.some((a) => this.elementIs(el, a));
  }

  /** Zeebe element types (XML spelling) that hold `name` as a child (zeebe:header -> zeebe:taskHeaders). */
  override containersOf(name: string): string[] {
    const t = this.type(name);
    if (!t) return [];
    return [...this.index().elements.values()].filter((e) => e.children.includes(t.name)).map((e) => e.name);
  }

  /**
   * True for a type that only appears inside a container without attributes of
   * its own (zeebe:input in zeebe:ioMapping, zeebe:header in zeebe:taskHeaders,
   * zeebe:executionListener in zeebe:executionListeners). zeebe:taskHeaders is
   * not: it also sits in extensionElements (and in an execution listener).
   */
  nestedOnly(name: string): boolean {
    const containers = this.containersOf(name);
    return containers.length > 0 && containers.every((c) => (this.type(c)?.attributes.length ?? 1) === 0);
  }

  /** The container of each type that only appears nested (zeebe:input -> zeebe:ioMapping). */
  nestedHomes(): Record<string, string> {
    return Object.fromEntries(this.typeNames().flatMap((n) => (this.nestedOnly(n) ? [[n, this.containersOf(n)[0]!]] : [])));
  }

  protected override buildIndex(): VendorIndex<ZeebeElementType> {
    const prefix = this.prefix;
    const raw = [...((ZEEBE_DESCRIPTOR as unknown as { types: RawType[] }).types ?? []), ...EXTRA_TYPES];
    const types = new Map<string, RawType>();
    for (const t of raw) types.set(this.typeKey(t.name), t);

    // mixins: types that `extends` others. Extending BPMN types adds attributes to BPMN elements
    // (zeebe:modelerTemplate); extending zeebe types adds attributes to those (bindingType)
    const mixinAttrs = new Map<string, ZeebeProperty[]>(); // zeebe type key -> attributes added by mixins
    const hostsOfMixin = new Map<string, string[]>(); // mixin key -> BPMN types (zeebe:ZeebeServiceTask -> service task, ...)
    const attrs = new Map<string, VendorAttr>();
    for (const [key, t] of types) {
      if (!t.extends?.length) continue;
      const bpmn = t.extends.map((e) => this.qualify(e)).filter((e) => e.startsWith('bpmn:'));
      hostsOfMixin.set(key, bpmn);
      for (const p of t.properties ?? []) {
        if (!p.isAttr) continue;
        if (bpmn.length) {
          const prev = attrs.get(p.name);
          if (prev) {
            for (const o of bpmn) if (!prev.owners.includes(o)) prev.owners.push(o);
          } else {
            attrs.set(p.name, { name: `${prefix}:${p.name}`, type: p.type ?? 'String', owners: [...bpmn] });
          }
        }
        for (const e of t.extends.map((x) => this.qualify(x)).filter((x) => x.startsWith(`${prefix}:`))) {
          const k = this.typeKey(e);
          mixinAttrs.set(k, [...(mixinAttrs.get(k) ?? []), { name: p.name, type: this.qualify(p.type ?? 'String'), isAttr: true, isMany: false, isBody: false }]);
        }
      }
    }

    const ownProps = (key: string, seen = new Set<string>()): ZeebeProperty[] => {
      if (seen.has(key)) return [];
      seen.add(key);
      const t = types.get(key);
      if (!t) return [];
      const inherited = (t.superClass ?? [])
        .map((s) => this.qualify(s))
        .filter((s) => s.startsWith(`${prefix}:`))
        .flatMap((s) => ownProps(this.typeKey(s), seen));
      const own = (t.properties ?? []).map((p) => ({ name: p.name, type: this.qualify(p.type ?? 'String'), isAttr: !!p.isAttr, isMany: !!p.isMany, isBody: !!p.isBody }));
      return [...inherited, ...own, ...(mixinAttrs.get(key) ?? [])];
    };

    // abstract super types (zeebe:InputOutputParameter of zeebe:Input / zeebe:Output) are no elements either
    const supers = new Set(
      [...types.values()].flatMap((t) =>
        (t.superClass ?? [])
          .map((s) => this.qualify(s))
          .filter((s) => s.startsWith(`${prefix}:`))
          .map((s) => this.typeKey(s)),
      ),
    );
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
          const k = this.typeKey(this.qualify(a));
          const hosts = hostsOfMixin.get(k);
          if (hosts) allowedIn.push(...hosts);
          else allowedIn.push(this.xmlName(k));
        }
      }
      elements.set(key, {
        name: this.xmlName(key),
        type: key,
        allowedIn: [...new Set(allowedIn)],
        attributes: props.filter((p) => p.isAttr),
        children: [...new Set(props.filter((p) => !p.isAttr && !p.isBody && p.type.startsWith(`${prefix}:`)).map((p) => this.xmlName(this.typeKey(p.type))))],
        body: props.some((p) => p.isBody),
      });
    }
    // a self-referencing property (zeebe:IoMapping.ioMapping) is no child element
    for (const e of elements.values()) e.children = e.children.filter((c) => c !== e.name);
    return { elements, attrs };
  }

  private elementIs(el: El | string, type: string): boolean {
    if (type === '*') return true;
    return typeof el === 'string' ? VendorDescriptor.typeIs(el, type) : is(el, type);
  }
}

export const ZEEBE = new ZeebeDescriptor();
