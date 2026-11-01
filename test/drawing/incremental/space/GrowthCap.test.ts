import { describe, expect, it } from 'vitest';
import { GrowthCap } from '../../../../src/drawing/incremental/space/GrowthCap.js';
import { SpacePass, type SpaceResult } from '../../../../src/drawing/incremental/space/SpacePass.js';
import type { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('GrowthCap', () => {
  async function planeOf(path: string) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function capped(plane: Plane, grown: readonly string[], delta: number, moved: readonly string[] = []): SpaceResult {
    const before = new Map([...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()]));
    for (const id of grown) {
      plane.shapes.get(id)!.bounds.width += delta;
    }
    for (const id of moved) {
      plane.shapes.get(id)!.translate(delta, 0);
    }
    const result: SpaceResult = { moved: new Set(moved), resized: new Set(grown) };
    new GrowthCap(new SpacePass({ plane, axis: 'x', line: 700, delta, band: undefined, keep: new Set<string>(), before, held: undefined, push: new Set<string>(), scope: undefined }), result).cap();
    return result;
  }

  it('takes back the growth of a pool whose content did not move', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    const result = capped(plane, ['Pool'], 60);

    expect(plane.shapes.get('Pool')!.bounds.right).toBe(800);
    expect(result.resized.has('Pool')).toBe(false);
  });

  it('keeps the growth a moved shape needs', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    const end = plane.shapes.get('E')!;
    end.bounds.x = 750;
    const result = capped(plane, ['Pool'], 60, ['E']);

    expect(plane.shapes.get('Pool')!.bounds.right).toBe(860);
    expect(result.resized.has('Pool')).toBe(true);
  });

  it('holds lanes flush with their pool', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    capped(plane, ['Org', 'L1', 'L2'], 60);

    expect(plane.shapes.get('L1')!.bounds.right).toBe(plane.shapes.get('Org')!.bounds.right);
    expect(plane.shapes.get('L2')!.bounds.right).toBe(plane.shapes.get('Org')!.bounds.right);
  });

  it('caps free lanes by the shapes inside them', async () => {
    const plane = await planeOf('drawing/incremental/free-lanes.bpmn');
    const right = plane.shapes.get('L1')!.bounds.right;
    const result = capped(plane, ['L1', 'L2'], 60);

    expect(plane.shapes.get('L1')!.bounds.right).toBe(right);
    expect(plane.shapes.get('L2')!.bounds.right).toBe(right);
    expect(result.resized.size).toBe(0);
  });

  it('counts a free shape in a lane by its centre', async () => {
    const plane = await planeOf('drawing/incremental/free-lanes.bpmn');
    const end = plane.shapes.get('E')!;
    end.laneId = undefined;
    end.bounds.x = 870;
    end.bounds.y = 100;
    capped(plane, ['L1', 'L2'], 60, ['E']);

    expect(plane.shapes.get('L1')!.bounds.right).toBeGreaterThan(900);
  });

  it('leaves free lanes alone when one of them moved', async () => {
    const plane = await planeOf('drawing/incremental/free-lanes.bpmn');
    const lane = plane.shapes.get('L2')!;
    capped(plane, ['L1'], 60, ['L2']);

    expect(plane.shapes.get('L1')!.bounds.right).toBe(960);
    expect(lane.bounds.x).toBe(190);
  });
});
