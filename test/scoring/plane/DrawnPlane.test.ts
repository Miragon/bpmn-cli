import { describe, expect, it } from 'vitest';
import { DrawnPlane } from '../../../src/scoring/plane/DrawnPlane.js';
import { ElementHomes } from '../../../src/scoring/plane/ElementHomes.js';
import { Fixtures } from '../../support/Fixtures.js';

async function planesOf(file: string): Promise<DrawnPlane[]> {
  const document = await Fixtures.read(file);
  return DrawnPlane.of(DrawnPlane.read(document), new ElementHomes(document));
}

describe('DrawnPlane', () => {
  it('reads the shapes and edges of a plane and the element it shows', async () => {
    const [plane] = await planesOf('scoring/through.bpmn');

    expect(plane?.root).toBe('process');
    expect(plane?.shapes).toHaveLength(4);
    expect(plane?.edges.map(({ id }) => id)).toEqual(['flow_over_task']);
  });

  it('reads one plane per diagram', async () => {
    expect(await planesOf('models/incremental/twoviews.bpmn')).toHaveLength(2);
  });

  it('gives a file without a diagram one empty plane, so its elements count as missing', async () => {
    const planes = await planesOf('model/c8-vendor.bpmn');

    expect(planes).toHaveLength(1);
    expect(planes[0]?.shapes).toEqual([]);
  });

  it('shows an element whose shape has no bounds, though it cannot measure it', async () => {
    const [plane] = await planesOf('models/incremental/nobounds.bpmn');
    const document = await Fixtures.read('models/incremental/nobounds.bpmn');
    const unmeasured = DrawnPlane.read(document).flatMap(({ unmeasuredIds }) => unmeasuredIds ?? []);

    expect(unmeasured.length).toBeGreaterThan(0);
    expect(unmeasured.every((id) => plane?.shows(id) && !plane.shape(id))).toBe(true);
  });

  it('pairs every two items once', () => {
    expect([...DrawnPlane.pairs(['a', 'b', 'c'])]).toEqual([['a', 'b'], ['a', 'c'], ['b', 'c']]);
    expect([...DrawnPlane.pairs(['a'])]).toEqual([]);
  });

  it('estimates the text of a label from its name, centred and wrapped at 90 pixels', async () => {
    const [plane] = await planesOf('scoring/label-clash.bpmn');
    const label = plane!.shape('event_on_task')!.label!;

    expect(DrawnPlane.glyph(label, 'Named')).toMatchObject({ x: 135, y: 160, width: 30, height: 14 });
    expect(DrawnPlane.glyph(label, '')).toMatchObject({ x: 147, width: 6, height: 14 });
    expect(DrawnPlane.glyph(label, 'x'.repeat(20))).toMatchObject({ x: 105, width: 90, height: 28 });
  });

  it('finds the pool of a process and an expanded sub-process, not a collapsed one', async () => {
    const [pools] = await planesOf('scoring/containment.bpmn');
    const process = pools!.shape('task_in_lane')!.el.parent;

    expect(pools?.poolOf(process)?.id).toBe('pool');
    expect(pools?.expandedSubProcess(pools.shape('sub')?.el)?.id).toBe('sub');
    expect(pools?.expandedSubProcess(process)).toBeUndefined();
  });

  it('lists the named labels outside their shapes, not unnamed ones', async () => {
    const [plane] = await planesOf('scoring/label-outside-frame.bpmn');

    expect(plane?.namedOuterLabels().map(({ id }) => id)).toEqual(['event_inside', 'event_outside']);
    expect(plane?.labels.map(({ owner }) => owner)).toEqual(['event_inside', 'event_outside', 'event_unnamed']);
  });
});
