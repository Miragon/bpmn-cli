import { TextMetrics } from '@miragon/bpmn-render/text';
import type { Box } from '../../../model/index.js';
import type { Drawing } from '../../incremental/Drawing.js';
import type { SpaceResult } from '../../incremental/space/SpaceTool.js';
import { BoxAxis, type Axis } from '../../plane/BoxAxis.js';
import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import { PlaneStrips, type Strip, type StripOptions } from './PlaneStrips.js';
import { StripClosure } from './StripClosure.js';

export type Attempt = (change: () => SpaceResult | undefined, reroute?: readonly string[]) => boolean;

export interface CompactStats {
  strips: { x: number; y: number };
  px: { x: number; y: number };
  refused: number;
}

export interface CompactOptions {
  only?: ReadonlySet<string> | undefined;
  attempt: Attempt;
}

type StripDemand = Omit<StripOptions, 'loose'>;

export class Compactor {
  private static readonly SUB_TOP = 45;
  private static readonly TITLE_ROOM = 4;
  private static readonly HEADER = 30;
  private static readonly EMPTY_LANE = 120;
  private static readonly MAX_DEPTH = 20;
  private static readonly ALIGNED_POOLS = 2;
  private static readonly MIN_POOL_GAP = 20;
  private static readonly MAX_POOL_GAP = 80;

  private readonly plane: Plane;
  private readonly frames: Frames;
  private readonly strips: PlaneStrips;
  private readonly closure: StripClosure;
  private readonly gaps: { x: number; y: number };
  private readonly stats: CompactStats = { strips: { x: 0, y: 0 }, px: { x: 0, y: 0 }, refused: 0 };

  constructor(
    drawing: Drawing,
    private readonly options: CompactOptions,
  ) {
    this.plane = drawing.plane;
    this.frames = new Frames(this.plane);
    this.strips = new PlaneStrips(this.plane);
    this.closure = new StripClosure(drawing);
    this.gaps = this.strips.gaps();
  }

  private static solidBand(shape: DShape): boolean {
    return shape.kind === 'participant' || (shape.kind === 'subProcess' && shape.container);
  }

  compact(): CompactStats {
    const pools = this.shapes().filter((shape) => shape.kind === 'participant');
    const aligned = pools.length > 1 && pools.every((pool) => Math.abs(pool.bounds.right - pools[0]!.bounds.right) <= Compactor.ALIGNED_POOLS);
    const whole = !this.options.only;
    this.closeSubProcesses();
    this.closePoolColumns(pools);
    if (!pools.length && whole) {
      this.closePlane('x');
    }
    this.closeLaneRows();
    this.closePoolRows(pools);
    if (!pools.length && whole) {
      this.closePlane('y');
    }
    if (pools.length > 1 && whole) {
      this.closeBetweenPools(pools);
    }
    if (aligned) {
      this.alignPools(pools);
    }
    return this.stats;
  }

  private shapes(): DShape[] {
    return [...this.plane.shapes.values()];
  }

  private wanted(frame: DShape): boolean {
    const { only } = this.options;
    if (!only || only.has(frame.id)) {
      return true;
    }
    return [...only].some((id) => {
      const target = this.plane.shapes.get(id);
      return !!target && target !== frame && this.frames.within(frame, target);
    });
  }

  private findStrips(axis: Axis, region: Box, demand: StripDemand): Strip[] {
    return this.strips.emptyStrips(axis, region, { ...demand, loose: this.strips.looseEdges() });
  }

  private close(axis: Axis, strips: readonly Strip[], within: Box | undefined, keep?: ReadonlySet<string>): void {
    for (const strip of [...strips].sort((one, other) => other.from - one.from)) {
      const gain = Math.round(strip.to - strip.from - strip.keep);
      if (this.options.attempt(() => this.closure.close(axis, strip, within, keep))) {
        this.stats.strips[axis]++;
        this.stats.px[axis] += gain;
      } else {
        this.stats.refused++;
      }
    }
  }

  private closeSubProcesses(): void {
    const subProcesses = this.shapes()
      .filter((shape) => shape.kind === 'subProcess' && shape.container && this.wanted(shape))
      .sort((one, other) => this.depth(other) - this.depth(one) || other.bounds.x - one.bounds.x);
    for (const subProcess of subProcesses) {
      this.closeSubProcess(subProcess, 'x');
      this.closeSubProcess(subProcess, 'y');
    }
  }

  private closeSubProcess(frame: DShape, axis: Axis): void {
    const along = BoxAxis.of(axis);
    const outside = this.shapes().filter((shape) => shape !== frame && shape.hostId !== frame.id && !this.frames.within(shape, frame));
    const box = frame.bounds;
    const strips = this.findStrips(axis, box, {
      start: along.near(box),
      end: along.far(box),
      lead: axis === 'x' ? PlaneStrips.PAD : this.topOf(frame),
      trail: PlaneStrips.PAD,
      gap: this.gaps[axis],
      skip: this.chainIds(frame),
    });
    this.close(axis, strips, box, new Set(outside.map((shape) => shape.id)));
  }

