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
    this.bpmnTypes = Object.keys(this.registry.typeMap).filter((typeName) => typeName.startsWith('bpmn:'));
  }

  descriptor(type: string): Descriptor | undefined {
    if (!this.descriptors.has(type)) {
      let descriptor: Descriptor | undefined;
      try {
        descriptor = this.registry.typeMap[type] ? this.registry.getEffectiveDescriptor(type) : undefined;
      } catch {
        descriptor = undefined;
      }
      this.descriptors.set(type, descriptor);
    }
    return this.descriptors.get(type);
  }

  isA(type: string, base: string): boolean {
    return type === base || !!this.descriptor(type)?.allTypes?.some((ancestor) => ancestor.name === base);
  }

  /** A child's own type name, else the type of the parent's property of that name. */
  typeOf(local: string, uri: string, parentType: string | undefined): string | undefined {
    const prefix = uri === this.bpmnNs ? 'bpmn' : uri === BPMNDI_NS ? 'bpmndi' : undefined;
    if (!prefix) return undefined;
    const own = `${prefix}:${local.charAt(0).toUpperCase()}${local.slice(1)}`;
    if (this.descriptor(own)) return own;
    const property = parentType ? this.descriptor(parentType)?.properties.find((candidate) => candidate.name === local) : undefined;
    return property && !property.isReference && this.descriptor(property.type) ? property.type : undefined;
  }

  booleanAttrs(type: string): Set<string> {
    let out = this.booleans.get(type);
    if (!out) {
      out = new Set((this.descriptor(type)?.properties ?? []).filter((property) => property.isAttr && property.type === 'Boolean' && !property.name.includes(':')).map((property) => property.name));
      this.booleans.set(type, out);
    }
    return out;
  }

  /** -1: the name fits two places and is not checked */
  slotsOf(type: string): Map<string, number> {
    let out = this.slots.get(type);
    if (out) return out;
    out = new Map();
    const descriptor = this.descriptor(type);
    descriptor?.properties.forEach((property, slot) => {
      if (property.isAttr || property.isBody || property.isVirtual) return;
      const names = new Set([property.name]);
      if (!property.isReference && property.type.startsWith('bpmn:')) {
        for (const bpmnType of this.bpmnTypes) {
          if (this.isA(bpmnType, property.type)) {
            names.add(bpmnType.charAt(5).toLowerCase() + bpmnType.slice(6));
          }
        }
      }
      if (!property.isReference && property.type.startsWith('bpmndi:')) {
        names.add(property.type.slice('bpmndi:'.length));
      }
      for (const name of names) {
        out!.set(name, out!.has(name) && out!.get(name) !== slot ? -1 : slot);
      }
    });
    for (const group of SAME_SLOT) {
      const at = group.map((name) => out!.get(name)).filter((slot): slot is number => slot !== undefined && slot >= 0);
      if (at.length < 2) continue;
      const first = Math.min(...at);
      for (const name of group) {
        if ((out.get(name) ?? -1) >= 0) out.set(name, first);
      }
    }
    this.slots.set(type, out);
    return out;
  }
}
