import type { CamundaElementType } from '../../CamundaDescriptor.js';
import type { RuleKit } from '../rule-kit.js';

/** The names the camunda descriptor defines, read once per profile and kept across runs. */
export class C7DescriptorNames {
  private probe: ReturnType<RuleKit['createModdle']> | undefined;
  private readonly bpmnAttrNames = new Map<string, Set<string>>();
  private typeNameCache: string[] | undefined;

  constructor(private readonly kit: RuleKit) {}

  /** Attribute names of a camunda type: its own, its camunda and its BPMN super types'. */
  attrNames(t: CamundaElementType): Set<string> {
    const names = new Set(t.properties.filter((p) => p.isAttr || p.isReference).map((p) => p.name));
    for (const sup of t.bpmnSuperTypes) {
      let known = this.bpmnAttrNames.get(sup);
      if (!known) {
        this.probe ??= this.kit.createModdle();
        known = new Set<string>();
        try {
          const d = this.probe.getElementDescriptor(this.probe.getType(sup)) as { properties?: Array<{ name: string; isAttr?: boolean; isReference?: boolean; isMany?: boolean }> };
          for (const p of d.properties ?? []) if (p.isAttr || (p.isReference && !p.isMany)) known.add(p.name);
        } catch {
          /* unknown BPMN type: nothing to add */
        }
        this.bpmnAttrNames.set(sup, known);
      }
      for (const n of known) names.add(n);
    }
    return names;
  }

  /** Child elements a camunda type takes as plain text (connectorId, expression, string). */
  textChildNames(t: CamundaElementType): Set<string> {
    return new Set(t.properties.filter((p) => !p.isAttr && !p.isBody && !p.type.includes(':')).map((p) => p.name));
  }

  /** The top-level extension element types a did-you-mean may suggest. */
  typeNames(): string[] {
    if (this.typeNameCache) return this.typeNameCache;
    const names = new Set<string>();
    for (const a of ['inputOutput', 'inputParameter', 'outputParameter', 'in', 'out', 'field', 'connector', 'properties', 'property', 'formData', 'formField', 'formProperty', 'taskListener', 'executionListener', 'failedJobRetryTimeCycle', 'errorEventDefinition', 'potentialStarter', 'list', 'map', 'entry', 'value', 'script', 'validation', 'constraint']) {
      if (this.kit.camunda.type(a)) names.add(a);
    }
    this.typeNameCache = [...names];
    return this.typeNameCache;
  }
}
