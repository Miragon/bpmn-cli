import { describe, expect, it } from 'vitest';
import { SpaceTool } from '../../../../src/drawing/incremental/space/SpaceTool.js';
import { StripCloser, type StripRequest } from '../../../../src/drawing/incremental/space/StripCloser.js';
import type { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box } from '../../../support/ModelValues.js';

describe('StripCloser', () => {
  async function planeOf(path = 'models/incremental/boundary.bpmn') {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function close(plane: Plane, request: Partial<StripRequest> = {}) {
    const tool = new SpaceTool(plane);
    return new StripCloser(plane, (space) => tool.makeSpace(space)).close({ axis: 'x', from: 500, to: 700, gap: 60, ...request });
  }

  it('pulls what lies beyond an empty strip back to the gap', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    plane.shapes.get('E')!.bounds.x = 800;
    plane.edges.get('F3')!.points.at(-1)!.x = 800;
    const result = close(plane, { from: 520, to: 790, gap: 60 });

    expect(result?.moved).toEqual(new Set(['E']));
    expect(plane.shapes.get('E')!.bounds.x).toBe(590);
  });

  it('opens nothing on a strip no wider than the gap', async () => {
    expect(close(await planeOf(), { from: 500, to: 550, gap: 60 })).toBeUndefined();
  });

  it('stays open around a shape or a label in the strip', async () => {
    const plane = await planeOf();
    const shape = close(plane, { from: 340, to: 720, gap: 30 });
    plane.shapes.get('E2')!.label = new Box(600, 200, 30, 14);

    expect(shape).toBeUndefined();
    expect(close(plane, { from: 505, to: 720, gap: 10, within: new Box(0, 180, 1000, 60) })).toBeUndefined();
  });

  it('closes past a shape outside the band', async () => {
    const plane = await planeOf();
    plane.shapes.get('E2')!.label = undefined;

    expect(close(plane, { from: 345, to: 395, gap: 10, within: new Box(0, 80, 1000, 80) })).toBeDefined();
  });

  it('stays open around the border of a frame and a bend in the strip', async () => {
    const framed = await planeOf('models/incremental/sub.bpmn');
    const bent = await planeOf('models/incremental/polish-lanes.bpmn');
    bent.edges.get('f5')!.points[1]!.x = 490;

    expect(close(framed, { from: 600, to: 680, gap: 10 })).toBeUndefined();
    expect(close(bent, { from: 475, to: 515, gap: 5 })).toBeUndefined();
    expect(close(bent, { from: 475, to: 515, gap: 5, ignore: new Set(['f5']) })).toBeDefined();
  });

  it('closes over a bend of an ignored flow and stays open around a label of another', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    plane.edges.get('f6')!.label = undefined;

    expect(close(plane, { from: 575, to: 625, gap: 5, ignore: new Set(['f6']) })).toBeDefined();

    const labelled = await planeOf('models/incremental/polish-lanes.bpmn');
    labelled.edges.get('f6')!.label = new Box(590, 150, 20, 14);
    expect(close(labelled, { from: 575, to: 625, gap: 5 })).toBeUndefined();
  });

  it('takes everything back when closing would put a shape on another', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const task = plane.shapes.get('T2')!;
    const end = plane.shapes.get('E')!;
    task.bounds.x = 650;
    end.bounds.x = 760;
    end.bounds.y = 320;
    const result = close(plane, { from: 475, to: 640, gap: 30, within: new Box(0, 260, 900, 100), keep: new Set(['T2']), ignore: new Set(['f5']) });

    expect(result).toBeUndefined();
    expect(end.bounds.x).toBe(760);
  });

  it('closes along the other axis', async () => {
    const plane = await planeOf();
    plane.shapes.get('B')!.label = undefined;
    const result = close(plane, { axis: 'y', from: 170, to: 225, gap: 20, within: new Box(280, 0, 60, 500), ignore: new Set(['F5']) });

    expect(result?.moved.has('E2')).toBe(true);
  });
});
