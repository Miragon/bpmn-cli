import { describe, expect, it } from 'vitest';
import { BoundaryReseat } from '../../../../src/drawing/incremental/frames/BoundaryReseat.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box } from '../../../support/ModelValues.js';

describe('BoundaryReseat', () => {
  async function planeOf(path = 'models/incremental/boundary.bpmn') {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  it('keeps an event at its offset from the far end when the host grew', async () => {
    const plane = await planeOf();
    const host = plane.shapes.get('A')!;
    const old = host.bounds.copy();
    host.bounds = new Box(old.x, old.y, 300, 160);
    const touched = new Set<string>();
    new BoundaryReseat(plane, host, old, touched).reseat();
    const event = plane.shapes.get('B')!;

    expect(event.bounds.center.y).toBe(host.bounds.bottom);
    expect(host.bounds.right - event.bounds.center.x).toBe(30);
    expect(touched).toEqual(new Set(['B']));
  });

  it('touches nothing when the event already sits right', async () => {
    const plane = await planeOf();
    const host = plane.shapes.get('A')!;
    const touched = new Set<string>();
    new BoundaryReseat(plane, host, host.bounds.copy(), touched).reseat();

    expect(touched.size).toBe(0);
  });

  it('takes the label along', async () => {
    const plane = await planeOf();
    const host = plane.shapes.get('A')!;
    const label = plane.shapes.get('B')!.label!;
    const { y } = label;
    const old = host.bounds.copy();
    host.bounds = new Box(old.x, old.y, old.width, 120);
    new BoundaryReseat(plane, host, old, new Set()).reseat();

    expect(label.y).toBe(y + 40);
  });

  it('fits an event from the far end when its offset leaves the shrunk host', async () => {
    const plane = await planeOf();
    const host = plane.shapes.get('A')!;
    const event = plane.shapes.get('B')!;
    const old = new Box(240, 80, 400, 80);
    event.bounds.x = 262;
    host.bounds = new Box(240, 80, 100, 80);
    new BoundaryReseat(plane, host, old, new Set()).reseat();

    expect(event.bounds.right).toBeLessThanOrEqual(host.bounds.right);
    expect(event.bounds.x).toBeGreaterThanOrEqual(host.bounds.x);
  });

  it('spreads events that no longer fit at their offsets', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const host = plane.shapes.get('Task_A')!;
    const first = plane.shapes.get('Timer_1')!;
    const second = plane.shapes.get('B_Sub')!;
    second.hostId = 'Task_A';
    second.parentId = undefined;
    const old = new Box(100, 110, 500, 80);
    first.bounds = new Box(300, 172, 36, 36);
    second.bounds = new Box(420, 172, 36, 36);
    new BoundaryReseat(plane, host, old, new Set()).reseat();

    expect(Math.abs(first.bounds.center.x - second.bounds.center.x)).toBeGreaterThanOrEqual(36);
  });

  it('sends an event to the opposite border when its own is full', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const host = plane.shapes.get('Task_A')!;
    const first = plane.shapes.get('Timer_1')!;
    const second = plane.shapes.get('B_Sub')!;
    second.hostId = 'Task_A';
    second.parentId = undefined;
    const old = new Box(100, 110, 500, 80);
    host.bounds = new Box(260, 110, 50, 80);
    first.bounds = new Box(300, 172, 36, 36);
    second.bounds = new Box(420, 172, 36, 36);
    new BoundaryReseat(plane, host, old, new Set()).reseat();

    expect([first.bounds.center.y, second.bounds.center.y].sort()).toEqual([110, 190]);
  });

  it('leaves an event it cannot seat anywhere at the far end of the opposite border', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const host = plane.shapes.get('Task_A')!;
    const event = plane.shapes.get('Timer_1')!;
    const old = new Box(100, 110, 500, 80);
    host.bounds = new Box(260, 110, 20, 80);
    event.bounds = new Box(300, 172, 36, 36);
    new BoundaryReseat(plane, host, old, new Set()).reseat();

    expect(event.bounds.center.y).toBe(110);
    expect(event.bounds.center.x).toBe(262);
  });

  it('seats events on the left and right borders by their height', async () => {
    const plane = await planeOf();
    const host = plane.shapes.get('A')!;
    const event = plane.shapes.get('B')!;
    const old = host.bounds.copy();
    event.bounds = new Box(old.x - 18, 100, 36, 36);
    host.bounds = new Box(old.x, old.y, old.width, 160);
    new BoundaryReseat(plane, host, old, new Set()).reseat();
    expect(event.bounds.center.x).toBe(host.bounds.x);

    event.bounds = new Box(host.bounds.right - 18, 100, 36, 36);
    new BoundaryReseat(plane, host, host.bounds.copy(), new Set()).reseat();
    expect(event.bounds.center.x).toBe(host.bounds.right);
  });

  it('seats an event on the top border', async () => {
    const plane = await planeOf();
    const host = plane.shapes.get('A')!;
    const event = plane.shapes.get('B')!;
    event.bounds = new Box(290, 62, 36, 36);
    const old = host.bounds.copy();
    host.bounds = new Box(old.x, old.y - 20, old.width, 100);
    new BoundaryReseat(plane, host, old, new Set()).reseat();

    expect(event.bounds.center.y).toBe(host.bounds.y);
  });
});
