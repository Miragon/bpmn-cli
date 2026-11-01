import { describe, expect, it } from 'vitest';
import { Compactor, type CompactStats } from '../../../../src/drawing/runners/compaction/Compactor.js';
import { DrawnDiagram } from '../../../../src/drawing/runners/DrawnDiagram.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('Compactor', () => {
  async function compact(name: string, only?: string[], keep = true): Promise<{ stats: CompactStats; diagram: DrawnDiagram }> {
    const diagram = new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
    const guard = diagram.guard(diagram.planes[0]!);
    const attempt: typeof guard.attempt = (change, force) => keep && guard.attempt(change, force);
    const stats = new Compactor(diagram.drawing(diagram.planes[0]!), { only: only && new Set(only), attempt }).compact();
    return { stats, diagram };
  }

  const boxOf = (diagram: DrawnDiagram, id: string) => diagram.drawnShape(id).shape.bounds;

  it('closes the empty column of a process without pools and keeps the order', async () => {
    const { stats, diagram } = await compact('branching-spaced');

    expect(stats.strips).toEqual({ x: 1, y: 0 });
    expect(boxOf(diagram, 'A').right).toBeLessThan(boxOf(diagram, 'G').x);
  });

  it('shrinks a pool with its lanes to the content, inside out', async () => {
    const { stats, diagram } = await compact('lanes-grown');

    expect(stats.strips.y).toBeGreaterThan(0);
    expect(boxOf(diagram, 'Pool').bottom).toBe(boxOf(diagram, 'L2').bottom);
  });

  it('keeps pools that ended on one line aligned', async () => {
    const { diagram } = await compact('sides-aligned');

    expect(boxOf(diagram, 'First').right).toBe(boxOf(diagram, 'Second').right);
    expect(boxOf(diagram, 'FirstLane').right).toBe(boxOf(diagram, 'First').right);
  });

  it('closes only inside the frames it is given', async () => {
    const whole = await compact('sub-process-spaced');
    const inner = await compact('sub-process-spaced', ['Sub']);

    expect(inner.stats.strips.x).toBeLessThan(whole.stats.strips.x);
    expect(boxOf(inner.diagram, 'E').x).toBeGreaterThan(boxOf(whole.diagram, 'E').x);
  });

  it('counts a strip the attempt refuses as refused', async () => {
    const { stats, diagram } = await compact('branching-spaced', undefined, false);

    expect(stats).toMatchObject({ strips: { x: 0, y: 0 }, refused: expect.any(Number) });
    expect(stats.refused).toBeGreaterThan(0);
    expect(boxOf(diagram, 'G').x - boxOf(diagram, 'A').right).toBeGreaterThan(300);
  });

  it('closes the gap between stacked pools down to the smallest there', async () => {
    const { stats, diagram } = await compact('pools-stacked-far');

    expect(stats.strips.y).toBeGreaterThan(0);
    expect(boxOf(diagram, 'Lower').y - boxOf(diagram, 'Upper').bottom).toBeLessThanOrEqual(80);
  });
});
