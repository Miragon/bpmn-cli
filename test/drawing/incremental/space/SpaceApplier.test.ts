import { describe, expect, it } from 'vitest';
import { SpaceApplier } from '../../../../src/drawing/incremental/space/SpaceApplier.js';
import { SpaceDecisions } from '../../../../src/drawing/incremental/space/SpaceDecisions.js';
import { SpacePass, type Decision } from '../../../../src/drawing/incremental/space/SpacePass.js';
import type { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box } from '../../../support/ModelValues.js';

describe('SpaceApplier', () => {
  async function planeOf(path: string) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function passOver(plane: Plane, overrides: Partial<ConstructorParameters<typeof SpacePass>[0]> = {}): SpacePass {
    const before = new Map([...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()]));
    return new SpacePass({ plane, axis: 'x', line: 390, delta: 60, band: undefined, keep: new Set<string>(), before, held: undefined, push: undefined, scope: undefined, ...overrides });
  }

  function applied(plane: Plane, overrides: Partial<ConstructorParameters<typeof SpacePass>[0]> = {}) {
    const pass = passOver(plane, overrides);
    return new SpaceApplier(pass).apply(new SpaceDecisions(pass).all());
  }

  it('moves shapes with their labels and reports what it moved', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const label = new Box(420, 60, 30, 14);
    plane.shapes.get('T1')!.label = label;
    const result = applied(plane, { line: 350 });

    expect(plane.shapes.get('T1')!.bounds.x).toBe(420);
    expect(label.x).toBe(480);
    expect(result.moved.has('T1')).toBe(true);
    expect(result.moved.has('G1')).toBe(false);
    expect(plane.shapes.get('T2')!.bounds.x).toBe(420);
  });

  it('resizes what a decision resizes', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const pass = passOver(plane);
    const result = new SpaceApplier(pass).apply(new Map<string, Decision>([['A', 'resize']]));

    expect(plane.shapes.get('A')!.bounds.width).toBe(160);
    expect(result.resized).toEqual(new Set(['A']));
  });

  it('shrinks a frame no further than its content needs', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const result = applied(plane, { line: 630, delta: -200, keep: new Set(['SS', 'ST', 'SE']) });
    const sub = plane.shapes.get('SP')!;

    expect(result.resized.has('SP')).toBe(true);
    expect(sub.bounds.right).toBe(plane.shapes.get('SE')!.bounds.right + 10);
  });

  it('shrinks a frame along the other axis the same way', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    applied(plane, { axis: 'y', line: 290, delta: -100, keep: new Set(['SS', 'ST', 'SE']) });

    expect(plane.shapes.get('SP')!.bounds.bottom).toBe(250);
  });

  it('runs the cap of a push when it grows', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    applied(plane, { line: 700, push: new Set() });

    expect(plane.shapes.get('Pool')!.bounds.right).toBe(800);
  });

  it('keeps pools and lanes of one width flush when one grows', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const result = applied(plane, { line: 1000, band: [60, 580] });

    expect(result.resized.has('Pool_B')).toBe(true);
    expect(plane.shapes.get('Pool_B')!.bounds.right).toBe(plane.shapes.get('Pool_A')!.bounds.right);
    expect(plane.shapes.get('Lane_1')!.bounds.right).toBe(plane.shapes.get('Pool_A')!.bounds.right);
  });

  it('leaves a pool of another width', async () => {
    const plane = await planeOf('models/incremental/collabnote.bpmn');
    const result = applied(plane, { line: 500, band: [60, 320] });

    expect(result.resized.has('PA')).toBe(true);
    expect(result.resized.has('PB')).toBe(false);
  });

  it('holds a narrower target back when the other pool still needs its width', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const pool = plane.shapes.get('Pool_B')!;
    pool.bounds.width = 1302;
    const recv = plane.shapes.get('Task_Recv')!;
    recv.bounds.x = 1300;
    plane.edges.get('Msg_1')!.targetId = 'Pool_B';
    applied(plane, { line: 1000, delta: 1, band: [60, 580] });

    expect(pool.bounds.right).toBe(1402);
  });

  it('lets a grown pool pull a wider neighbour in when that one has room', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const pool = plane.shapes.get('Pool_B')!;
    pool.bounds.width = 1302;
    applied(plane, { line: 1000, delta: 1, band: [60, 580] });

    expect(pool.bounds.right).toBe(plane.shapes.get('Pool_A')!.bounds.right);
  });
});
