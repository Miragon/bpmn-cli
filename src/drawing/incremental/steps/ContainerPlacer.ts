import { Box, DiagramIndex, type BpmnElement } from '../../../model/index.js';
import type { DrawingSnapshot } from '../../DrawingSnapshot.js';
import type { EngineDrawing } from '../../full/FullLayout.js';
import { Plane } from '../../plane/Plane.js';
import { ModelOrder } from '../run/ModelOrder.js';
import type { LayoutRun } from '../run/LayoutRun.js';
import type { BlockAdopter } from './BlockAdopter.js';

export class ContainerPlacer {
  constructor(
    private readonly run: LayoutRun,
    private readonly before: DrawingSnapshot,
    private readonly adopter: BlockAdopter,
    private readonly engine: () => Promise<EngineDrawing>,
  ) {}

  private static idOf(element: BpmnElement | undefined): string | undefined {
    return element?.peek<string>('id');
  }

  followRoot(): string | undefined {
    const root = this.run.document.diagram.layoutRoot();
    const rootId = ContainerPlacer.idOf(root);
    if (!root || !rootId || rootId === this.before.rootId || !root.is('bpmn:Collaboration')) {
      return undefined;
    }
    const old = this.run.planes.find((plane) => plane.rootId === this.before.rootId);
    if (!old || this.run.planes.some((plane) => plane.rootId === rootId)) {
      return undefined;
    }
    old.root = root;
    old.rootId = rootId;
    const wrapper = root.list('participants').find((participant) => ContainerPlacer.idOf(participant.peek<BpmnElement>('processRef')) === this.before.rootId);
    const poolId = ContainerPlacer.idOf(wrapper);
    for (const shape of poolId ? old.shapes.values() : []) {
      if (!shape.poolId && shape.kind !== 'participant') {
        shape.poolId = poolId;
      }
    }
    return poolId;
  }

  async placeContainers(wrapped: string | undefined): Promise<void> {
    const drawn = new Set(this.run.planes.flatMap((plane) => [...plane.shapes.keys()]));
    for (const element of new ModelOrder(this.run.document.tree.definitions).elements()) {
      const id = ContainerPlacer.idOf(element);
      const plane = id && !drawn.has(id) && (element.is('bpmn:Participant') || element.is('bpmn:Lane')) ? this.run.semantics.homePlane(this.run.planes, id) : undefined;
      if (id && plane) {
        const placed = element.is('bpmn:Participant') ? await this.placePool(plane, id, element, wrapped) : this.placeLane(plane, id);
        if (placed) {
          this.run.place.placed.add(id);
          drawn.add(id);
        }
      }
    }
  }

  planeFor(id: string): Plane | undefined {
    const { semantics, planes, place } = this.run;
    const home = semantics.homePlane(planes, id);
    const element = semantics.byId.get(id);
    if (home || !element) {
      return home;
    }
    const anchor = element.is('bpmn:DataAssociation') ? ContainerPlacer.idOf(element.parent) : id;
    const scope = anchor ? semantics.scopeOf.get(anchor) : undefined;
    const scopeId = ContainerPlacer.idOf(scope);
    if (!scope || !scopeId || !DiagramIndex.isSubProcess(scope)) {
      return undefined;
    }
    const shape = planes.map((plane) => plane.shapes.get(scopeId)).find((candidate) => !!candidate);
    if (shape?.expanded || (!shape && !(place.collapsed.has(scopeId) && this.planeFor(scopeId)))) {
      return undefined;
    }
    const plane = new Plane(`BPMNPlane_${scopeId}`, scopeId, scope);
    planes.push(plane);
    return plane;
  }

  private async placePool(plane: Plane, id: string, element: BpmnElement, wrapped: string | undefined): Promise<boolean> {
    const shape = this.run.place.newShape(plane, id, new Box(0, 0, 0, 0));
    const process = element.peek<BpmnElement>('processRef');
    const hasContent = id !== wrapped && !!process?.list('flowElements').some((flowElement) => flowElement.is('bpmn:FlowNode'));
    const block = hasContent ? (await this.engine()).block(id, true) : undefined;
    const { frames } = this.run.drawing(plane);
    if (id === wrapped) {
      frames.wrapPool(shape);
    } else {
      frames.placePool(shape, !process, block ? { width: block.box.width, height: block.box.height } : undefined);
    }
    plane.shapes.set(id, shape);
    if (block) {
      this.adopter.adopt(plane, block, shape.bounds.x - block.box.x, shape.bounds.y - block.box.y);
    }
    return true;
  }

  private placeLane(plane: Plane, id: string): boolean {
    const shape = this.run.place.newShape(plane, id, new Box(0, 0, 0, 0));
    if (!this.run.drawing(plane).frames.placeLane(shape)) {
      this.run.notes.push(`lane ${id} not drawn: its process has no pool in the diagram`);
      return false;
    }
    plane.shapes.set(id, shape);
    return true;
  }
}
