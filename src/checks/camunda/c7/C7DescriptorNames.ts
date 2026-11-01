import { CAMUNDA, type CamundaElementType, ModdleParser } from '../../../model/index.js';

export class C7DescriptorNames {
  private readonly probe = ModdleParser.moddle();
  private readonly bpmnAttrNames = new Map<string, Set<string>>();
  private typeNameCache: string[] | undefined;

  attrNames(elementType: CamundaElementType): Set<string> {
    const names = new Set(elementType.properties.filter((property) => property.isAttr || property.isReference).map((property) => property.name));
    for (const sup of elementType.bpmnSuperTypes) {
      let known = this.bpmnAttrNames.get(sup);
      if (!known) {
        known = new Set<string>();
        try {
          const descriptor = this.probe.getElementDescriptor(this.probe.getType(sup)) as { properties?: Array<{ name: string; isAttr?: boolean; isReference?: boolean; isMany?: boolean }> };
          for (const property of descriptor.properties ?? []) {
            if (property.isAttr || (property.isReference && !property.isMany)) {
              known.add(property.name);
            }
          }
        } catch {}
        this.bpmnAttrNames.set(sup, known);
      }
      for (const name of known) {
        names.add(name);
      }
    }
    return names;
  }

  textChildNames(elementType: CamundaElementType): Set<string> {
    return new Set(elementType.properties.filter((property) => !property.isAttr && !property.isBody && !property.type.includes(':')).map((property) => property.name));
  }

  typeNames(): string[] {
    if (this.typeNameCache) {
      return this.typeNameCache;
    }
    const names = new Set<string>();
    for (const typeName of ['inputOutput', 'inputParameter', 'outputParameter', 'in', 'out', 'field', 'connector', 'properties', 'property', 'formData', 'formField', 'formProperty', 'taskListener', 'executionListener', 'failedJobRetryTimeCycle', 'errorEventDefinition', 'potentialStarter', 'list', 'map', 'entry', 'value', 'script', 'validation', 'constraint']) {
      if (CAMUNDA.type(typeName)) {
        names.add(typeName);
      }
    }
    this.typeNameCache = [...names];
    return this.typeNameCache;
  }
}
