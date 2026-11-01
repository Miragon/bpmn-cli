import { Box } from '../../../model/index.js';
import { DrawingCheckpoint } from '../../plane/DrawingCheckpoint.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';
import type { SpaceResult } from './SpacePass.js';
import { SpaceTool } from './SpaceTool.js';

export interface RowGap {
  box: Box;
  frame: DShape | undefined;
  from: number;
  to: number;
  gap: number;
  ignore: ReadonlySet<string>;
}

export class RowCloser {
  private static readonly ROW_PAD = 10;
  private static readonly CLEARANCE = 10;
  private static readonly TOLERANCE = 3;
  private static readonly FAR_LEFT = -1e7;
  private static readonly ANY_WIDTH = 2e7;

  constructor(private readonly plane: Plane) {}

  private static relation(box: Box, frame: Box): number {
    if (box.isInside(frame)) {
      return 2;
    }
    return box.overlaps(frame) ? 1 : 0;
  }

  close({ box, frame, from, to, gap, ignore }: RowGap): SpaceResult | undefined {
    const frameBox = frame?.bounds;
    const row = new Box(frameBox ? frameBox.x : RowCloser.FAR_LEFT, box.y - RowCloser.ROW_PAD, frameBox ? frameBox.width : RowCloser.ANY_WIDTH, box.height + 2 * RowCloser.ROW_PAD);
    const onRow = this.plane.leaves().filter((shape) => shape.bounds.y < row.bottom && shape.bounds.bottom > row.y && (!frameBox || (shape.bounds.x >= frameBox.x && shape.bounds.x <= frameBox.right)));
    const end = Math.min(to, ...onRow.filter((shape) => shape.bounds.x >= box.right - 1).map((shape) => shape.bounds.x));
    if (!onRow.some((shape) => shape.bounds.x >= end - RowCloser.TOLERANCE)) {
      return undefined;
    }
    const saved = new DrawingCheckpoint(this.plane);
    const result = new SpaceTool(this.plane).closeStrip({ axis: 'x', from, to: end, gap, ignore, within: row });
    if (!result) {
      return undefined;
    }
    if (this.clashes(result, saved) || this.crossesFrame(result, saved) || this.tethered(result, end, frameBox) || result.resized.size) {
      saved.restore();
      return undefined;
    }
    return result;
  }

  private clashes({ moved }: SpaceResult, saved: DrawingCheckpoint): boolean {
    const { CLEARANCE } = RowCloser;
    const leaves = this.plane.leaves();
    const stayers = leaves.filter((leaf) => !moved.has(leaf.id));
    const movers = leaves.filter((leaf) => moved.has(leaf.id));
    const newlyOver = (shape: DShape, other: DShape): boolean => shape.bounds.overlaps(other.bounds, CLEARANCE) && !saved.boundsOf(shape).overlaps(saved.boundsOf(other), CLEARANCE);
    const onLeaf = movers.some((mover) => stayers.some((other) => other.id !== mover.hostId && other.hostId !== mover.id && newlyOver(mover, other)));
    const subs = [...this.plane.shapes.values()].filter((shape) => shape.container && shape.kind === 'subProcess' && moved.has(shape.id));
    return onLeaf || subs.some((sub) => stayers.some((other) => other.hostId !== sub.id && newlyOver(sub, other)));
  }

  private crossesFrame({ moved }: SpaceResult, saved: DrawingCheckpoint): boolean {
    const shapes = [...this.plane.shapes.values()];
    const frames = shapes.filter((shape) => (shape.kind === 'group' || shape.container) && !moved.has(shape.id));
    const movers = this.plane.leaves().filter((leaf) => moved.has(leaf.id));
    return movers.some((mover) => frames.some(({ bounds }) => RowCloser.relation(mover.bounds, bounds) !== RowCloser.relation(saved.boundsOf(mover), bounds)));
  }

  private behind(id: string, end: number, frameBox: Box | undefined): boolean {
    const other = this.plane.shapes.get(id);
    if (!other) {
      return false;
    }
    const { y } = other.bounds.center;
    return other.bounds.x >= end - RowCloser.TOLERANCE && (!frameBox || (y >= frameBox.y && y <= frameBox.bottom));
  }

  private tethered({ moved }: SpaceResult, end: number, frameBox: Box | undefined): boolean {
    return [...this.plane.edges.values()].some(({ sourceId, targetId, kind }) => {
      if (!sourceId || !targetId || moved.has(sourceId) === moved.has(targetId)) {
        return false;
      }
      return kind === 'association' || kind === 'dataAssociation' || this.behind(moved.has(sourceId) ? targetId : sourceId, end, frameBox);
    });
  }
}
