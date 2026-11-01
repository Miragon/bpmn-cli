import { describe, expect, it } from 'vitest';
import { SpacePass } from '../../../../src/drawing/incremental/space/SpacePass.js';
import type { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('SpacePass', () => {
  async function planeOf(path: string) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function passOver(plane: Plane, overrides: Partial<ConstructorParameters<typeof SpacePass>[0]> = {}): SpacePass {
    const before = new Map([...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()]));
    return new SpacePass({ plane, axis: 'x', line: 500, delta: 60, band: undefined, keep: new Set<string>(), before, held: undefined, push: undefined, scope: undefined, ...overrides });
  }

  it('narrows to a band and a scope and keeps the rest', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const pass = passOver(plane);
    const frame = plane.shapes.get('SP')!;
    const scoped = pass.scoped([100, 300], { frame, ancestors: new Set(), grow: new Set() });

    expect(scoped.band).toEqual([100, 300]);
    expect(scoped.scope?.frame).toBe(frame);
    expect(scoped.line).toBe(500);
  });

  it('says where the centre of a box lies against the line, per axis', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const task = plane.shapes.get('T')!.bounds;

    expect(passOver(plane).centreBeyondLine(task)).toBe(true);
    expect(passOver(plane, { axis: 'y', line: 500 }).centreBeyondLine(task)).toBe(false);
  });

  it('pushes everything without a list, and bands always', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const listed = passOver(plane, { push: new Set(['T1']) });

    expect(passOver(plane).pushed(plane.shapes.get('T2')!)).toBe(true);
    expect(listed.pushed(plane.shapes.get('T1')!)).toBe(true);
    expect(listed.pushed(plane.shapes.get('T2')!)).toBe(false);
    expect(listed.pushed(plane.shapes.get('L1')!)).toBe(true);
    expect(listed.pushed(plane.shapes.get('Pool')!)).toBe(true);
  });

  it('treats a sub-process across the line as rigid unless the anchor lies in it', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const sub = plane.shapes.get('SP')!;

    expect(passOver(plane).rigid(sub)).toBe(false);
    expect(passOver(plane, { held: new Set() }).rigid(sub)).toBe(true);
    expect(passOver(plane, { held: new Set(['SP']) }).rigid(sub)).toBe(false);
    expect(passOver(plane, { held: new Set(), keep: new Set(['SP']) }).rigid(sub)).toBe(false);
    expect(passOver(plane, { held: new Set(), line: 900 }).rigid(sub)).toBe(false);
    expect(passOver(plane, { held: new Set() }).rigid(plane.shapes.get('T')!)).toBe(false);
  });

  it('finds the outermost rigid block around a shape', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const pass = passOver(plane, { held: new Set() });

    expect(pass.rigidAround(plane.shapes.get('ST')!)?.id).toBe('SP');
    expect(pass.rigidAround(plane.shapes.get('T')!)).toBeUndefined();
  });

  it('chains the frames around a shape, with the host of a boundary event first', async () => {
    const lanes = await planeOf('models/incremental/orders-boundaries.bpmn');
    const pass = passOver(lanes);

    expect(pass.frameChain(lanes.shapes.get('Timer_1')!).map(({ id }) => id)).toEqual(['Task_A', 'Lane_1', 'Pool_A']);
    expect(pass.frameChain(lanes.shapes.get('Pool_A')!)).toEqual([]);
  });

  it('counts a shape as inside by its frame or by its centre, never a frame beside it', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const frame = plane.shapes.get('SP')!;
    const pass = passOver(plane, { scope: { frame, ancestors: new Set(['L2']), grow: new Set() } });
    const loose = plane.shapes.get('T1')!;

    expect(pass.insideFrame(plane.shapes.get('X')!)).toBe(true);
    expect(pass.insideFrame(loose)).toBe(false);
    expect(pass.insideFrame(plane.shapes.get('L2')!)).toBe(false);
    new Map(pass.before).get('T1')!.translate(300, 250);
    expect(pass.insideFrame(loose)).toBe(true);
  });
});
