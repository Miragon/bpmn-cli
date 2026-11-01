import type { Box } from '../../../model/index.js';
import { BoxAxis, type Axis, type Band } from '../../plane/BoxAxis.js';
import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';

export interface SpaceRequest {
  axis: Axis;
  line: number;
  delta: number;
  within?: Box;
  frame?: string;
  keep?: ReadonlySet<string>;
  anchors?: ReadonlyArray<string | undefined>;
  push?: ReadonlySet<string>;
}

export interface SpaceResult {
  moved: Set<string>;
  resized: Set<string>;
}

export type Decision = 'move' | 'resize' | 'stay';

export interface FrameScope {
  frame: DShape;
  ancestors: Set<string>;
  grow: Set<string>;
}

interface PassParts {
  plane: Plane;
  axis: Axis;
  line: number;
  delta: number;
  band: Band | undefined;
  keep: ReadonlySet<string>;
  before: ReadonlyMap<string, Box>;
  held: Set<string> | undefined;
  push: ReadonlySet<string> | undefined;
  scope: FrameScope | undefined;
}

export class SpacePass implements PassParts {
  private static readonly MAX_DEPTH = 20;
  private static readonly MAX_CHAIN = 16;

  readonly plane: Plane;
  readonly axis: Axis;
  readonly line: number;
  readonly delta: number;
  readonly band: Band | undefined;
  readonly keep: ReadonlySet<string>;
  readonly before: ReadonlyMap<string, Box>;
  readonly held: Set<string> | undefined;
  readonly push: ReadonlySet<string> | undefined;
  readonly scope: FrameScope | undefined;
  readonly along: BoxAxis;

  constructor(parts: PassParts) {
    this.plane = parts.plane;
    this.axis = parts.axis;
    this.line = parts.line;
    this.delta = parts.delta;
    this.band = parts.band;
    this.keep = parts.keep;
    this.before = parts.before;
    this.held = parts.held;
    this.push = parts.push;
    this.scope = parts.scope;
    this.along = BoxAxis.of(parts.axis);
  }

  scoped(band: Band | undefined, scope?: FrameScope): SpacePass {
    return new SpacePass({ ...this, band, scope });
  }

  boxOf({ id }: Pick<DShape, 'id'>): Box {
    return this.before.get(id)!;
  }

  centreBeyondLine(box: Box): boolean {
    const { center } = box;
    return (this.axis === 'x' ? center.x : center.y) >= this.line;
  }

  pushed(shape: DShape): boolean {
    return !this.push || shape.kind === 'participant' || shape.kind === 'lane' || this.push.has(shape.id);
  }

  rigid(candidate: DShape): boolean {
    if (!this.held || candidate.kind !== 'subProcess' || !candidate.container || this.held.has(candidate.id) || this.keep.has(candidate.id)) {
      return false;
    }
    const box = this.boxOf(candidate);
    return this.along.near(box) < this.line && this.along.far(box) > this.line && this.along.overlapsBand(box, this.band);
  }

  rigidAround(shape: DShape): DShape | undefined {
    let outermost: DShape | undefined;
    let current = shape.parentId ? this.plane.shapes.get(shape.parentId) : undefined;
    for (let depth = 0; current && depth < SpacePass.MAX_DEPTH; depth++) {
      if (this.rigid(current)) {
        outermost = current;
      }
      current = current.parentId ? this.plane.shapes.get(current.parentId) : undefined;
    }
    return outermost;
  }

  frameChain(shape: DShape): DShape[] {
    const chain: DShape[] = [];
    let current = shape.hostId ? (this.plane.shapes.get(shape.hostId) ?? shape) : shape;
    if (current !== shape) {
      chain.push(current);
    }
    const frames = new Frames(this.plane);
    for (let depth = 0; depth < SpacePass.MAX_CHAIN; depth++) {
      const frame = frames.of(current);
      if (!frame || chain.includes(frame)) {
        break;
      }
      chain.push(frame);
      current = frame;
    }
    return chain;
  }

  insideFrame(shape: DShape): boolean {
    const scope = this.scope!;
    if (this.frameChain(shape).includes(scope.frame)) {
      return true;
    }
    if (shape.container || shape.kind === 'group' || scope.ancestors.has(shape.id)) {
      return false;
    }
    const { center } = this.boxOf(shape);
    const frameBox = this.boxOf(scope.frame);
    return center.x > frameBox.x && center.x < frameBox.right && center.y > frameBox.y && center.y < frameBox.bottom;
  }
}
