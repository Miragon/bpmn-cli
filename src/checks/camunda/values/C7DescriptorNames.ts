import { CAMUNDA, type CamundaElementType, ModdleParser } from '../../../model/index.js';

export class C7DescriptorNames {
  private static readonly TOP_LEVEL_TYPES = ['inputOutput', 'inputParameter', 'outputParameter', 'in', 'out', 'field', 'connector', 'properties', 'property', 'formData', 'formField', 'formProperty', 'taskListener', 'executionListener', 'failedJobRetryTimeCycle', 'errorEventDefinition', 'potentialStarter', 'list', 'map', 'entry', 'value', 'script', 'validation', 'constraint'];

  private readonly probe = ModdleParser.moddle();
  private readonly bpmnAttrNames = new Map<string, Set<string>>();

  attrNames(elementType: CamundaElementType): Set<string> {
    const own = elementType.properties.filter((property) => property.isAttr || property.isReference).map((property) => property.name);
    return new Set([...own, ...elementType.bpmnSuperTypes.flatMap((sup) => [...this.bpmnAttrsOf(sup)])]);
  }

  textChildNames(elementType: CamundaElementType): Set<string> {
    return new Set(elementType.properties.filter((property) => !property.isAttr && !property.isBody && !property.type.includes(':')).map((property) => property.name));
  }

  typeNames(): string[] {
    return C7DescriptorNames.TOP_LEVEL_TYPES.filter((typeName) => CAMUNDA.type(typeName));
  }

  private bpmnAttrsOf(sup: string): Set<string> {
    const known = this.bpmnAttrNames.get(sup) ?? this.readBpmnAttrs(sup);
    this.bpmnAttrNames.set(sup, known);
    return known;
  }

  private readBpmnAttrs(sup: string): Set<string> {
    try {
      const descriptor = this.probe.getElementDescriptor(this.probe.getType(sup)) as { properties?: Array<{ name: string; isAttr?: boolean; isReference?: boolean; isMany?: boolean }> };
      return new Set((descriptor.properties ?? []).filter((property) => property.isAttr || (property.isReference && !property.isMany)).map((property) => property.name));
    } catch {
      return new Set();
    }
  }
}
