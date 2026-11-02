import { BoxBorder, Interval, Point, type Box } from '../../../model/index.js';
import { ChannelRouter } from '../routing/ChannelRouter.js';
import type { GNode, LaneBandInfo } from '../scopes/GNode.js';
import { LinkPath } from './LinkPath.js';
import { LinkRuns, type LinkEnds } from './LinkRuns.js';

export class LinkPaths {
  private static readonly TURN = 20;
  private static readonly SNAP = 12;
  private static readonly ARTIFACT_INSET = 4;
  private static readonly TARGET_INSET = 8;
  private static readonly MIN_TURN_GAP = 8;
  private static readonly SHORT_RUN = 10;

  private readonly from: Point;
  private readonly to: Point;
  private readonly enterX: number;
  private readonly side: number;
  private readonly exitY: number;
  private readonly exitX: number;
  private readonly near: number;

  constructor(
    private readonly ends: LinkEnds,
    node: GNode | undefined,
    private readonly bands: readonly LaneBandInfo[] | undefined,
  ) {
    const { artifactBox, targetBox, end } = ends;
    this.from = artifactBox.center;
    this.to = targetBox.center;
    this.enterX = node ? ChannelRouter.dataX(node) : this.to.x;
    this.side = this.from.x < this.to.x ? artifactBox.right : artifactBox.x;
    this.exitY = this.from.y > this.to.y ? artifactBox.y : artifactBox.bottom;
    this.exitX = end === 'shape' ? this.from.x : new Interval(artifactBox.x + LinkPaths.ARTIFACT_INSET, artifactBox.right - LinkPaths.ARTIFACT_INSET).clamp(this.to.x);
    this.near = this.exitX < this.to.x ? -1 : 1;
  }

  private static add(paths: Point[][], ...points: Point[]): void {
    const path = points.filter(({ x, y }, index) => index === 0 || x !== points[index - 1]!.x || y !== points[index - 1]!.y);
    if (path.length >= 2) {
      paths.push(path);
    }
  }

  private static turnX(enterX: number, turn: number, runY: number, y: number, shapes: readonly Box[], targetBox: Box): number {
    let gap = Math.abs(turn) + LinkPath.HUG;
    for (const box of shapes) {
      if (box !== targetBox && box.y < Math.max(runY, y) && box.bottom > Math.min(runY, y)) {
        const edge = turn < 0 ? enterX - box.right : box.x - enterX;
        if (edge >= 0 && edge < gap) {
          gap = edge;
        }
      }
    }
    return enterX + Math.sign(turn) * (gap >= LinkPaths.MIN_TURN_GAP && gap < Math.abs(turn) + LinkPath.HUG ? Math.round(gap / 2) : Math.abs(turn));
  }

  candidates(joins: readonly number[]): { paths: Point[][]; spare: number } {
    const { artifactBox, targetBox, end } = this.ends;
    const paths = this.direct();
    const runs = new LinkRuns(this.ends, this.bands).of(this.exitX, this.exitY);
    runs.standard.push(...joins);
    const later: Point[][] = [];
    const extra: Point[][] = [];
    const further = LinkPaths.TURN + LinkRuns.STEP;
    for (const runY of runs.standard) {
      const [nearSide, farSide] = this.beside(runY);
      LinkPaths.add(paths, ...this.down(runY));
      if (nearSide) {
        LinkPaths.add(paths, ...nearSide);
      }
      if (farSide) {
        later.push(farSide);
      }
      extra.push(...this.beside(runY, further));
    }
    paths.push([new BoxBorder(artifactBox).pointTowards(this.to), end === 'flow' ? this.to : new BoxBorder(targetBox).pointTowards(this.from)]);
    for (const runY of runs.gaps) {
      later.push(this.down(runY), ...this.beside(runY));
      extra.push(...this.beside(runY, further));
    }
    for (const runY of runs.spare) {
      extra.push(this.down(runY), ...this.beside(runY), ...this.beside(runY, further));
    }
    for (const path of later) {
      LinkPaths.add(paths, ...path);
    }
    const spare = paths.length;
    for (const path of extra) {
      LinkPaths.add(paths, ...path);
    }
    return { paths, spare };
  }

  private direct(): Point[][] {
    const paths: Point[][] = [];
    this.acrossVertically(paths);
    this.acrossLevel(paths);
    this.bentInto(paths);
    return paths;
  }

