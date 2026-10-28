import type { ModdleElement, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';

/** The property path from `ancestor` down to `descendant`, `['eventDefinitions', 0]`. */
export function pathFrom(ancestor: ModdleElement, descendant: ModdleElement): ReportPath {
  const path: ReportPath = [];
  for (let child = descendant; child && child !== ancestor; child = child.$parent) {
    path.unshift(...stepInto(child.$parent, child));
  }
  return path;
}

function stepInto(parent: ModdleElement, child: ModdleElement): ReportPath {
  for (const property of parent?.$descriptor?.properties ?? []) {
    const value = parent.get(property.name);
    if (value === child) {
      return [property.name];
    }
    if (Array.isArray(value) && value.includes(child)) {
      return [property.name, value.indexOf(child)];
    }
  }
  return [];
}
