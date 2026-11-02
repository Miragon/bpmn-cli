import { describe, expect, it } from 'vitest';
import { RowCosts, type Cand } from '../../../../src/drawing/incremental/placement/RowCosts.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('RowCosts', () => {
  const size = { width: 100, height: 80 };
  const cand = (x: number, centre: number, rest: Partial<Cand> = {}): Cand => ({ x, centre, size, penalty: 0, ...rest });

  it('moves a box beyond the line of an opened row and hands back the same box before it', () => {
    const box = new Box(0, 100, 10, 10);

    expect(RowCosts.shiftedBox(box, { line: 50, delta: 30 }).y).toBe(130);
    expect(RowCosts.shiftedBox(box, { line: 150, delta: 30 })).toBe(box);
    expect(RowCosts.shiftedBox(box, undefined)).toBe(box);
  });

  it('charges a longer way', async () => {
    const scene = await PlacementScene.of('add-branch');
    const costs = new RowCosts(scene.place);
    const from = scene.shape('Gateway_Inner');

    expect(costs.ofCandidate(scene.plane, from, 'task', cand(606, 318))).toBeLessThan(costs.ofCandidate(scene.plane, from, 'task', cand(606, 618)));
  });

  it('adds the penalty of a candidate and the line through the room of its chain', async () => {
    const scene = await PlacementScene.of('add-branch');
    const costs = new RowCosts(scene.place);
    const from = scene.shape('Gateway_Inner');
    const plain = costs.ofCandidate(scene.plane, from, 'task', cand(606, 318));

    expect(costs.ofCandidate(scene.plane, from, 'task', cand(606, 318, { penalty: 33 }))).toBe(plain + 33);
    expect(costs.ofCandidate(scene.plane, from, 'task', cand(506, 178, { extent: 400 }))).toBeGreaterThan(plain);
  });

  it('treats a text annotation line as a tie-break, a crossed flow as a crossing', async () => {
    const scene = await PlacementScene.of('move-lane');
    const costs = new RowCosts(scene.place);
    const from = scene.shape('Activity_Draft');
    const note = [...scene.plane.edges.values()].find((edge) => edge.kind === 'association')!;
    const flow = [...scene.plane.edges.values()].find((edge) => edge.sourceId === 'Activity_Publish')!;
    const across = [new Point(-500, 500), new Point(2500, 500)];
    const far = [new Point(5000, 0), new Point(5100, 0)];
    const target = cand(346, 620);

    note.points = far;
    flow.points = far;
    const clear = costs.ofCandidate(scene.plane, from, 'task', target);
    note.points = across;
    const overNote = costs.ofCandidate(scene.plane, from, 'task', target);
    note.points = far;
    flow.points = across;
    const overFlow = costs.ofCandidate(scene.plane, from, 'task', target);

    expect(overNote - clear).toBeLessThan(100);
    expect(overFlow - clear).toBeGreaterThanOrEqual(300);
  });

  it('prices an opened row with what it shifts, and a route from a boundary event by its side', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const costs = new RowCosts(scene.place);
    const event = scene.shape('B');

    const plain = costs.ofCandidate(scene.plane, event, 'task', cand(392, 300));
    const opened = costs.ofCandidate(scene.plane, event, 'task', cand(392, 300, { insert: { line: 100, delta: 60 } }));

    expect(opened).not.toBe(plain);
  });
});
