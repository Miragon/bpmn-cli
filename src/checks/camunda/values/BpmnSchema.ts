import { type BpmnModdle } from '../../../model/index.js';

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
  static readonly BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
  private static readonly SAME_SLOT = [
  ['timeDate', 'timeDuration', 'timeCycle'],
  ['source', 'target'],
  ['supportedInterfaceRef', 'ioSpecification', 'ioBinding'],
  ['auditing', 'monitoring', 'categoryValueRef', 'dataState'],
  ['resourceRef', 'resourceParameterBinding', 'resourceAssignmentExpression'],
  ['dataOutputRefs', 'optionalOutputRefs', 'whileExecutingOutputRefs', 'inputSetRefs'],
  ['participantMultiplicity', 'endPointRef', 'endPointRefs'],
];

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

  typeOf(local: string, uri: string, parentType: string | undefined): string | undefined {
    const prefix = this.prefixOf(uri);
    if (!prefix) {
      return undefined;
    }
    const own = `${prefix}:${local.charAt(0).toUpperCase()}${local.slice(1)}`;
    if (this.descriptor(own)) {
      return own;
    }
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

  slotsOf(type: string): Map<string, number> {
    const known = this.slots.get(type);
    if (known) {
      return known;
    }
    const out = new Map<string, number>();
    this.descriptor(type)?.properties.forEach((property, slot) => {
      if (property.isAttr || property.isBody || property.isVirtual) {
        return;
      }
      for (const name of this.elementNames(property)) {
        out.set(name, out.has(name) && out.get(name) !== slot ? -1 : slot);
      }
    });
    BpmnSchema.SAME_SLOT.forEach((group) => BpmnSchema.shareSlot(group, out));
    this.slots.set(type, out);
    return out;
  }

  private prefixOf(uri: string): string | undefined {
    if (uri === this.bpmnNs) {
      return 'bpmn';
    }
    return uri === BpmnSchema.BPMNDI_NS ? 'bpmndi' : undefined;
  }

  private elementNames(property: Descriptor['properties'][number]): Set<string> {
    const names = new Set([property.name]);
    if (property.isReference) {
      return names;
    }
    if (property.type.startsWith('bpmn:')) {
      this.bpmnTypes.filter((bpmnType) => this.isA(bpmnType, property.type)).forEach((bpmnType) => names.add(bpmnType.charAt(5).toLowerCase() + bpmnType.slice(6)));
    }
    if (property.type.startsWith('bpmndi:')) {
      names.add(property.type.slice('bpmndi:'.length));
    }
    return names;
  }

  private static shareSlot(group: string[], slots: Map<string, number>): void {
    const at = group.map((name) => slots.get(name)).filter((slot): slot is number => slot !== undefined && slot >= 0);
    if (at.length < 2) {
      return;
    }
    const first = Math.min(...at);
    for (const name of group) {
      if ((slots.get(name) ?? -1) >= 0) {
        slots.set(name, first);
      }
    }
  }
}
