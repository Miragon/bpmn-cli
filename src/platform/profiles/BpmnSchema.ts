import type { BpmnModdle } from 'bpmn-moddle';

export const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';

/** An XSD choice, or children bpmn-moddle orders differently from the XSD: one place each. */
const SAME_SLOT = [
  ['timeDate', 'timeDuration', 'timeCycle'],
  ['source', 'target'],
  ['supportedInterfaceRef', 'ioSpecification', 'ioBinding'],
  ['auditing', 'monitoring', 'categoryValueRef', 'dataState'],
  ['resourceRef', 'resourceParameterBinding', 'resourceAssignmentExpression'],
  ['dataOutputRefs', 'optionalOutputRefs', 'whileExecutingOutputRefs', 'inputSetRefs'],
  ['participantMultiplicity', 'endPointRef', 'endPointRefs'],
];

export interface Descriptor {
  name: string;
  allTypes?: Array<{ name: string }>;
  properties: Array<{ name: string; type: string; isAttr?: boolean; isBody?: boolean; isVirtual?: boolean; isReference?: boolean }>;
}

interface Registry {
  typeMap: Record<string, unknown>;
  getEffectiveDescriptor(name: string): Descriptor;
}

export class BpmnSchema {
  private readonly registry: Registry;
  private readonly bpmnTypes: string[];
  private readonly slots = new Map<string, Map<string, number>>();
  private readonly descriptors = new Map<string, Descriptor | undefined>();
  private readonly booleans = new Map<string, Set<string>>();

  constructor(
    moddle: BpmnModdle,
    private readonly bpmnNs: string,
  ) {
    this.registry = (moddle as unknown as { registry: Registry }).registry;
    this.bpmnTypes = Object.keys(this.registry.typeMap).filter((t) => t.startsWith('bpmn:'));
  }

  descriptor(type: string): Descriptor | undefined {
    if (!this.descriptors.has(type)) {
      let d: Descriptor | undefined;
      try {
        d = this.registry.typeMap[type] ? this.registry.getEffectiveDescriptor(type) : undefined;
      } catch {
        d = undefined;
      }
      this.descriptors.set(type, d);
    }
    return this.descriptors.get(type);
  }

  isA(type: string, base: string): boolean {
    return type === base || !!this.descriptor(type)?.allTypes?.some((a) => a.name === base);
  }

  /** A child's own type name, else the type of the parent's property of that name. */
  typeOf(local: string, uri: string, parentType: string | undefined): string | undefined {
    const prefix = uri === this.bpmnNs ? 'bpmn' : uri === BPMNDI_NS ? 'bpmndi' : undefined;
    if (!prefix) return undefined;
    const own = `${prefix}:${local.charAt(0).toUpperCase()}${local.slice(1)}`;
    if (this.descriptor(own)) return own;
    const p = parentType ? this.descriptor(parentType)?.properties.find((x) => x.name === local) : undefined;
    return p && !p.isReference && this.descriptor(p.type) ? p.type : undefined;
  }

  booleanAttrs(type: string): Set<string> {
    let out = this.booleans.get(type);
    if (!out) {
      out = new Set((this.descriptor(type)?.properties ?? []).filter((p) => p.isAttr && p.type === 'Boolean' && !p.name.includes(':')).map((p) => p.name));
      this.booleans.set(type, out);
    }
    return out;
  }

  /** -1: the name fits two places and is not checked */
  slotsOf(type: string): Map<string, number> {
    let out = this.slots.get(type);
    if (out) return out;
    out = new Map();
    const d = this.descriptor(type);
    d?.properties.forEach((p, i) => {
      if (p.isAttr || p.isBody || p.isVirtual) return;
      const names = new Set([p.name]);
      if (!p.isReference && p.type.startsWith('bpmn:')) {
        for (const t of this.bpmnTypes) if (this.isA(t, p.type)) names.add(t.charAt(5).toLowerCase() + t.slice(6));
      }
      if (!p.isReference && p.type.startsWith('bpmndi:')) names.add(p.type.slice('bpmndi:'.length));
      for (const n of names) out!.set(n, out!.has(n) && out!.get(n) !== i ? -1 : i);
    });
    for (const group of SAME_SLOT) {
      const at = group.map((n) => out!.get(n)).filter((s): s is number => s !== undefined && s >= 0);
      if (at.length < 2) continue;
      const first = Math.min(...at);
      for (const n of group) if ((out.get(n) ?? -1) >= 0) out.set(n, first);
    }
    this.slots.set(type, out);
    return out;
  }
}
