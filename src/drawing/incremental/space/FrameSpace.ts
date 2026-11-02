import { Box } from '../../../model/index.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import { SpaceApplier } from './SpaceApplier.js';
import { SpaceDecisions } from './SpaceDecisions.js';
import type { Decision, FrameScope, SpacePass, SpaceResult } from './SpacePass.js';

export class FrameSpace {
  private static readonly FRAME_GAP = 20;
  private static readonly FRAME_PAD = 10;
  private static readonly MAX_ROUNDS = 40;

  constructor(private readonly base: SpacePass) {}

  static applied(pass: SpacePass): SpaceResult {
    return new SpaceApplier(pass).apply(new SpaceDecisions(pass).all());
  }

  inFrame(frame: PlaneShape): SpaceResult {
    const { base } = this;
    let scope: FrameScope | undefined = this.scopeFor(frame);
    for (let round = 0; scope && round < FrameSpace.MAX_ROUNDS; round++) {
      const pass = base.scoped(base.along.bandOf(base.boxOf(scope.frame)), scope);
      const decisions = new SpaceDecisions(pass).all();
      const outgrown = this.outgrown(pass, decisions);
      if (outgrown.length) {
        const { grow } = scope;
        outgrown.forEach((id) => grow.add(id));
        continue;
      }
      const swallowers = this.swallowers(pass, decisions);
      if (!swallowers.length) {
        return new SpaceApplier(pass).apply(decisions);
      }
      scope = this.widen(scope, swallowers);
    }
    return FrameSpace.applied(base.scoped(undefined));
  }

  private outgrown(pass: SpacePass, decisions: ReadonlyMap<string, Decision>): string[] {
    const { along, delta } = pass;
    const scope = pass.scope!;
    const outgrown = new Set<string>();
    for (const shape of pass.plane.shapes.values()) {
      const verdict = decisions.get(shape.id);
      if (verdict !== 'move' && verdict !== 'resize') {
        continue;
      }
      const reach = along.far(pass.boxOf(shape)) + delta + (shape.kind === 'boundary' || shape.kind === 'lane' ? 0 : FrameSpace.FRAME_PAD);
      for (const ancestor of pass.frameChain(shape)) {
        const mayGrow = scope.ancestors.has(ancestor.id) && !scope.grow.has(ancestor.id);
        if (mayGrow && reach > along.far(pass.boxOf(ancestor)) + 0.5) {
          outgrown.add(ancestor.id);
        }
      }
    }
    return [...outgrown];
  }

  private growthRegion({ axis, along, delta }: SpacePass, box: Box): Box {
    const from = along.far(box);
    const length = delta + FrameSpace.FRAME_GAP;
    return axis === 'x' ? new Box(from, box.y, length, box.height) : new Box(box.x, from, box.width, length);
  }

  private swallows(pass: SpacePass, decisions: ReadonlyMap<string, Decision>, resized: PlaneShape): boolean {
    const box = pass.boxOf(resized);
    const region = this.growthRegion(pass, box);
    const around = new Set(pass.frameChain(resized).map((frame) => frame.id));
    return [...pass.plane.shapes.values()].some((shape) => {
      if (shape === resized || shape.kind === 'group' || pass.keep.has(shape.id) || decisions.get(shape.id) !== 'stay' || around.has(shape.id) || shape.hostId === resized.id || pass.frameChain(shape).includes(resized)) {
        return false;
      }
      const shapeBox = pass.boxOf(shape);
      return shapeBox.overlaps(region) && !shapeBox.overlaps(box);
    });
  }

  private swallowers(pass: SpacePass, decisions: ReadonlyMap<string, Decision>): PlaneShape[] {
    const scope = pass.scope!;
    const growing = [...pass.plane.shapes.values()].filter((shape) => decisions.get(shape.id) === 'resize' && (shape === scope.frame || scope.grow.has(shape.id)));
    return growing.filter((resized) => this.swallows(pass, decisions, resized));
  }

  private frameUp(shape: PlaneShape): PlaneShape | undefined {
    const { shapes } = this.base.plane;
    if (shape.kind === 'participant') {
      return undefined;
    }
    const parent = shape.kind === 'subProcess' && shape.parentId ? shapes.get(shape.parentId) : undefined;
    return parent ?? (shape.poolId ? shapes.get(shape.poolId) : undefined);
  }

  private widen(scope: FrameScope, grown: readonly PlaneShape[]): FrameScope | undefined {
    const targets = grown.map((shape) => this.frameUp(shape));
    if (targets.some((target) => !target)) {
      return undefined;
    }
    const next = (targets as PlaneShape[]).sort((first, second) => this.base.frameChain(first).length - this.base.frameChain(second).length)[0]!;
    return this.scopeFor(next, scope.grow);
  }

  private scopeFor(frame: PlaneShape, grow: ReadonlySet<string> = new Set()): FrameScope {
    const ancestors = new Set(this.base.frameChain(frame).map((shape) => shape.id));
    return { frame, ancestors, grow: new Set([...grow].filter((id) => ancestors.has(id))) };
  }
}
