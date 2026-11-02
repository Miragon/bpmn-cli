import { describe, expect, it } from 'vitest';
import { PlaneStrips } from '../../../../src/drawing/runners/compaction/PlaneStrips.js';
import { DrawnDiagram } from '../../../../src/drawing/runners/DrawnDiagram.js';
import { Box } from '../../../support/ModelValues.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('PlaneStrips', () => {
  async function drawn(name: string): Promise<{ strips: PlaneStrips; diagram: DrawnDiagram }> {
    const diagram = new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
    return { strips: new PlaneStrips(diagram.planes[0]!), diagram };
  }

  const WIDE = new Box(-2000, -2000, 8000, 8000);

  it('merges what occupies an axis, near to far, without overlaps', async () => {
    const { strips } = await drawn('branching-spaced');

    const occupied = strips.occupied('x', WIDE, { skip: new Set() });

    expect(occupied.every(([start, end], index) => end >= start && (index === 0 || start > occupied[index - 1]![1]))).toBe(true);
    expect(occupied.length).toBeGreaterThan(1);
  });

  it('clips what occupies to the region', async () => {
    const { strips, diagram } = await drawn('chain');
    const task = diagram.drawnShape('A').shape.bounds;
    const region = new Box(task.x + 10, task.y, 20, task.height);

    expect(strips.occupied('x', region, { skip: new Set() })).toEqual([[region.x, region.right]]);
  });

  it('skips the shapes it is told to, and a message flow left loose', async () => {
    const { strips, diagram } = await drawn('message-flow-grown');
    const pool = diagram.drawnShape('Pool').shape.bounds;
    const bands = { skip: new Set(['Pool', 'L1', 'L2']) };

    expect(strips.looseEdges()).toEqual(new Set(['M1']));
    expect(strips.occupied('y', pool, { ...bands, loose: strips.looseEdges() }).length).toBeLessThanOrEqual(strips.occupied('y', pool, bands).length);
  });

  it('occupies only the borders of a group', async () => {
    const { strips } = await drawn('group-frame');

    expect(strips.occupied('x', WIDE, { skip: new Set() })).toEqual([[98, 102], [598, 602]]);
    expect(strips.occupied('y', WIDE, { skip: new Set() })).toEqual([[98, 102], [398, 402]]);
  });

  it('keeps the frame padding at the ends of a region and the gap between its content', async () => {
    const { strips, diagram } = await drawn('branching-spaced');
    const { bounds } = diagram.drawnShape('A').shape;
    const region = new Box(bounds.x - 200, -2000, 2000, 4000);

    const found = strips.emptyStrips('x', region, { start: region.x, end: region.right, lead: 30, trail: 30, gap: 60, skip: new Set() });

    expect(found[0]).toMatchObject({ from: region.x, keep: 30 });
    expect(found.at(-1)).toMatchObject({ to: region.right, keep: 30 });
    expect(found.slice(1, -1).every(({ keep }) => keep === 60)).toBe(true);
  });

  it('leaves an empty region alone unless told what an empty one keeps', async () => {
    const { strips } = await drawn('chain');
    const empty = new Box(1000, 1000, 400, 400);
    const options = { start: 1000, end: 1400, lead: 30, trail: 30, gap: 60, skip: new Set<string>() };

    expect(strips.emptyStrips('y', empty, options)).toEqual([]);
    expect(strips.emptyStrips('y', empty, { ...options, empty: 120 })).toEqual([{ from: 1000, to: 1400, keep: 120 }]);
  });

  it('takes the gaps of a drawing from its spacing, within their limits', async () => {
    const { strips } = await drawn('branching');

    expect(strips.gaps().y).toBeGreaterThanOrEqual(30);
    expect(strips.gaps().y).toBeLessThanOrEqual(60);
  });
});
