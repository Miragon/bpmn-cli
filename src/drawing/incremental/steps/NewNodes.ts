import { DiagramIndex, type BpmnElement } from '../../../model/index.js';
import type { Plane } from '../../plane/Plane.js';
import type { ModelOrder } from '../run/ModelOrder.js';
import type { LayoutRun } from '../run/LayoutRun.js';
import type { BlockAdopter } from './BlockAdopter.js';
import type { Block, EngineDrawing } from './EngineDrawing.js';

export class NewNodes {
  private static readonly ARTIFACT_SHAPES = ['bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:TextAnnotation'];

  constructor(
    private readonly run: LayoutRun,
    private readonly order: ModelOrder,
    private readonly created: readonly string[],
    private readonly adopter: BlockAdopter,
    private readonly engine: () => Promise<EngineDrawing>,
  ) {}

  private static isFlowNode(element: BpmnElement): boolean {
    return element.is('bpmn:FlowNode');
  }

  async place(afterNode: (plane: Plane, id: string) => void): Promise<void> {
    const order = this.order.elements();
    const pending = this.pendingNodes(order);
    const inBlock = new Set<string>();
    const blocks = await this.blocksOf(pending, inBlock);
    await this.adoptCollapsedContent(pending, inBlock);
    const { hooks } = this.run.place;
    hooks.afterPlace = (plane, shape) => {
      const block = blocks.get(shape.id);
      if (block) {
        this.adopter.adopt(plane, block, shape.bounds.x - block.box.x, shape.bounds.y - block.box.y);
      }
    };
    hooks.afterNode = afterNode;
    const skipped = this.run.placer.placeFlowNodes(pending.filter((id) => !inBlock.has(id)));
    hooks.afterPlace = undefined;
    hooks.afterNode = undefined;
    skipped.forEach((id) => this.noteUndrawn(id));
    this.placeArtifacts(order, inBlock);
  }

  private drawn(id: string): boolean {
    return this.run.planes.some((plane) => plane.shapes.has(id));
  }

  private noteUndrawn(id: string): void {
    this.run.notes.push(`${id} not drawn: it belongs to no diagram`);
  }

  private pendingNodes(order: readonly BpmnElement[]): string[] {
    const rank = new Map(this.created.map((id, index) => [id, index]));
    const undrawn = order.flatMap((element) => {
      const id = element.peek<string>('id');
      return NewNodes.isFlowNode(element) && id && !this.drawn(id) ? [id] : [];
    });
    return undrawn.map((id, index) => ({ id, key: rank.get(id) ?? this.created.length + index })).sort((first, second) => first.key - second.key).map((entry) => entry.id);
  }

  private async blocksOf(pending: readonly string[], inBlock: Set<string>): Promise<Map<string, Block>> {
    const { semantics, place } = this.run;
    const roots = pending.filter((id) => {
      const element = semantics.byId.get(id)!;
      return DiagramIndex.isSubProcess(element) && !place.collapsed.has(id) && element.list('flowElements').some(NewNodes.isFlowNode) && !place.reuse.has(id);
    });
    const blocks = new Map<string, Block>();
    const engine = roots.length ? await this.engine() : undefined;
    for (const root of roots) {
      const block = inBlock.has(root) ? undefined : engine?.block(root, false);
      if (block) {
        place.blockSize.set(root, { width: block.box.width, height: block.box.height });
        [...block.shapes, ...block.planes.flatMap((plane) => [...plane.shapes.values()])].forEach((shape) => inBlock.add(shape.id));
        blocks.set(root, block);
      }
    }
    return blocks;
  }

  private async adoptCollapsedContent(pending: readonly string[], inBlock: Set<string>): Promise<void> {
    for (const id of pending) {
      const scopeId = this.collapsedScopeWithoutContent(id, inBlock);
      const plane = scopeId ? (await this.engine()).planes.find((candidate) => candidate.rootId === scopeId) : undefined;
      if (plane) {
        this.adopter.adopt(this.run.planes[0]!, { box: plane.contentBox()!, shapes: [], edges: [], planes: [plane] }, 0, 0);
        [...plane.shapes.keys()].forEach((shapeId) => inBlock.add(shapeId));
      }
    }
  }

  private collapsedScopeWithoutContent(id: string, inBlock: ReadonlySet<string>): string | undefined {
    const { semantics, planes, place } = this.run;
    const scope = semantics.scopeOf.get(id);
    const scopeId = scope?.peek<string>('id');
    if (!scope || !scopeId || !DiagramIndex.isSubProcess(scope) || inBlock.has(id) || planes.some((plane) => plane.rootId === scopeId)) {
      return undefined;
    }
    const shape = planes.map((plane) => plane.shapes.get(scopeId)).find((candidate) => !!candidate);
    const collapsed = shape ? !shape.expanded : place.collapsed.has(scopeId);
    const contentDrawn = scope.list('flowElements').some((element) => NewNodes.isFlowNode(element) && this.drawn(element.peek<string>('id') ?? ''));
    return collapsed && !contentDrawn ? scopeId : undefined;
  }

  private placeArtifacts(order: readonly BpmnElement[], inBlock: ReadonlySet<string>): void {
    for (const element of order) {
      const id = element.peek<string>('id');
      if (id && NewNodes.ARTIFACT_SHAPES.some((type) => element.is(type)) && !this.drawn(id) && !inBlock.has(id) && !this.run.placer.placeArtifact(id)) {
        this.noteUndrawn(id);
      }
    }
  }
}
