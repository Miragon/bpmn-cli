import type { Box } from '../../../model/index.js';
import type { DShape } from '../../plane/DShape.js';
import type { Decision, SpacePass } from './SpacePass.js';

export class SpaceDecisions {
  private static readonly MAX_DEPTH = 20;

  private readonly decisions = new Map<string, Decision>();

  constructor(private readonly pass: SpacePass) {}

  private static isBand({ kind }: DShape): boolean {
    return kind === 'participant' || kind === 'lane' || kind === 'group';
  }

  private static centred(shape: DShape, box: Box): boolean {
    const { x, y } = shape.bounds.center;
    return x >= box.x && x <= box.right && y >= box.y && y <= box.bottom;
  }

  private static moveOrStay(moves: boolean): Decision {
    return moves ? 'move' : 'stay';
  }

  all(): Map<string, Decision> {
    for (const shape of this.pass.plane.shapes.values()) {
      this.decide(shape);
    }
    return this.decisions;
  }

  private decide(shape: DShape, depth = 0): Decision {
    const known = this.decisions.get(shape.id);
    if (known) {
      return known;
    }
    const verdict = this.verdictOn(shape, depth);
    this.decisions.set(shape.id, verdict);
    return verdict;
  }

  private verdictOn(shape: DShape, depth: number): Decision {
    const { pass } = this;
    const deeper = depth < SpaceDecisions.MAX_DEPTH;
    const host = shape.hostId ? pass.plane.shapes.get(shape.hostId) : undefined;
    const carrier = this.carrierOf(shape);
    const hostDecision = host && deeper ? this.decide(host, depth + 1) : undefined;
    const scoped = host ? undefined : this.scopeDecision(shape);
    const block = pass.held && !host && !carrier ? pass.rigidAround(shape) : undefined;
    if (pass.keep.has(shape.id)) {
      return 'stay';
    }
    const followed = host && hostDecision ? this.verdictWithHost(shape, host, hostDecision) : scoped;
    if (followed) {
      return followed;
    }
    const leader = deeper ? (carrier ?? block) : undefined;
    return leader ? SpaceDecisions.moveOrStay(this.decide(leader, depth + 1) === 'move') : this.verdictAlone(shape);
  }

  private verdictWithHost(shape: DShape, host: DShape, hostDecision: Decision): Decision {
    const { pass } = this;
    if (host.container && hostDecision === 'resize') {
      return SpaceDecisions.moveOrStay(pass.centreBeyondLine(pass.boxOf(shape)));
    }
    return SpaceDecisions.moveOrStay(hostDecision === 'move');
  }

  private verdictAlone(shape: DShape): Decision {
    const { pass } = this;
    const { along, line, band, delta } = pass;
    const box = pass.boxOf(shape);
    if (pass.rigid(shape)) {
      return SpaceDecisions.moveOrStay(pass.centreBeyondLine(box) && pass.pushed(shape));
    }
    if (along.near(box) >= line) {
      return SpaceDecisions.moveOrStay(along.overlapsBand(box, band) && pass.pushed(shape));
    }
    if ((shape.container || (shape.kind === 'group' && pass.pushed(shape))) && along.far(box) > line && along.overlapsBand(box, band)) {
      return delta < 0 && along.beyondBand(box, band) ? 'stay' : 'resize';
    }
    return 'stay';
  }

  private carrierOf(shape: DShape): DShape | undefined {
    const { pass } = this;
    const ids = [shape.kind === 'participant' ? undefined : this.geometricPool(shape), this.geometricLane(shape), shape.parentId];
    return ids.map((id) => (id ? pass.plane.shapes.get(id) : undefined)).find((carrier) => !!carrier && pass.along.near(pass.boxOf(carrier)) >= pass.line);
  }

  private scopeDecision(shape: DShape): Decision | undefined {
    const { pass } = this;
    const { scope, along, line } = pass;
    if (!scope || shape === scope.frame || pass.insideFrame(shape)) {
      return undefined;
    }
    if (!scope.ancestors.has(shape.id) || !scope.grow.has(shape.id)) {
      return 'stay';
    }
    const box = pass.boxOf(shape);
    return along.near(box) < line && along.far(box) > line ? 'resize' : 'stay';
  }

  private geometricPool(shape: DShape): string | undefined {
    if (shape.poolId || SpaceDecisions.isBand(shape) || shape.hostId || shape.parentId) {
      return shape.poolId;
    }
    const { plane, before } = this.pass;
    for (const pool of plane.shapes.values()) {
      if (pool.kind === 'participant' && SpaceDecisions.centred(shape, before.get(pool.id) ?? pool.bounds)) {
        return pool.id;
      }
    }
    return undefined;
  }

  private geometricLane(shape: DShape): string | undefined {
    if (shape.laneId || SpaceDecisions.isBand(shape) || shape.hostId || shape.parentId) {
      return shape.laneId;
    }
    const { plane, before } = this.pass;
    let best: Box | undefined;
    let id: string | undefined;
    for (const lane of plane.shapes.values()) {
      if (lane.kind !== 'lane' || (shape.poolId && lane.poolId !== shape.poolId)) {
        continue;
      }
      const laneBox = before.get(lane.id) ?? lane.bounds;
      if (SpaceDecisions.centred(shape, laneBox) && (!best || laneBox.width * laneBox.height < best.width * best.height)) {
        best = laneBox;
        id = lane.id;
      }
    }
    return id;
  }
}
