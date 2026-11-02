import type { BpmnElement } from '../document/BpmnElement.js';
import type { BpmnTree } from '../document/BpmnTree.js';
import { Box } from '../geometry/Box.js';

export class DiagramIndex {
  static readonly SUB_PROCESS_TYPES: readonly string[] = ['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction'];

  constructor(private readonly tree: BpmnTree) {}

  static displayRoot(definitions: BpmnElement | undefined): BpmnElement | undefined {
    return definitions?.list('rootElements').find((root) => root.is('bpmn:Process') || root.is('bpmn:Collaboration'));
  }

  static boxOf(bounds: BpmnElement | undefined): Box | undefined {
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((name) => bounds?.peek<number>(name)) as [number, number, number, number];
    return [x, y, width, height].every(Number.isFinite) ? new Box(x, y, width, height) : undefined;
  }

  static isSubProcess(element: BpmnElement | undefined): boolean {
    return !!element && DiagramIndex.SUB_PROCESS_TYPES.some((type) => element.is(type));
  }

  layoutRoot(): BpmnElement | undefined {
    return this.tree.collaboration() ?? this.tree.processes()[0];
  }

  planes(): BpmnElement[] {
    return this.tree.definitions.list('diagrams').flatMap((diagram) => diagram.get<BpmnElement | undefined>('plane') ?? []);
  }

  expansionState(): Map<string, boolean> {
    const state = new Map<string, boolean>();
    for (const shape of this.planes().flatMap((plane) => plane.list('planeElement'))) {
      const target = shape.is('bpmndi:BPMNShape') ? shape.get<BpmnElement | undefined>('bpmnElement') : undefined;
      const id = target?.get<string | undefined>('id');
      if (id && DiagramIndex.isSubProcess(target)) {
        state.set(id, shape.get<boolean | undefined>('isExpanded') === true);
      }
    }
    return state;
  }

  expandedIds(requests: { expand?: Iterable<string>; collapse?: Iterable<string> } = {}): Set<string> {
    const state = this.expansionState();
    const known = new Set([...this.tree.walk()].filter((element) => DiagramIndex.isSubProcess(element) && !!element.get('id')).map((element) => element.id));
    const expanded = new Set([...known].filter((id) => state.get(id) !== false));
    for (const id of requests.expand ?? []) {
      if (known.has(id)) {
        expanded.add(id);
      }
    }
    for (const id of requests.collapse ?? []) {
      expanded.delete(id);
    }
    return expanded;
  }
}