  private acrossVertically(paths: Point[][]): void {
    const { artifactBox, targetBox } = this.ends;
    const low = Math.max(artifactBox.x + LinkPaths.ARTIFACT_INSET, targetBox.x + LinkPaths.TARGET_INSET);
    const high = Math.min(artifactBox.right - LinkPaths.ARTIFACT_INSET, targetBox.right - LinkPaths.TARGET_INSET);
    if (low > high) {
      return;
    }
    const { enterX } = this;
    const closest = Math.min(Math.max(this.from.x, low), high);
    const crossX = Math.abs(closest - enterX) <= LinkPaths.SNAP && enterX >= low && enterX <= high ? enterX : closest;
    if (artifactBox.y >= targetBox.bottom) {
      LinkPaths.add(paths, new Point(crossX, artifactBox.y), new Point(crossX, targetBox.bottom));
    } else if (artifactBox.bottom <= targetBox.y) {
      LinkPaths.add(paths, new Point(crossX, artifactBox.bottom), new Point(crossX, targetBox.y));
    }
  }

  private acrossLevel(paths: Point[][]): void {
    const { artifactBox, targetBox } = this.ends;
    const low = Math.max(artifactBox.y + LinkPaths.ARTIFACT_INSET, targetBox.y + LinkPaths.TARGET_INSET);
    const high = Math.min(artifactBox.bottom - LinkPaths.ARTIFACT_INSET, targetBox.bottom - LinkPaths.TARGET_INSET);
    if (low > high) {
      return;
    }
    const crossY = Math.min(Math.max(this.from.y, low), high);
    if (artifactBox.x >= targetBox.right) {
      LinkPaths.add(paths, new Point(artifactBox.x, crossY), new Point(targetBox.right, crossY));
    } else if (artifactBox.right <= targetBox.x) {
      LinkPaths.add(paths, new Point(artifactBox.right, crossY), new Point(targetBox.x, crossY));
    }
  }

  private bentInto(paths: Point[][]): void {
    const { artifactBox, targetBox, end } = this.ends;
    const { from, to, enterX, side, exitY } = this;
    if (end === 'shape') {
      const enterY = from.y > to.y ? targetBox.bottom : targetBox.y;
      LinkPaths.add(paths, new Point(side, from.y), new Point(enterX, from.y), new Point(enterX, enterY));
      LinkPaths.add(paths, new Point(from.x, exitY), new Point(from.x, to.y), new Point(from.x < to.x ? targetBox.x : targetBox.right, to.y));
    } else if (to.x >= artifactBox.x && to.x <= artifactBox.right) {
      LinkPaths.add(paths, new Point(to.x, exitY), new Point(to.x, to.y));
    }
  }

  private exitTo(runY: number): Point[] {
    const { artifactBox } = this.ends;
    if (runY > artifactBox.bottom) {
      return [new Point(this.exitX, artifactBox.bottom), new Point(this.exitX, runY)];
    }
    if (runY < artifactBox.y) {
      return [new Point(this.exitX, artifactBox.y), new Point(this.exitX, runY)];
    }
    return [new Point(this.side, runY)];
  }

  private down(runY: number): Point[] {
    const { targetBox } = this.ends;
    if (runY > targetBox.y && runY < targetBox.bottom) {
      return [...this.exitTo(runY), new Point(this.near < 0 ? targetBox.x : targetBox.right, runY)];
    }
    return [...this.exitTo(runY), new Point(this.enterX, runY), new Point(this.enterX, runY > this.to.y ? targetBox.bottom : targetBox.y)];
  }

  private turnedWay(runY: number, direction: number, turn: number): Point[] {
    const { targetBox, end, shapes } = this.ends;
    const { to } = this;
    let enterX = to.x;
    if (end === 'shape') {
      enterX = direction < 0 ? targetBox.x : targetBox.right;
    }
    const turnX = LinkPaths.turnX(enterX, direction * turn, runY, to.y, shapes, targetBox);
    return [...this.exitTo(runY), new Point(turnX, runY), new Point(turnX, to.y), new Point(enterX, to.y)];
  }

  private beside(runY: number, turn = LinkPaths.TURN): Point[][] {
    const { targetBox, end } = this.ends;
    const { near } = this;
    if (end === 'shape') {
      const outside = runY < targetBox.y || runY > targetBox.bottom;
      return outside ? [this.turnedWay(runY, near, turn), this.turnedWay(runY, -near, turn)] : [this.turnedWay(runY, near, turn)];
    }
    const off = Math.abs(runY - this.to.y);
    if (off < LinkPaths.SHORT_RUN) {
      return [];
    }
    return off < LinkPaths.TURN ? [this.turnedWay(runY, near, turn)] : [this.turnedWay(runY, near, turn), this.turnedWay(runY, -near, turn)];
  }
}
