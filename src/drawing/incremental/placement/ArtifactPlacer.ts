import { Box, type BpmnElement } from '../../../model/index.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import type { ShapeSize } from '../../plane/ShapeSizes.js';
import type { NeighbourPlacer } from './NeighbourPlacer.js';
import type { PlacementObstacles } from './PlacementObstacles.js';
import type { PlacementState } from './PlacementState.js';

export class ArtifactPlacer {
  private static readonly STEPS = [0, 1, 2, 3, 4];

  constructor(
    private readonly state: PlacementState,
    private readonly obstacles: PlacementObstacles,
    private readonly neighbours: NeighbourPlacer,
  ) {}

  private static idOf(element: BpmnElement | undefined): string | undefined {
    return element?.peek<string>('id');
  }

  private static anchorIn(other: BpmnElement, id: string): string | undefined {
    if (other.is('bpmn:Association')) {
      const sourceId = ArtifactPlacer.idOf(other.peek<BpmnElement>('sourceRef'));
      const targetId = ArtifactPlacer.idOf(other.peek<BpmnElement>('targetRef'));
      if (sourceId === id) {
        return targetId;
      }
      return targetId === id ? sourceId : undefined;
    }
    const reads = other.is('bpmn:DataInputAssociation') && other.list('sourceRef').some((reference) => ArtifactPlacer.idOf(reference) === id);
    const writes = other.is('bpmn:DataOutputAssociation') && ArtifactPlacer.idOf(other.peek<BpmnElement>('targetRef')) === id;
    return reads || writes ? ArtifactPlacer.idOf(other.parent) : undefined;
  }

  private static annotationSpots(anchor: Box, { width, height }: ShapeSize): Box[] {
    const around = ArtifactPlacer.STEPS.flatMap((step) => [new Box(anchor.right + 20 + step * 30, anchor.y - 30 - height - step * 20, width, height), new Box(anchor.center.x + step * 40, anchor.y - 40 - height - step * 30, width, height)]);
    const beside = ArtifactPlacer.STEPS.flatMap((step) => [new Box(anchor.right + 30 + step * (width + 20), anchor.y - height / 2, width, height), new Box(anchor.right + 20, anchor.bottom + 30 + step * (height + 20), width, height)]);
    return [...around, ...beside];
  }

  private static dataSpots(anchor: Box, { width, height }: ShapeSize): Box[] {
    return ArtifactPlacer.STEPS.flatMap((step) => [new Box(anchor.right + 10 + step * (width + 20), anchor.bottom + 30, width, height), new Box(anchor.right + 10, anchor.bottom + 30 + step * (height + 20), width, height)]);
  }

  placeArtifact(plane: Plane, id: string): void {
    const element = this.state.semantics.byId.get(id)!;
    const size = this.state.sizeFor(id);
    const anchor = this.anchorsOf(id).map((anchorId) => plane.shapes.get(anchorId)).find((shape): shape is PlaneShape => !!shape);
    if (!anchor) {
      this.neighbours.placeUnconnected(plane, id);
      return;
    }
    const anchorBox = this.state.drawing(plane).space.unitBox(anchor);
    const spots = element.is('bpmn:TextAnnotation') ? ArtifactPlacer.annotationSpots(anchorBox, size) : ArtifactPlacer.dataSpots(anchorBox, size);
    const frame = new Frames(plane).of(this.state.probeOf(plane, id));
    const { x, y, width, height } = this.bestSpot(plane, frame, new Set([id, ...this.obstacles.homeGroups(plane, [anchor])]), spots);
    this.state.commit(plane, this.state.newShape(plane, id, new Box(Math.round(x), Math.round(y), width, height)));
  }

  private bestSpot(plane: Plane, frame: PlaneShape | undefined, exclude: ReadonlySet<string>, spots: readonly Box[]): Box {
    const blockers = this.obstacles.of(plane, frame, exclude);
    const lines = this.obstacles.edgeBoxes(plane);
    const inner = frame ? Frames.interior(frame, 5) : undefined;
    const inFrame = (box: Box): boolean => !inner || (box.x >= inner.x && box.y >= inner.y);
    const roomy = (box: Box): boolean => this.obstacles.isFree(box, blockers, 15) && !lines.some((line) => line.overlaps(box, 2)) && inFrame(box);
    const tight = (box: Box): boolean => this.obstacles.isFree(box, blockers, 10) && inFrame(box);
    return spots.find(roomy) ?? spots.find(tight) ?? spots[0]!;
  }

  private anchorsOf(id: string): string[] {
    return [...this.state.semantics.byId.values()].flatMap((other) => ArtifactPlacer.anchorIn(other, id) ?? []);
  }
}
