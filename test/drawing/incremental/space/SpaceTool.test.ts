import { describe, expect, it } from 'vitest';
import { SpaceTool } from '../../../../src/drawing/incremental/space/SpaceTool.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('SpaceTool', () => {
  async function planeOf(path = 'models/incremental/boundary.bpmn') {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  it('shifts a host with its boundary events', async () => {
    const plane = await planeOf();
    const moved = new SpaceTool(plane).shiftShape('A', 10, 20);

    expect(moved).toEqual(['A', 'B']);
    expect(plane.shapes.get('B')!.bounds.y).toBe(162);
  });

  it('shifts a sub-process with its content and the lines inside only', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const moved = new SpaceTool(plane).shiftShape('SP', 10, 0);

    expect(moved).toEqual(expect.arrayContaining(['SP', 'SS', 'ST', 'SE']));
    expect(plane.edges.get('G1')!.points[0]).toEqual(new Point(318, 200));
    expect(plane.edges.get('F1')!.points[1]).toEqual(new Point(240, 200));
  });

  it('shifts nothing for an unknown shape or no distance', async () => {
    const tool = new SpaceTool(await planeOf());

    expect(tool.shiftShape('nope', 5, 5)).toEqual([]);
    expect(tool.shiftShape('A', 0, 0)).toEqual([]);
  });

  it('makes no room for a delta of zero', async () => {
    const plane = await planeOf();
    const { moved, resized } = new SpaceTool(plane).makeSpace({ axis: 'x', line: 390, delta: 0 });

    expect(moved.size + resized.size).toBe(0);
  });

  it('moves everything beyond the line by the delta', async () => {
    const plane = await planeOf();
    const { moved } = new SpaceTool(plane).makeSpace({ axis: 'x', line: 390, delta: 40 });

    expect(moved).toEqual(new Set(['C', 'D', 'E']));
    expect(plane.edges.get('F2')!.points[1]).toEqual(new Point(440, 120));
  });

  it('holds the sub-process around an anchor and treats others as blocks', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const { resized } = new SpaceTool(plane).makeSpace({ axis: 'x', line: 400, delta: 40, anchors: ['ST', undefined] });

    expect(resized.has('SP')).toBe(true);
  });

  it('follows a boundary event to the frames of its host', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const { resized } = new SpaceTool(plane).makeSpace({ axis: 'x', line: 1000, delta: 40, anchors: ['B_Sub'] });

    expect(resized.has('Sub_1')).toBe(true);
  });

  it('grows only a frame it is told to grow inside', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const { resized } = new SpaceTool(plane).makeSpace({ axis: 'x', line: 700, delta: 40, frame: 'SP', within: plane.shapes.get('SP')!.bounds.copy() });

    expect(resized.has('SP')).toBe(true);
    expect(plane.shapes.get('T2')!.bounds.x).toBe(940);
  });

  it('uses the frame as its band when the line lies beyond the frame', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const { moved } = new SpaceTool(plane).makeSpace({ axis: 'x', line: 900, delta: 40, frame: 'L1' });

    expect(moved.has('T2')).toBe(true);
  });

  it('bounds a shape with its boundary events', async () => {
    const plane = await planeOf();

    expect(new SpaceTool(plane).unitBox(plane.shapes.get('A')!)).toEqual(new Box(240, 80, 100, 98));
  });

  it('keeps room for a boundary event on the border a shape faces', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const tool = new SpaceTool(plane);
    const sub = plane.shapes.get('Sub_1')!;

    expect(tool.borderPad(sub, new Box(1080, 420, 40, 60), 'y')).toBe(28);
    expect(tool.borderPad(sub, new Box(800, 420, 40, 60), 'y')).toBe(0);
    expect(tool.borderPad(sub, new Box(800, 420, 40, 60), 'x')).toBe(0);
  });

  it('counts the right border too', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const sub = plane.shapes.get('Sub_1')!;
    plane.shapes.get('B_Sub')!.bounds = new Box(1122, 460, 36, 36);

    expect(new SpaceTool(plane).borderPad(sub, new Box(1090, 450, 20, 60), 'x')).toBe(28);
  });

  it('grows the frame until a shape fits with its padding', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const task = plane.shapes.get('Y')!;
    task.bounds.x = 840;
    const { resized } = new SpaceTool(plane).fitInFrame('Y');

    expect(resized.has('SP')).toBe(true);
    expect(plane.shapes.get('SP')!.bounds.right).toBeGreaterThanOrEqual(task.bounds.right + 15);
  });

  it('grows downwards the same way and through all frames', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const task = plane.shapes.get('Y')!;
    task.bounds.y = 460;
    new SpaceTool(plane).fitInFrame('Y', 15, undefined, ['X']);

    expect(plane.shapes.get('SP')!.bounds.bottom).toBeGreaterThanOrEqual(task.bounds.bottom + 15);
    expect(plane.shapes.get('L2')!.bounds.bottom).toBeGreaterThanOrEqual(plane.shapes.get('SP')!.bounds.bottom);
  });

  it('leaves a shape alone that fits or has no frame', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const tool = new SpaceTool(plane);

    expect(tool.fitInFrame('X').resized.size).toBe(0);
    expect(tool.fitInFrame('Pool').resized.size).toBe(0);
    expect(tool.fitInFrame('nope').resized.size).toBe(0);
  });

  it('counts the label of a shape, drawn or to be drawn', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const end = plane.shapes.get('BE')!;
    end.bounds.x = 660;
    end.label = new Box(650, 690, 90, 40);
    const { resized } = new SpaceTool(plane).fitInFrame('BE');

    expect(resized.has('ESP2')).toBe(true);
    expect(plane.shapes.get('ESP2')!.bounds.bottom).toBeGreaterThanOrEqual(735);
  });

  it('skips the first frame when the shape left it and asks the next', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const chain = new Map([
      ['Y', 'SP'],
      ['SP', 'L1'],
      ['L1', 'L2'],
    ]);
    plane.shapes.get('Y')!.bounds.x = 900;
    const result = new SpaceTool(plane).fitInFrame('Y', 15, ({ id }) => plane.shapes.get(chain.get(id) ?? ''));

    expect(result.resized.has('SP')).toBe(true);
    expect(result.resized.has('L1')).toBe(false);
  });

  it('grows a lane without a pool padding and a pool towards its own band', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const task = plane.shapes.get('T2')!;
    task.bounds.x = 860;
    new SpaceTool(plane).fitInFrame('T2');

    expect(plane.shapes.get('Org')!.bounds.right).toBeGreaterThanOrEqual(task.bounds.right + 15);
  });

  it('makes room below the title of a sub-process only when the label reaches it', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const tool = new SpaceTool(plane);
    const sub = plane.shapes.get('SP')!;

    expect(tool.roomBelowTitle(sub, new Box(280, 200, 30, 14), 'SS')).toBeUndefined();
    expect(tool.roomBelowTitle(sub, new Box(280, 90, 30, 14), 'SS')?.delta).toBeGreaterThan(0);
  });

  it('closes a strip', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    plane.shapes.get('E')!.bounds.x = 800;
    plane.edges.get('F3')!.points.at(-1)!.x = 800;

    expect(new SpaceTool(plane).closeStrip({ axis: 'x', from: 520, to: 790, gap: 60 })?.moved).toEqual(new Set(['E']));
  });
});
