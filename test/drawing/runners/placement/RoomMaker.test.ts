import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../../src/drawing/runners/DrawnDiagram.js';
import { RoomMaker } from '../../../../src/drawing/runners/placement/RoomMaker.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('RoomMaker', () => {
  async function drawn(name: string): Promise<{ diagram: DrawnDiagram; room: RoomMaker }> {
    const diagram = new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
    const plane = diagram.planes[0]!;
    return { diagram, room: new RoomMaker(plane, diagram.drawing(plane)) };
  }

  function refusal(check: () => void): unknown {
    try {
      check();
    } catch (error) {
      return error;
    }
    throw new Error('expected a refusal');
  }

  it('lets a move inside its frame pass', async () => {
    const { diagram, room } = await drawn('lanes');

    expect(() => room.checkFrames([diagram.drawnShape('A').shape], 10, 0, 'there')).not.toThrow();
  });

  it('names the lane at the target and how to assign it', async () => {
    const { diagram, room } = await drawn('lanes');
    const { shape } = diagram.drawnShape('C');

    expect(refusal(() => room.checkFrames([shape], 0, 120, 'below E2'))).toMatchObject({
      code: 'E_LEAVES_CONTAINER',
      message: 'Placing C below E2 would move it out of its lane L1 (into lane L2)',
      details: { related: ['L1', 'L2'], hint: expect.stringContaining('bpmn move <file> C --lane L2') },
    });
  });

  it('says a position below the lane lies in no lane, when another lane follows', async () => {
    const { diagram, room } = await drawn('boundary-lanes');
    const { shape } = diagram.drawnShape('Check');
    const { bounds: pool } = diagram.drawnShape('Pool').shape;

    expect(refusal(() => room.checkFrames([shape], 0, pool.bottom + 50 - shape.bounds.y, 'below Done'))).toMatchObject({ details: { hint: expect.stringContaining('in no lane of its pool') } });
  });

  it('points to a reference inside a lane a shape leaves over its header', async () => {
    const { diagram, room } = await drawn('lanes');
    const { shape } = diagram.drawnShape('S');

    expect(refusal(() => room.checkFrames([shape], -500, 0, 'before S'))).toMatchObject({ details: { hint: expect.stringContaining('Pick a reference inside lane L1') } });
  });

  it('never lets a sub-process grow towards a reference outside it', async () => {
    const { diagram, room } = await drawn('sub-process');
    const { shape } = diagram.drawnShape('ST');
    const { shape: outside } = diagram.drawnShape('A');

    expect(refusal(() => room.checkFrames([shape], 0, 400, 'below A', [outside]))).toMatchObject({ code: 'E_LEAVES_CONTAINER', details: { hint: expect.stringContaining('would have to grow out to it') } });
  });

  it('points to a reference inside a sub-process a shape leaves', async () => {
    const { diagram, room } = await drawn('sub-process');

    expect(refusal(() => room.checkFrames([diagram.drawnShape('ST').shape], -2000, 0, 'far left'))).toMatchObject({ details: { hint: expect.stringContaining('Pick a reference inside Sub') } });
  });

  it('keeps a shape in its pool', async () => {
    const { diagram, room } = await drawn('two-pools');

    expect(refusal(() => room.checkFrames([diagram.drawnShape('Need').shape], -2000, 0, 'far left'))).toMatchObject({ details: { hint: expect.stringContaining('Nodes cannot leave their pool') } });
  });

  it('lets others give way to what was moved', async () => {
    const { diagram, room } = await drawn('branching');
    const notes: string[] = [];
    const before = diagram.snapshot();
    const moved = diagram.drawnShape('E2').shape;
    const fixed = diagram.drawnShape('E').shape;
    moved.bounds.x = fixed.bounds.x;
    moved.bounds.y = fixed.bounds.y - 10;

    room.makeRoom({ moved: [moved], references: [], before, target: 'there', holds: () => true, lock: ['x', 'y'] }, notes);

    expect(moved.bounds.overlaps(fixed.bounds)).toBe(false);
  });

  it('refuses when the request no longer holds, and undoes nothing it did not do', async () => {
    const { diagram, room } = await drawn('branching');
    const before = diagram.snapshot();
    const moved = diagram.drawnShape('E2').shape;
    const reference = diagram.drawnShape('E').shape;

    expect(refusal(() => room.makeRoom({ moved: [moved], references: [reference], before, target: 'there', holds: () => false, lock: ['y'] }, []))).toMatchObject({
      code: 'E_NO_ROOM',
      message: 'There is no room to put E2 there: what is in the way cannot give way without moving the reference or the shapes off it',
      details: { related: ['E'] },
    });
  });
});