  private closePoolColumns(pools: readonly DShape[]): void {
    const { only } = this.options;
    const chosen = pools.filter((pool) => !only || only.has(pool.id)).sort((one, other) => one.bounds.y - other.bounds.y);
    for (const pool of chosen.filter((candidate) => this.hasContent(candidate))) {
      const lanes = this.lanesOf(pool);
      const start = Math.max(pool.bounds.x + Compactor.HEADER, ...lanes.map((lane) => lane.bounds.x + Compactor.HEADER));
      const skip = new Set([pool.id, ...lanes.map((lane) => lane.id)]);
      const strips = this.findStrips('x', pool.bounds, { start, end: pool.bounds.right, lead: PlaneStrips.PAD, trail: PlaneStrips.PAD, gap: this.gaps.x, skip });
      this.close('x', strips, pool.bounds);
    }
  }

  private closeLaneRows(): void {
    const shapes = this.shapes();
    const isLeafLane = (lane: DShape): boolean => lane.kind === 'lane' && !shapes.some((child) => child.kind === 'lane' && child.laneId === lane.id);
    const lanes = shapes.filter((lane) => isLeafLane(lane) && this.wanted(lane)).sort((one, other) => other.bounds.y - one.bounds.y);
    for (const lane of lanes) {
      const { y, bottom } = lane.bounds;
      const strips = this.findStrips('y', lane.bounds, { start: y, end: bottom, lead: PlaneStrips.PAD, trail: PlaneStrips.PAD, gap: this.gaps.y, skip: this.chainIds(lane), empty: Compactor.EMPTY_LANE });
      const pool = lane.poolId ? this.plane.shapes.get(lane.poolId) : undefined;
      this.close('y', strips, pool?.bounds ?? lane.bounds);
    }
  }

  private closePoolRows(pools: readonly DShape[]): void {
    const lanesLess = pools.filter((pool) => this.wanted(pool) && !this.lanesOf(pool).length).sort((one, other) => other.bounds.y - one.bounds.y);
    for (const pool of lanesLess.filter((candidate) => this.hasContent(candidate))) {
      const strips = this.findStrips('y', pool.bounds, { start: pool.bounds.y, end: pool.bounds.bottom, lead: PlaneStrips.PAD, trail: PlaneStrips.PAD, gap: this.gaps.y, skip: new Set([pool.id]) });
      this.close('y', strips, pool.bounds);
    }
  }

  private closePlane(axis: Axis): void {
    const region = this.planeBox(false);
    if (region) {
      this.close(axis, this.findStrips(axis, region, { lead: PlaneStrips.PAD, trail: PlaneStrips.PAD, gap: this.gaps[axis], skip: new Set() }), undefined);
    }
  }

  private closeBetweenPools(pools: readonly DShape[]): void {
    const sorted = [...pools].sort((one, other) => one.bounds.y - other.bounds.y);
    const gaps = sorted
      .slice(1)
      .map((pool, index) => pool.bounds.y - sorted[index]!.bounds.bottom)
      .filter((gap) => gap >= 0);
    const gap = Math.min(Compactor.MAX_POOL_GAP, Math.max(Compactor.MIN_POOL_GAP, gaps.length ? Math.min(...gaps) : Compactor.MAX_POOL_GAP));
    const region = this.planeBox(true);
    if (region) {
      this.close('y', this.findStrips('y', region, { lead: 0, trail: 0, gap, skip: new Set(), solid: Compactor.solidBand }), undefined);
    }
  }

  private alignPools(pools: readonly DShape[]): void {
    const edge = Math.max(...pools.map((pool) => pool.bounds.right));
    for (const pool of pools) {
      const old = pool.bounds.right;
      if (Math.abs(old - edge) <= 0.5) {
        continue;
      }
      pool.bounds.width = edge - pool.bounds.x;
      for (const lane of this.lanesOf(pool)) {
        if (Math.abs(lane.bounds.right - old) <= Compactor.ALIGNED_POOLS) {
          lane.bounds.width = edge - lane.bounds.x;
        }
      }
    }
  }

  private lanesOf(pool: DShape): DShape[] {
    return this.shapes().filter((lane) => lane.kind === 'lane' && lane.poolId === pool.id);
  }

  private hasContent(pool: DShape): boolean {
    return this.shapes().some((shape) => shape.isLeaf && shape.poolId === pool.id);
  }

  private topOf(subProcess: DShape): number {
    return Math.max(Compactor.SUB_TOP, Math.round(TextMetrics.titleDepth(subProcess.el.peek<string>('name'), subProcess.bounds.width) + Compactor.TITLE_ROOM));
  }

  private chainIds(shape: DShape): Set<string> {
    const ids = new Set<string>([shape.id]);
    let current: DShape | undefined = shape;
    for (let depth = 0; current && depth < Compactor.MAX_DEPTH; depth++) {
      const { parentId, laneId, poolId } = current;
      [parentId, laneId, poolId].filter((id): id is string => !!id).forEach((id) => ids.add(id));
      current = this.frameAbove(current);
    }
    return ids;
  }

  private frameAbove({ parentId, laneId }: DShape): DShape | undefined {
    if (parentId) {
      return this.plane.shapes.get(parentId);
    }
    return laneId ? this.plane.shapes.get(laneId) : undefined;
  }

  private depth(shape: DShape): number {
    let depth = 0;
    for (let parentId = shape.parentId; parentId && depth < Compactor.MAX_DEPTH; parentId = this.plane.shapes.get(parentId)?.parentId) {
      depth++;
    }
    return depth;
  }

  private planeBox(withPools: boolean): Box | undefined {
    return this.plane.contentBox((shape) => withPools || shape.kind !== 'participant');
  }
}
