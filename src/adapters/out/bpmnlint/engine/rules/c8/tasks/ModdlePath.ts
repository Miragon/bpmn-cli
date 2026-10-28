import type { ModdleElement, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';

/**
 * Where a finding on a nested element goes: the element it is reported on, and the path from
 * there to the nested element, the way camunda-compat spells it.
 */
export class ModdlePath {
  /**
   * The element a finding on `node` is reported on: the flow node or flow of an event definition,
   * loop or condition, else the nearest element with an id (`node` itself when it has one).
   */
  static ownerOf(node: ModdleElement): ModdleElement | undefined {
    const parent = node.$parent;
    if (parent?.id && ModdlePath.isNestedPart(node, parent)) {
      return parent;
    }
    let owner = node;
    while (owner && !owner.id) {
      owner = owner.$parent;
    }
    return owner;
  }

  /** The property steps from `ancestor` down to `descendant`: `['loopCharacteristics', 'extensionElements', 'values', 0]`. */
  static between(ancestor: ModdleElement, descendant: ModdleElement): ReportPath {
    const steps: ReportPath[] = [];
    let child = descendant;
    while (child && child !== ancestor && child.$parent) {
      steps.unshift(ModdlePath.stepTo(child.$parent, child));
      child = child.$parent;
    }
    return steps.flat();
  }

  private static isNestedPart(node: ModdleElement, parent: ModdleElement): boolean {
    return (
      (parent.eventDefinitions ?? []).includes(node) ||
      parent.loopCharacteristics === node ||
      parent.conditionExpression === node
    );
  }

  private static stepTo(parent: ModdleElement, child: ModdleElement): ReportPath {
    for (const property of parent.$descriptor?.properties ?? []) {
      const value = parent[property.name];
      if (value === child) {
        return [property.name];
      }
      const index = Array.isArray(value) ? value.indexOf(child) : -1;
      if (index !== -1) {
        return [property.name, index];
      }
    }
    return [];
  }
}
