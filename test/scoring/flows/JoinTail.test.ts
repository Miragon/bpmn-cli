import { describe, expect, it } from 'vitest';
import { JoinTail } from '../../../src/scoring/flows/JoinTail.js';
import { DrawnPlane } from '../../../src/scoring/plane/DrawnPlane.js';
import { ElementHomes } from '../../../src/scoring/plane/ElementHomes.js';
import { Fixtures } from '../../support/Fixtures.js';

async function planeOf(file: string): Promise<DrawnPlane> {
  const document = await Fixtures.read(`scoring/${file}.bpmn`);
  return DrawnPlane.of(DrawnPlane.read(document), new ElementHomes(document))[0]!;
}

describe('JoinTail', () => {
  it('holds the segments two flows share into the bottom vertex of a gateway', async () => {
    const plane = await planeOf('join-tail');

    const pairs = new JoinTail(plane.shape('gateway_join')).segmentPairs(plane.edge('flow_left')!, plane.edge('flow_right')!);

    expect([...pairs]).toEqual(['1,1']);
  });

  it('holds nothing for flows into a task', async () => {
    const plane = await planeOf('segment-overlap');

    const pairs = new JoinTail(plane.shape('task_join')).segmentPairs(plane.edge('flow_top')!, plane.edge('flow_bottom')!);

    expect(pairs.size).toBe(0);
  });

  it('holds nothing for two flows drawn on top of each other from start to end', async () => {
    const plane = await planeOf('join-tail-together');

    const pairs = new JoinTail(plane.shape('gateway_join')).segmentPairs(plane.edge('flow_first')!, plane.edge('flow_second')!);

    expect(pairs.size).toBe(0);
  });
});
