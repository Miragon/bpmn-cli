import type { Box } from '../../../model/index.js';
import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import { EdgeFollow } from './EdgeFollow.js';
import { GrowthCap } from './GrowthCap.js';
import type { Decision, SpacePass, SpaceResult } from './SpacePass.js';

export class SpaceApplier {
  private static readonly ALIGNED = 2;
  private static readonly SHRINK_PAD = 10;
  private static readonly POOL_PAD = 15;

  private readonly result: SpaceResult = { moved: new Set(), resized: new Set() };

  constructor(private readonly pass: SpacePass) {}

  apply(decisions: ReadonlyMap<string, Decision>): SpaceResult {
    const { pass, result } = this;
    const { axis, delta } = pass;
    this.applyDecisions(decisions);
    if (delta < 0) {
      this.capShrinks();
    }
    if (pass.push && delta > 0) {
      new GrowthCap(pass, result).cap();
    }
    if (axis === 'x') {
      this.alignPoolsAndLanes();
    }
    new EdgeFollow(pass, result).follow();
    return result;
  }

  private applyDecisions(decisions: ReadonlyMap<string, Decision>): void {
    const { pass, result } = this;
    const { along, delta } = pass;
    for (const shape of pass.plane.shapes.values()) {
      const verdict = decisions.get(shape.id);
      if (verdict === 'move') {
        along.shift(shape.bounds, delta);
        if (shape.label) {
          along.shift(shape.label, delta);
        }
        result.moved.add(shape.id);
      } else if (verdict === 'resize') {
        along.resize(shape.bounds, delta);
        result.resized.add(shape.id);
      }
    }
  }

  private capShrinks(): void {
    const { plane } = this.pass;
    for (const id of this.result.resized) {
      const container = plane.shapes.get(id)!;
      if (container.container) {
        this.capShrink(container, this.pass.boxOf(container));
      }
    }
  }

  private capShrink(container: DShape, before: Box): void {
    const { pass } = this;
    const { along, axis, plane } = pass;
    const frames = new Frames(plane);
    let need = Number.NEGATIVE_INFINITY;
    for (const shape of plane.shapes.values()) {
      if (shape !== container && shape.kind !== 'participant' && shape.kind !== 'lane' && shape.kind !== 'group' && frames.within(shape, container)) {
        need = Math.max(need, along.far(shape.bounds) + (shape.kind === 'boundary' ? 0 : SpaceApplier.SHRINK_PAD));
      }
    }
    const limit = Math.min(need, along.far(before));
    if (along.far(container.bounds) >= limit) {
      return;
    }
    if (axis === 'x') {
      container.bounds.width = limit - container.bounds.x;
    } else {
      container.bounds.height = limit - container.bounds.y;
    }
  }

  private alignPoolsAndLanes(): void {
    const { plane } = this.pass;
    const pools = [...plane.shapes.values()].filter((shape) => shape.kind === 'participant');
    const grown = pools.filter((pool) => this.result.resized.has(pool.id));
    if (!grown.length) {
      return;
    }
    for (const grownPool of grown) {
      for (const pool of pools) {
        if (pool !== grownPool) {
          this.alignPool(pool, grownPool);
        }
      }
    }
    this.alignLanes();
  }

  private alignPool(pool: DShape, grownPool: DShape): void {
    const { pass, result } = this;
    const target = grownPool.bounds.right;
    const untouched = !result.resized.has(pool.id) && !result.moved.has(pool.id);
    const wasAligned = untouched && Math.abs(pass.boxOf(pool).right - pass.boxOf(grownPool).right) <= SpaceApplier.ALIGNED;
    if (wasAligned && (target >= pool.bounds.right || this.reachOf(pool) <= target)) {
      pool.bounds.width = target - pool.bounds.x;
      result.resized.add(pool.id);
    }
  }

  private reachOf(pool: DShape): number {
    const { shapes, edges } = this.pass.plane;
    const content = [...shapes.values()].filter((shape) => shape.poolId === pool.id && shape.kind !== 'lane').map((shape) => shape.bounds.right + SpaceApplier.POOL_PAD);
    const docks = [...edges.values()].flatMap((edge) => [edge.sourceId === pool.id ? edge.points[0] : undefined, edge.targetId === pool.id ? edge.points.at(-1) : undefined]).flatMap((dock) => (dock ? [dock.x + SpaceApplier.POOL_PAD] : []));
    return Math.max(Number.NEGATIVE_INFINITY, ...content, ...docks);
  }

  private alignLanes(): void {
    const { pass, result } = this;
    for (const lane of pass.plane.shapes.values()) {
      const pool = lane.kind === 'lane' && lane.poolId ? pass.plane.shapes.get(lane.poolId) : undefined;
      if (!pool || !result.resized.has(pool.id)) {
        continue;
      }
      if (Math.abs(pass.boxOf(lane).right - pass.boxOf(pool).right) <= SpaceApplier.ALIGNED && Math.abs(lane.bounds.right - pool.bounds.right) > 0.5) {
        lane.bounds.width = pool.bounds.right - lane.bounds.x;
        result.resized.add(lane.id);
      }
    }
  }
}
