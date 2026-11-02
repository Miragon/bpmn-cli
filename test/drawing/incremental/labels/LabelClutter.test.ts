import { describe, expect, it } from 'vitest';
import { LabelClutter } from '../../../../src/drawing/incremental/labels/LabelClutter.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box } from '../../../support/ModelValues.js';

describe('LabelClutter', () => {
  async function planeOf(path: string) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  it('finds a spot on a shape, on a line and free ground', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const clutter = new LabelClutter(plane, 'E2', new Set(['E2']));

    expect(clutter.collides(new Box(250, 100, 30, 14))).toBe(true);
    expect(clutter.collides(new Box(360, 113, 30, 14))).toBe(true);
    expect(clutter.collides(new Box(400, 300, 30, 14))).toBe(false);
  });

  it('skips the shapes it should ignore and the label of its owner', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const label = plane.shapes.get('E2')!.label!;

    expect(new LabelClutter(plane, 'E2', new Set(['A'])).collides(new Box(250, 100, 30, 14))).toBe(false);
    expect(new LabelClutter(plane, 'E2', new Set()).collides(label)).toBe(false);
    expect(new LabelClutter(plane, 'other', new Set()).collides(label)).toBe(true);
  });

  it('keeps off the border of a frame and its title', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const clutter = new LabelClutter(plane, 'x', new Set());

    expect(clutter.collides(new Box(300, 95, 30, 14))).toBe(true);
    expect(clutter.collides(new Box(560, 120, 30, 14))).toBe(false);
  });

  it('checks the width of the text beside the label box when a name is given', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const clutter = new LabelClutter(plane, 'E2', new Set());

    expect(clutter.collides(new Box(370, 90, 4, 12))).toBe(false);
    expect(clutter.collides(new Box(370, 90, 4, 12), 'a rather long name of a flow')).toBe(true);
  });

  it('counts a line that crosses a line of the owner apart', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const clutter = new LabelClutter(plane, 'Task_Notify', new Set());

    expect(clutter.collides(new Box(1170, 350, 20, 14))).toBe(true);
  });

  it('ignores the annotation lines of the owner when it looks for crossings', async () => {
    const plane = await planeOf('models/incremental/collabnote.bpmn');

    expect(new LabelClutter(plane, 'Q', new Set()).collides(new Box(770, 410, 8, 8))).toBe(true);
  });
});
