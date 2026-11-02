import { describe, expect, it } from 'vitest';
import { CrossingReroutes } from '../../../../src/drawing/incremental/run/CrossingReroutes.js';
import { RepairGuard } from '../../../../src/drawing/incremental/run/RepairGuard.js';
import { Point } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('CrossingReroutes', () => {
  async function crossed(): Promise<{ scene: PlacementScene; routes: CrossingReroutes; fresh: string; kept: string }> {
    const scene = await PlacementScene.of('connect');
    const [first, second] = [...scene.plane.edges.values()];
    scene.run.newEdges.add(first!.id);
    first!.points = [new Point(200, 300), new Point(600, 300)];
    second!.points = [new Point(400, 100), new Point(400, 500)];
    return { scene, routes: new CrossingReroutes(scene.run, new RepairGuard(scene.run)), fresh: first!.id, kept: second!.id };
  }

  it('finds where a new line crosses a kept one, not two kept ones, nor an annotation line', async () => {
    const { routes, fresh, kept } = await crossed();

    const crossings = routes.crossings().map(([first, second]) => [first.id, second.id]);

    expect(crossings).toContainEqual([fresh, kept]);
    expect(crossings.every(([first]) => first === fresh)).toBe(true);
  });

  it('has nothing to do without new lines', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const routes = new CrossingReroutes(scene.run, new RepairGuard(scene.run));

    expect(routes.crossings()).toEqual([]);
  });

  it('routes the new line again and keeps it when that lowers the score', async () => {
    const { scene, routes, fresh } = await crossed();
    const list: string[] = [];

    routes.reroute(list);

    expect(routes.crossings()).toEqual([]);
    expect(list).not.toContain(fresh);
    expect(scene.plane.edges.get(fresh)?.points.length).toBeGreaterThanOrEqual(2);
  });

  it('stops when the guard is exhausted', async () => {
    const { scene, fresh } = await crossed();
    const guard = new RepairGuard(scene.run);
    for (let trial = 0; trial < 8; trial++) {
      guard.begin();
    }
    const before = scene.plane.edges.get(fresh)?.points;

    new CrossingReroutes(scene.run, guard).reroute([]);

    expect(scene.plane.edges.get(fresh)?.points).toBe(before);
  });
});
