import { describe, expect, it } from 'vitest';
import { SeparationRun, type SeparateOptions } from '../../../../src/drawing/incremental/frames/SeparationRun.js';
import { SpaceTool } from '../../../../src/drawing/incremental/space/SpaceTool.js';
import type { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box } from '../../../support/ModelValues.js';

describe('SeparationRun', () => {
  async function planeOf(path = 'models/incremental/boundary.bpmn') {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function run(plane: Plane, options: SeparateOptions) {
    return new SeparationRun(plane, new SpaceTool(plane), options).run();
  }

  it('reports nothing for shapes clear of each other', async () => {
    const result = run(await planeOf(), { active: ['C'] });

    expect(result.moved.size + result.resized.size + result.unresolved.length).toBe(0);
  });

  it('pushes the shape further along the reading order to the right or down', async () => {
    const plane = await planeOf();
    const task = plane.shapes.get('C')!;
    task.bounds.x = 330;
    const result = run(plane, { active: ['C'] });

    expect(result.moved.has('C')).toBe(true);
    expect(task.bounds.overlaps(plane.shapes.get('A')!.bounds, 20)).toBe(false);
  });

  it('moves a shape up when it lies above the other and the frame has room', async () => {
    const plane = await planeOf();
    const upper = plane.shapes.get('C')!;
    const lower = plane.shapes.get('D')!;
    upper.bounds = new Box(300, 300, 100, 80);
    lower.bounds = new Box(300, 340, 100, 80);
    const result = run(plane, { active: ['C'], movable: ['C'] });

    expect(result.moved.has('C')).toBe(true);
    expect(upper.bounds.bottom + 20).toBeLessThanOrEqual(lower.bounds.y);
  });

  it('stops a move up at the top of the frame', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    const upper = plane.shapes.get('A')!;
    const lower = plane.shapes.get('C')!;
    upper.bounds = new Box(260, 90, 100, 80);
    lower.bounds = new Box(260, 120, 100, 80);
    run(plane, { active: ['A'], movable: ['A'], grow: false });

    expect(upper.bounds.y).toBeGreaterThanOrEqual(90);
  });

  it('moves a whole host with its boundary events', async () => {
    const plane = await planeOf();
    plane.shapes.get('C')!.bounds.x = 330;
    const result = run(plane, { active: ['B'], movable: ['A', 'C'], gap: 10 });

    expect(result.moved.size).toBeGreaterThan(0);
  });

  it('leaves the pinned and reports the pair it cannot part', async () => {
    const plane = await planeOf();
    const task = plane.shapes.get('C')!;
    task.bounds.x = 330;
    const result = run(plane, { active: ['C'], movable: ['C'], pinned: ['C'] });

    expect(result.unresolved).toHaveLength(1);
    expect(task.bounds.x).toBe(330);
  });

  it('honours an axis that is locked', async () => {
    const plane = await planeOf();
    const task = plane.shapes.get('C')!;
    task.bounds.x = 330;
    const { y } = task.bounds;
    run(plane, { active: ['C'], locked: { ids: ['C'], axes: ['y'] } });
    expect(task.bounds.y).toBe(y);

    const other = await planeOf();
    const held = other.shapes.get('C')!;
    held.bounds.x = 330;
    run(other, { active: ['C'], locked: { ids: ['C'], axes: ['x'] } });
    expect(held.bounds.x).toBe(330);
  });

  it('refuses a push further than the limit', async () => {
    const plane = await planeOf();
    const task = plane.shapes.get('C')!;
    const wide = plane.shapes.get('A')!;
    wide.bounds = new Box(100, -400, 1000, 1000);
    task.bounds.x = 900;
    const result = run(plane, { active: ['C'], movable: ['C'], locked: { ids: ['C'], axes: ['x'] } });

    expect(result.unresolved).toEqual([['C', 'A']]);
    expect(task.bounds.y).toBe(80);
  });

  it('accepts what was already that close in the baseline', async () => {
    const plane = await planeOf();
    const task = plane.shapes.get('C')!;
    task.bounds.x = 350;
    const baseline = new Map([...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()]));
    const result = run(plane, { active: ['C'], baseline });

    expect(result.moved.size).toBe(0);
  });

  it('still parts what came closer than the baseline', async () => {
    const plane = await planeOf();
    const baseline = new Map([...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()]));
    baseline.delete('D');
    const task = plane.shapes.get('C')!;
    task.bounds.x = 330;

    expect(run(plane, { active: ['C'], baseline }).moved.has('C')).toBe(true);
  });

  it('uses the box of a boundary event as the baseline of its host', async () => {
    const plane = await planeOf();
    plane.shapes.get('C')!.bounds.x = 345;
    const baseline = new Map([...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()]));

    expect(run(plane, { active: ['A'], baseline }).moved.size).toBe(0);
  });

  it('never parts a shape from the sub-process around it and grows that frame', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const inner = plane.shapes.get('SE')!;
    inner.bounds.x = 460;
    const result = run(plane, { active: ['SE'] });

    expect(result.moved.has('SE')).toBe(true);
    expect(inner.bounds.overlaps(plane.shapes.get('ST')!.bounds)).toBe(false);
    expect(plane.shapes.get('SP')!.bounds.right).toBeGreaterThanOrEqual(inner.bounds.right);
  });

  it('leaves the frame as it is without growing', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    plane.shapes.get('SE')!.bounds.x = 460;
    run(plane, { active: ['SE'], grow: false });

    expect(plane.shapes.get('SP')!.bounds.width).toBe(400);
  });

  it('ignores an active id that is not drawn', async () => {
    expect(run(await planeOf(), { active: ['nope'] }).moved.size).toBe(0);
  });
});
