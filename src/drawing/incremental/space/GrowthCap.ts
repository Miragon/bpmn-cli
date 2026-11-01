import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { SpacePass, SpaceResult } from './SpacePass.js';

export class GrowthCap {
  private static readonly ALIGNED = 2;

  private readonly frames: Frames;

  constructor(
    private readonly pass: SpacePass,
    private readonly result: SpaceResult,
  ) {
    this.frames = new Frames(pass.plane);
  }

  cap(): void {
    const { pass, result } = this;
    const { plane } = pass;
    const resized = [...result.resized].map((id) => plane.shapes.get(id)!).filter((shape) => shape.kind === 'participant' || shape.kind === 'lane');
    for (const pool of resized.filter((shape) => shape.kind === 'participant')) {
      this.capFrames([pool], (shape) => shape.kind !== 'group' && this.frames.within(shape, pool));
    }
    this.capFreeLanes();
    for (const lane of resized.filter((shape) => shape.kind === 'lane')) {
      const pool = lane.poolId ? plane.shapes.get(lane.poolId) : undefined;
      if (pool && Math.abs(this.farBefore(lane) - this.farBefore(pool)) <= GrowthCap.ALIGNED) {
        this.setFar(lane, pass.along.far(pool.bounds));
      }
    }
  }

  private farBefore(shape: DShape): number {
    return this.pass.along.far(this.pass.boxOf(shape));
  }

  private setFar(container: DShape, to: number): void {
    const { pass, result } = this;
    if (pass.axis === 'x') {
      container.bounds.width = to - container.bounds.x;
    } else {
      container.bounds.height = to - container.bounds.y;
    }
    if (Math.abs(to - this.farBefore(container)) < 0.5) {
      result.resized.delete(container.id);
    } else {
      result.resized.add(container.id);
    }
  }

  private capFrames(frames: DShape[], holds: (shape: DShape) => boolean): void {
    const { pass, result } = this;
    const { along, delta } = pass;
    let farBefore = Number.NEGATIVE_INFINITY;
    let farNow = Number.NEGATIVE_INFINITY;
    for (const shape of pass.plane.shapes.values()) {
      if (shape.kind !== 'participant' && shape.kind !== 'lane' && holds(shape)) {
        const shift = result.moved.has(shape.id) ? delta : 0;
        const labelFar = shape.label ? along.far(shape.label) : Number.NEGATIVE_INFINITY;
        farBefore = Math.max(farBefore, this.farBefore(shape), labelFar - shift);
        farNow = Math.max(farNow, along.far(shape.bounds), labelFar);
      }
    }
    const old = Math.max(...frames.map((frame) => this.farBefore(frame)));
    if (Number.isFinite(farNow)) {
      for (const frame of frames) {
        this.setFar(frame, old + Math.min(delta, Math.max(0, farNow + Math.max(0, old - farBefore) - old)));
      }
    }
  }

  private inLanes(lanes: readonly DShape[], shape: DShape): boolean {
    const { pass, frames } = this;
    const owner = shape.hostId ? (pass.plane.shapes.get(shape.hostId) ?? shape) : shape;
    if (frames.of(owner)) {
      return lanes.some((lane) => frames.within(owner, lane));
    }
    const box = pass.before.get(owner.id) ?? owner.bounds;
    return lanes.some((lane) => pass.boxOf(lane).contains(box.center));
  }

  private capFreeLanes(): void {
    const { pass, result } = this;
    const free = [...pass.plane.shapes.values()].filter((shape) => shape.kind === 'lane' && !shape.poolId);
    const tops = free.some((lane) => result.moved.has(lane.id)) ? [] : free.filter((lane) => !lane.laneId && result.resized.has(lane.id));
    const done = new Set<DShape>();
    for (const top of tops) {
      if (done.has(top)) {
        continue;
      }
      const end = this.farBefore(top);
      const aligned = free.filter((lane) => Math.abs(this.farBefore(lane) - end) <= GrowthCap.ALIGNED);
      aligned.forEach((lane) => done.add(lane));
      this.capFrames(aligned, (shape) => this.inLanes(aligned, shape));
    }
  }
}
