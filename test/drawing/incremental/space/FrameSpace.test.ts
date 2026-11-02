import { describe, expect, it } from 'vitest';
import { FrameSpace } from '../../../../src/drawing/incremental/space/FrameSpace.js';
import { SpacePass } from '../../../../src/drawing/incremental/space/SpacePass.js';
import type { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('FrameSpace', () => {
  async function planeOf(path: string) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function passOver(plane: Plane, line: number, delta: number, axis: 'x' | 'y' = 'x'): SpacePass {
    const before = new Map([...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()]));
    return new SpacePass({ plane, axis, line, delta, band: undefined, keep: new Set<string>(), before, held: undefined, push: undefined, scope: undefined });
  }

  it('applies a pass over the whole plane', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');

    expect(FrameSpace.applied(passOver(plane, 390, 60)).moved.has('C')).toBe(true);
    expect(plane.shapes.get('C')!.bounds.x).toBe(460);
  });

  it('grows a sub-process and moves only what lies inside it', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const result = new FrameSpace(passOver(plane, 500, 40)).inFrame(plane.shapes.get('SP')!);

    expect(result.resized.has('SP')).toBe(true);
    expect(result.moved.has('X')).toBe(true);
    expect(plane.shapes.get('T2')!.bounds.x).toBe(940);
    expect(plane.shapes.get('SP')!.bounds.width).toBe(520);
  });

  it('grows the lane around a frame that outgrows it', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const sub = plane.shapes.get('SP')!;
    const result = new FrameSpace(passOver(plane, 400, 60, 'y')).inFrame(sub);

    expect(sub.bounds.height).toBe(280);
    expect(result.resized.has('L2')).toBe(true);
    expect(plane.shapes.get('L2')!.bounds.bottom).toBeGreaterThanOrEqual(sub.bounds.bottom);
  });

  it('makes room one level out when the frame would grow over a shape', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const sub = plane.shapes.get('ESP')!;
    plane.shapes.get('ESP2')!.bounds.y = 560;
    new FrameSpace(passOver(plane, 500, 60, 'y')).inFrame(sub);

    expect(sub.bounds.height).toBe(230);
    expect(plane.shapes.get('ESP2')!.bounds.y).toBeGreaterThanOrEqual(sub.bounds.bottom);
  });

  it('falls back on the whole plane when no frame up is left', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const sub = plane.shapes.get('SP')!;
    const task = plane.shapes.get('T')!;
    task.bounds.x = 650;
    task.bounds.y = 120;
    const result = new FrameSpace(passOver(plane, 600, 40)).inFrame(sub);

    expect(sub.bounds.width).toBe(440);
    expect(result.moved.has('T')).toBe(true);
  });

  it('ignores a group, a boundary event of the frame and its own content on the way', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const sub = plane.shapes.get('Sub_1')!;
    const result = new FrameSpace(passOver(plane, 1000, 30)).inFrame(sub);

    expect(result.moved.has('S_End')).toBe(true);
    expect(sub.bounds.width).toBe(410);
  });
});
