import { describe, expect, it } from 'vitest';
import { BoundarySpots } from '../../../../src/drawing/incremental/placement/BoundarySpots.js';
import { ShapeSides } from '../../../../src/drawing/plane/ShapeSides.js';
import { ShapeSizes } from '../../../../src/drawing/plane/ShapeSizes.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('BoundarySpots', () => {
  it('searches the bottom border right to left, keeping clear of events already there', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const host = scene.shape('A');

    const spot = new BoundarySpots(scene.plane).spotOnBorder(host, ShapeSizes.EVENT);

    expect(ShapeSides.attached(spot, host.bounds)).toBe('bottom');
    expect(spot.right).toBeLessThanOrEqual(scene.shape('B').bounds.x);
  });

  it('goes to the top border when the bottom is full, and overlaps when none is left', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const host = scene.shape('A');
    const { x, y, bottom, width } = host.bounds;
    const spots = new BoundarySpots(scene.plane);
    scene.shape('B').bounds = new Box(x - 20, bottom - 18, width + 40, 36);

    const top = spots.spotOnBorder(host, ShapeSizes.EVENT);
    scene.shape('E2').hostId = 'A';
    scene.shape('E2').bounds = new Box(x - 20, y - 18, width + 40, 36);
    const last = spots.spotOnBorder(host, ShapeSizes.EVENT);

    expect(ShapeSides.attached(top, host.bounds)).toBe('top');
    expect(ShapeSides.attached(last, host.bounds)).toBe('bottom');
  });

  it('leaves out the event it searches for', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const event = scene.shape('B');

    const spot = new BoundarySpots(scene.plane).spotOnBorder(scene.shape('A'), ShapeSizes.EVENT, 'B');

    expect(spot.overlaps(event.bounds)).toBe(true);
  });

  it('keeps the exit below an event clear of labels when it can', async () => {
    const scene = await PlacementScene.of('add-after');
    const host = scene.shape('Activity_Report');
    const free = new BoundarySpots(scene.plane).spotOnBorder(host, ShapeSizes.EVENT);
    scene.shape('Activity_Analyse').label = new Box(free.center.x - 10, host.bounds.bottom + 20, 20, 14);

    const beside = new BoundarySpots(scene.plane).spotOnBorder(host, ShapeSizes.EVENT);

    expect(beside.x).not.toBe(free.x);
  });

  it('finds the spot on the top border nearest the event, off lines and docks', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const host = scene.shape('A');
    const event = scene.shape('B');

    const spot = new BoundarySpots(scene.plane).spotOnTop(event, host);

    expect(spot?.y).toBe(host.bounds.y - 18);
    expect(Math.abs(spot!.center.x - event.bounds.center.x)).toBeLessThan(5);
  });

  it('has no spot on a top border a label fills', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const host = scene.shape('A');
    scene.shape('S').label = host.bounds.grow(30);

    expect(new BoundarySpots(scene.plane).spotOnTop(scene.shape('B'), host)).toBeUndefined();
  });
});
