import { Box, BpmnError, type BpmnElement, type Point } from '../../../model/index.js';
import type { Drawing } from '../../incremental/Drawing.js';
import type { OperationBefore } from '../../incremental/OperationBefore.js';
import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import { Semantics } from '../../plane/Semantics.js';
import { ShapeSides } from '../../plane/ShapeSides.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';
import { RoomMaker } from './RoomMaker.js';

type Border = 'top' | 'bottom';

interface Move {
  plane: Plane;
  event: DShape;
  host: DShape;
  side: Border;
  frame: DShape | undefined;
  path: DShape[];
}

export class BoundaryPlacement {
  private static readonly FRAME_PAD = 15;
  private static readonly SPOT_STEP = 4;
  private static readonly CLEARANCE = 4;

  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly before: OperationBefore,
    private readonly notes: string[],
  ) {}

  private static mirrorOffset(node: DShape, host: DShape): number {
    return Math.round(2 * host.bounds.center.y - 2 * node.bounds.center.y);
  }

  private static docksOn(plane: Plane, eventId: string, hostId: string): Point[] {
    const docks: Point[] = [];
    for (const { points, sourceId, targetId } of plane.edges.values()) {
      if (points.length < 2 || sourceId === eventId || targetId === eventId) {
        continue;
      }
      if (sourceId === hostId) {
        docks.push(points[0]!);
      }
      if (targetId === hostId) {
        docks.push(points.at(-1)!);
      }
    }
    return docks;
  }

  private static spotCentres(start: number, offset: number): number[] {
    return offset ? [start + offset, start - offset] : [start];
  }

  private static notABoundary(id: string, event: DShape): BpmnError {
    return BpmnError.model('E_WRONG_KIND', `"${id}" is ${event.kind === 'boundary' ? 'a boundary event without a drawn host' : `a ${event.kind}`}: side moves a boundary event to a border of its host`, {
      element: id,
      hint: 'Give the boundary event (`bpmn show <file> <hostId>` lists them); other shapes take a row and / or a column: --row-of, --below, --above, --column-of, --after, --before.',
    });
  }

  private static hasLaneBelow(plane: Plane, frame: DShape): boolean {
    return [...plane.shapes.values()].some((lane) => lane.kind === 'lane' && lane !== frame && lane.poolId === frame.poolId && lane.bounds.y >= frame.bounds.bottom - 1);
  }

  run(id: string, side: Border): string[] {
    const { plane, shape: event } = this.diagram.drawnShape(id);
    const host = event.hostId ? plane.shapes.get(event.hostId) : undefined;
    if (event.kind !== 'boundary' || !host) {
      throw BoundaryPlacement.notABoundary(id, event);
    }
    const from = ShapeSides.attached(event.bounds, host.bounds);
    if (from === side) {
      this.notes.push(`${id} is already on the ${side} border of ${host.id}`);
      return [];
    }
    const path = from === 'top' || from === 'bottom' ? this.exceptionPath(plane, event, host, from) : [];
    const move: Move = { plane, event, host, side, path, frame: new Frames(plane).of(host) };
    this.makeRoomForPath(move);
    return this.moveAcross(move);
  }

  private exceptionPath(plane: Plane, event: DShape, host: DShape, side: Border): DShape[] {
    const frames = new Frames(plane);
    const home = frames.of(host);
    const beyond = (box: Box): boolean => (side === 'bottom' ? box.y >= host.bounds.bottom - 0.5 : box.bottom <= host.bounds.y + 0.5);
    const followable = (node: DShape): boolean => node.id !== host.id && node.isLeaf && node.kind !== 'boundary' && beyond(node.bounds) && frames.of(node) === home;
    const { byId } = this.diagram.semantics;
    const path: DShape[] = [];
    const inPath = new Set([event.id]);
    for (const id of inPath) {
      for (const flow of Semantics.sequenceFlows(byId.get(id), 'outgoing')) {
        const node = plane.shapes.get(flow.peek<BpmnElement>('targetRef')?.peek<string>('id') ?? '');
        const onlyFromPath = (candidate: DShape): boolean => Semantics.sequenceFlows(byId.get(candidate.id), 'incoming').every((incoming) => inPath.has(incoming.peek<BpmnElement>('sourceRef')?.peek<string>('id') ?? ''));
        if (node && !inPath.has(node.id) && followable(node) && onlyFromPath(node)) {
          inPath.add(node.id);
          path.push(node);
        }
      }
    }
    return path;
  }

  private makeRoomForPath({ plane, host, side, frame, path }: Move): void {
    const onFrame = frame ? path.filter((node) => new Frames(plane).of(node) === frame) : [];
    if (!frame || !onFrame.length) {
      return;
    }
    const drawing = this.diagram.drawing(plane);
    if (side === 'top') {
      this.makeRoomAbove(drawing, host, frame, onFrame);
    } else if (frame.kind === 'lane' && BoundaryPlacement.hasLaneBelow(plane, frame)) {
      this.makeRoomBelow(drawing, host, frame, onFrame);
    }
  }

  private makeRoomAbove(drawing: Drawing, host: DShape, frame: DShape, path: readonly DShape[]): void {
    const top = Math.min(...path.map((node) => drawing.space.unitBox(node).y + BoundaryPlacement.mirrorOffset(node, host)));
    const deficit = Math.ceil(Frames.interior(frame, BoundaryPlacement.FRAME_PAD).y - top);
    if (deficit > 0) {
      const inSubProcess = frame.kind === 'subProcess';
      drawing.space.makeSpace({ axis: 'y', line: frame.bounds.y + 1, delta: deficit, anchors: [host.id], ...(inSubProcess ? { frame: frame.id, within: frame.bounds.copy() } : {}) });
      this.notes.push(`made ${deficit} px of room above ${host.id} in its ${frame.frameWord} ${frame.id}`);
    }
  }

  private makeRoomBelow(drawing: Drawing, host: DShape, frame: DShape, path: readonly DShape[]): void {
    const low = Math.max(...path.map((node) => drawing.space.unitBox(node).bottom + BoundaryPlacement.mirrorOffset(node, host)));
    const deficit = Math.ceil(low - Frames.interior(frame, BoundaryPlacement.FRAME_PAD).bottom);
    if (deficit > 0) {
      drawing.space.makeSpace({ axis: 'y', line: frame.bounds.bottom - 1, delta: deficit, anchors: [frame.id] });
      this.notes.push(`made ${deficit} px of room below ${host.id} in its lane ${frame.id}`);
    }
  }

  private moveAcross({ plane, event, host, side, path }: Move): string[] {
    const hostBox = host.bounds;
    const spot = this.freeSpot(plane, event, host, side);
    const { x, y, width, height } = event.bounds;
    event.bounds = new Box(spot.x, spot.y, width, height);
    event.label?.translate(spot.x - x, spot.y - y);
    const drawing = this.diagram.drawing(plane);
    const room = new RoomMaker(plane, drawing);
    this.movePath(room, drawing, host, side, path);
    const holds = (): boolean => ShapeSides.attached(event.bounds, host.bounds) === side && path.every((node) => (side === 'top' ? node.bounds.bottom <= hostBox.y : node.bounds.y >= hostBox.bottom));
    if (path.length) {
      room.makeRoom({ moved: path, references: [host], before: this.before, target: `on the ${side} side of ${host.id}`, holds, lock: ['y'] }, this.notes);
    }
    if (event.label) {
      drawing.labels.placeShapeLabel(event);
    }
    const rerouted = this.rerouted(drawing, event);
    this.notes.push(`${event.id} moved to the ${side} border of ${host.id}${path.length ? `; its path followed (${path.map((node) => node.id).join(', ')})` : ''}`);
    return rerouted;
  }

  private movePath(room: RoomMaker, drawing: Drawing, host: DShape, side: Border, path: readonly DShape[]): void {
    const shifts = path.map((node) => ({ node, offset: BoundaryPlacement.mirrorOffset(node, host) }));
    for (const { node, offset } of shifts) {
      room.checkFrames([node], 0, offset, `on the ${side} side of ${host.id}`, [host]);
    }
    for (const { node, offset } of shifts) {
      drawing.space.shiftShape(node.id, 0, offset);
    }
  }

  private rerouted(drawing: Drawing, event: DShape): string[] {
    const rerouted = drawing.settle(this.before);
    for (const edge of drawing.plane.edges.values()) {
      if (edge.sourceId === event.id && !rerouted.includes(edge.id) && drawing.reroute(edge)) {
        rerouted.push(edge.id);
      }
    }
    return rerouted;
  }

  private freeSpot(plane: Plane, event: DShape, host: DShape, side: Border): Box {
    const spot = this.spotOnBorder(plane, event, host, side);
    if (!spot) {
      throw BpmnError.model('E_NO_ROOM', `There is no room for ${event.id} on the ${side} border of ${host.id}: other boundary events and docking connections take it`, {
        element: event.id,
        related: [host.id],
        hint: `Move another boundary event of ${host.id} first, or route the connections docking there to another side (\`bpmn route <file> <flowId> --entry left\`).`,
      });
    }
    return spot;
  }

  private spotOnBorder(plane: Plane, event: DShape, host: DShape, side: Border): Box | undefined {
    const hostBox = host.bounds;
    const { width, height } = event.bounds;
    const y = Math.round((side === 'top' ? hostBox.y : hostBox.bottom) - height / 2);
    const others = plane.boundariesOf(host.id).filter(({ id }) => id !== event.id).map(({ bounds }) => bounds);
    const docks = BoundaryPlacement.docksOn(plane, event.id, host.id);
    const { CLEARANCE } = BoundaryPlacement;
    const free = (box: Box): boolean => !others.some((other) => other.overlaps(box, CLEARANCE)) && !docks.some((dock) => dock.x > box.x - CLEARANCE && dock.x < box.right + CLEARANCE && dock.y > box.y - CLEARANCE && dock.y < box.bottom + CLEARANCE);
    const low = hostBox.x + width / 2;
    const high = hostBox.right - width / 2;
    const start = Math.min(high, Math.max(low, event.bounds.center.x));
    for (let offset = 0; offset <= hostBox.width; offset += BoundaryPlacement.SPOT_STEP) {
      for (const centre of BoundaryPlacement.spotCentres(start, offset)) {
        const candidate = new Box(Math.round(centre - width / 2), y, width, height);
        if (centre >= low - 0.5 && centre <= high + 0.5 && free(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  }
}
