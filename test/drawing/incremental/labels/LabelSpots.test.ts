import { describe, expect, it } from 'vitest';
import { LabelSpots } from '../../../../src/drawing/incremental/labels/LabelSpots.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('LabelSpots', () => {
  const size = { width: 40, height: 14 };

  async function shapeOf(id: string) {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    return new PlaneReader(document.tree.definitions).planes()[0]!.shapes.get(id)!;
  }

  it('offers the side itself first, then steps away from the shape', async () => {
    const shape = await shapeOf('E');
    const spots = new LabelSpots(size).aroundSide(shape, 'below', undefined);

    expect(spots[0]).toEqual(shape.labelAt(size, 'below'));
    expect(spots.length).toBe(9);
    expect(spots.at(-1)!.y).toBeGreaterThan(spots[0]!.y);
  });

  it('offers wider shifts for a name wider than its box', async () => {
    const shape = await shapeOf('E');

    expect(new LabelSpots(size).aroundSide(shape, 'above', 'a name wider than forty pixels').length).toBe(15);
  });

  it('slides up and down beside a shape', async () => {
    const shape = await shapeOf('E');
    const spots = new LabelSpots(size).aroundSide(shape, 'right', undefined);

    expect(new Set(spots.slice(0, 3).map(({ x }) => x)).size).toBe(1);
    expect(new Set(spots.slice(0, 3).map(({ y }) => y)).size).toBe(3);
  });

  it('puts the label of a boundary event outside its host on each side', () => {
    const host = new Box(100, 100, 100, 80);
    const spots = new LabelSpots(size);
    const onBoundary = (x: number, y: number): Box[] => spots.onBoundary(new Box(x, y, 36, 36), host, 0);

    expect(onBoundary(130, 162).every(({ y }) => y >= 180)).toBe(true);
    expect(onBoundary(130, 82).every(({ bottom }) => bottom <= 100)).toBe(true);
    expect(onBoundary(182, 120).every(({ x }) => x >= 200)).toBe(true);
    expect(onBoundary(82, 120).every(({ right }) => right <= 100)).toBe(true);
  });

  it('moves further out with each step', () => {
    const host = new Box(100, 100, 100, 80);
    const spots = new LabelSpots(size);

    expect(spots.onBoundary(new Box(130, 162, 36, 36), host, 2)[0]!.y).toBeGreaterThan(spots.onBoundary(new Box(130, 162, 36, 36), host, 0)[0]!.y);
  });

  it('offers spots over and under the runs of a line, then beside its vertical runs', () => {
    const spots = new LabelSpots(size).alongEdge([new Point(0, 100), new Point(200, 100), new Point(200, 300)]);

    expect(spots).toHaveLength(8);
    expect(spots[0]!.bottom).toBeLessThan(100);
    expect(spots[1]!.y).toBeGreaterThan(100);
    expect(spots.at(-1)!.right).toBeLessThan(200);
  });

  it('skips runs too short for the label and falls back on the start of the line', () => {
    const spots = new LabelSpots(size).alongEdge([new Point(0, 100), new Point(10, 100), new Point(10, 105)]);

    expect(spots).toHaveLength(1);
    expect(spots[0]!.bottom).toBeLessThan(100);
  });
});
