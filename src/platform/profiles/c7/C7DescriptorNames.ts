import type { CamundaElementType } from '../../CamundaDescriptor.js';
import type { RuleKit } from '../rule-kit.js';

/** The names the camunda descriptor defines, read once per profile and kept across runs. */
export class C7DescriptorNames {
  private probe: ReturnType<RuleKit['createModdle']> | undefined;
  private readonly bpmnAttrNames = new Map<string, Set<string>>();
  private typeNameCache: string[] | undefined;

  constructor(private readonly kit: RuleKit) {}

  /** Attribute names of a camunda type: its own, its camunda and its BPMN super types'. */
  attrNames(elementType: CamundaElementType): Set<string> {
    const names = new Set(elementType.properties.filter((property) => property.isAttr || property.isReference).map((property) => property.name));
    for (const sup of elementType.bpmnSuperTypes) {
      let known = this.bpmnAttrNames.get(sup);
      if (!known) {
        this.probe ??= this.kit.createModdle();
        known = new Set<string>();
        try {
          const descriptor = this.probe.getElementDescriptor(this.probe.getType(sup)) as { properties?: Array<{ name: string; isAttr?: boolean; isReference?: boolean; isMany?: boolean }> };
          for (const property of descriptor.properties ?? []) if (property.isAttr || (property.isReference && !property.isMany)) known.add(property.name);
        } catch {
          /* unknown BPMN type: nothing to add */
        }
        this.bpmnAttrNames.set(sup, known);
      }
      for (const name of known) names.add(name);
    }
    return names;
  }

  /** Child elements a camunda type takes as plain text (connectorId, expression, string). */
  textChildNames(elementType: CamundaElementType): Set<string> {
    return new Set(elementType.properties.filter((property) => !property.isAttr && !property.isBody && !property.type.includes(':')).map((property) => property.name));
  }

  /** The top-level extension element types a did-you-mean may suggest. */
  typeNames(): string[] {
    if (this.typeNameCache) return this.typeNameCache;
    const names = new Set<string>();
    for (const typeName of ['inputOutput', 'inputParameter', 'outputParameter', 'in', 'out', 'field', 'connector', 'properties', 'property', 'formData', 'formField', 'formProperty', 'taskListener', 'executionListener', 'failedJobRetryTimeCycle', 'errorEventDefinition', 'potentialStarter', 'list', 'map', 'entry', 'value', 'script', 'validation', 'constraint']) {
      if (this.kit.camunda.type(typeName)) names.add(typeName);
    }
    this.typeNameCache = [...names];
    return this.typeNameCache;
  }
}
