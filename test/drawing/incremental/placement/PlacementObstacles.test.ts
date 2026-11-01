import { describe, expect, it } from 'vitest';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('PlacementObstacles', () => {
  it('counts the content of a frame and leaves out the excluded', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const frame = scene.shape('SP');

    const inside = scene.obstacles.of(scene.plane, frame, new Set(['ST']));

    expect(inside.boxes).toHaveLength(2);
  });

  it('counts a group as an obstacle unless asked for plain content', async () => {
    const scene = await PlacementScene.drawn('models/incremental/groups.bpmn');
    const none = new Set<string>();

    expect(scene.obstacles.of(scene.plane, undefined, none).boxes).toContain(scene.shape('G1').bounds);
    expect(scene.obstacles.of(scene.plane, undefined, none, false).boxes).not.toContain(scene.shape('G1').bounds);
  });

  it('names the groups an anchor lies in', async () => {
    const scene = await PlacementScene.drawn('models/incremental/groups.bpmn');

    expect(scene.obstacles.homeGroups(scene.plane, [scene.shape('A'), undefined])).toEqual(['G1']);
  });

  it('asks for room around boxes and less around labels', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const obstacles = { boxes: [new Box(0, 0, 100, 100)], labels: [new Box(300, 0, 50, 14)] };

    expect(scene.obstacles.isFree(new Box(110, 0, 50, 50), obstacles)).toBe(false);
    expect(scene.obstacles.isFree(new Box(130, 0, 50, 50), obstacles)).toBe(true);
    expect(scene.obstacles.isFree(new Box(352, 0, 50, 50), obstacles)).toBe(false);
  });

  it('confines the space tool to the sub-process, else the pool, else the smallest group around the anchor', async () => {
    const sub = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const pool = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const groups = await PlacementScene.drawn('models/incremental/groups.bpmn');

    expect(sub.obstacles.spaceBand(sub.plane, sub.shape('ST'))).toMatchObject({ frame: 'SP' });
    expect(pool.obstacles.spaceBand(pool.plane, pool.shape('A')).within).toMatchObject({ x: 100, width: 700 });
    expect(groups.obstacles.spaceBand(groups.plane, groups.shape('A'), groups.shape('A')).within).toMatchObject({ x: 100 });
    expect(groups.obstacles.spaceBand(groups.plane, groups.shape('A'))).toEqual({});
  });

  it('finds the bottom of a frame without counting what lies elsewhere', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const frame = scene.shape('SP');

    expect(scene.obstacles.contentBottom(scene.plane, frame, new Set())).toBe(scene.shape('ST').bounds.bottom);
    expect(scene.obstacles.contentBottom(scene.plane, frame, new Set(['SS', 'ST', 'SE']))).toBeUndefined();
  });

  it('gives each segment of a line its box', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const segments = [...scene.plane.edges.values()].reduce((count, edge) => count + edge.points.length - 1, 0);

    expect(scene.obstacles.edgeBoxes(scene.plane)).toHaveLength(segments);
  });
});
