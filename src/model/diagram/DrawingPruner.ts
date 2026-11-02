import type { BpmnElement } from '../document/BpmnElement.js';
import { DiagramIndex } from './DiagramIndex.js';

export class DrawingPruner {
  static readonly UNKNOWN_ID = '?';

  private static idOf(element: BpmnElement | undefined): string | undefined {
    return element?.peek<string>('id');
  }

  private static targetOf(planeElement: BpmnElement): BpmnElement | undefined {
    return planeElement.peek<BpmnElement>('bpmnElement');
  }

  private static rootOf(definitions: BpmnElement, plane: BpmnElement | undefined): BpmnElement | undefined {
    return (plane && DrawingPruner.targetOf(plane)) ?? (plane ? DiagramIndex.displayRoot(definitions) : undefined);
  }

  static prune(definitions: BpmnElement, byId: ReadonlyMap<string, BpmnElement>): string[] {
    const pruned: string[] = [];
    for (const diagram of [...definitions.list('diagrams')].reverse()) {
      const plane = diagram.peek<BpmnElement>('plane');
      const root = DrawingPruner.rootOf(definitions, plane);
      const rootId = DrawingPruner.idOf(root);
      if (!plane || !root || !rootId || byId.get(rootId) !== root) {
        definitions.remove('diagrams', diagram);
      } else {
        pruned.push(...DrawingPruner.pruneShapes(plane, byId));
      }
    }
    return pruned.reverse();
  }

  static pruneEdges(definitions: BpmnElement, stale: (edge: BpmnElement, plane: BpmnElement, further: boolean) => boolean): string[] {
    const pruned: string[] = [];
    const shown = new Set<string>();
    for (const diagram of definitions.list('diagrams')) {
      const plane = diagram.peek<BpmnElement>('plane');
      const rootId = DrawingPruner.idOf(DrawingPruner.rootOf(definitions, plane));
      if (plane && rootId) {
        const further = shown.has(rootId);
        shown.add(rootId);
        for (const edge of plane.list('planeElement').filter((element) => element.is('bpmndi:BPMNEdge') && stale(element, plane, further))) {
          plane.remove('planeElement', edge);
          pruned.push(DrawingPruner.idOf(DrawingPruner.targetOf(edge)) ?? DrawingPruner.idOf(edge) ?? DrawingPruner.UNKNOWN_ID);
        }
      }
    }
    return pruned;
  }

  private static pruneShapes(plane: BpmnElement, byId: ReadonlyMap<string, BpmnElement>): string[] {
    const pruned: string[] = [];
    for (const planeElement of [...plane.list('planeElement')].reverse()) {
      const target = DrawingPruner.targetOf(planeElement);
      const id = DrawingPruner.idOf(target);
      if (!target || !id || byId.get(id) !== target) {
        plane.remove('planeElement', planeElement);
        pruned.push(id ?? DrawingPruner.idOf(planeElement) ?? DrawingPruner.UNKNOWN_ID);
      }
    }
    return pruned;
  }
}
