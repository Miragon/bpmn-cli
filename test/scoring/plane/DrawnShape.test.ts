import { describe, expect, it } from 'vitest';
import { DrawnPlane } from '../../../src/scoring/plane/DrawnPlane.js';
import { DrawnShape } from '../../../src/scoring/plane/DrawnShape.js';
import { ElementHomes } from '../../../src/scoring/plane/ElementHomes.js';
import { Fixtures } from '../../support/Fixtures.js';

async function planeOf(file: string): Promise<DrawnPlane> {
  const document = await Fixtures.read(file);
  return DrawnPlane.of(DrawnPlane.read(document), new ElementHomes(document))[0]!;
}

describe('DrawnShape', () => {
  it('takes pools, lanes and expanded sub-processes for frames, not tasks', async () => {
    const plane = await planeOf('scoring/containment.bpmn');

    expect(plane.shapes.filter((shape) => shape.isFrame).map(({ id }) => id).sort()).toEqual(['lane_lower', 'lane_upper', 'pool', 'sub']);
  });

  it('attaches a boundary event to its host only', async () => {
    const plane = await planeOf('scoring/overlap-boundary.bpmn');
    const event = plane.shape('boundary_timer')!;
    const host = plane.shape('task_host')!;

    expect(event.isAttachedTo(host)).toBe(true);
    expect(host.isAttachedTo(event)).toBe(false);
  });

  it('lets a box touch its frame but not stick out by half a pixel', async () => {
    const plane = await planeOf('scoring/overlap.bpmn');
    const { bounds } = plane.shape('task_apart')!;

    expect(DrawnShape.isWithin(bounds, bounds)).toBe(true);
    expect(DrawnShape.isWithin(bounds.grow(0.5), bounds)).toBe(false);
  });

  it('labels events, gateways and data outside their shape, tasks inside', async () => {
    const events = await planeOf('scoring/label-clash.bpmn');
    const data = await planeOf('scoring/data-association.bpmn');
    const gateways = await planeOf('scoring/join-tail.bpmn');

    expect([events.shape('task')?.isLabelledOutside, events.shape('event_first')?.isLabelledOutside]).toEqual([false, true]);
    expect([data.shape('data_read')?.isLabelledOutside, gateways.shape('gateway_join')?.isLabelledOutside]).toEqual([true, true]);
  });
});
