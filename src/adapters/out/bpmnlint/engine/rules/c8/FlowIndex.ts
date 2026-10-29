import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

/** The sequence flows out of each flow node, indexed once per (sub-)process. */
export class FlowIndex {
  private readonly byContainer = new WeakMap<object, Map<ModdleElement, ModdleElement[]>>();

  /** The sequence flows whose sourceRef is `node`, in document order. */
  outgoing(node: ModdleElement): ModdleElement[] {
    const container = node.$parent;
    if (!container) return [];
    let bySource = this.byContainer.get(container);
    if (!bySource) {
      bySource = this.index(container);
      this.byContainer.set(container, bySource);
    }
    return bySource.get(node) ?? [];
  }

  private index(container: ModdleElement): Map<ModdleElement, ModdleElement[]> {
    const bySource = new Map<ModdleElement, ModdleElement[]>();
    for (const element of container.get?.('flowElements') ?? []) {
      const source = is(element, 'bpmn:SequenceFlow') ? element.get('sourceRef') : undefined;
      if (!source) continue;
      const flows = bySource.get(source) ?? [];
      flows.push(element);
      bySource.set(source, flows);
    }
    return bySource;
  }
}
