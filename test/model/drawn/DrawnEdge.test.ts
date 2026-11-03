import { DrawnEdge, DrawnPlane, ElementHomes } from '../../../src/model/index.js';
import { describe, expect, it } from 'vitest';
import { Fixtures } from '../../support/Fixtures.js';

async function planeOf(file: string): Promise<DrawnPlane> {
  const document = await Fixtures.read(`scoring/${file}.bpmn`);
  return DrawnPlane.of(DrawnPlane.read(document), new ElementHomes(document))[0]!;
}

describe('DrawnEdge', () => {
  it('draws a data association between its data object and its activity', async () => {
    const plane = await planeOf('data-association');

    expect(plane.edge('input')?.drawnEnds).toEqual(['data_read', 'task']);
    expect(plane.edge('output')?.drawnEnds).toEqual(['task', 'data_written']);
  });

  it('counts the activity of a data association among its ends', async () => {
    const plane = await planeOf('data-association');

    expect(plane.edge('input')?.ends.has('task')).toBe(true);
    expect(plane.edge('input')?.ends.has('data_read')).toBe(true);
  });

  it('recognises a line to an annotation, and a sequence flow for none', async () => {
    const plane = await planeOf('crossing');

    expect([plane.edge('line_across')?.isAnnotationLine, plane.edge('flow_down')?.isAnnotationLine]).toEqual([true, false]);
  });

  it('measures two segments on one line, and two beside each other as none', async () => {
    const inOut = await planeOf('in-out');
    const parallel = await planeOf('parallel-run');
    const [leftOfIn, rightOfIn] = inOut.edge('flow_in')!.segments;
    const [rightOfOut, downOfOut] = inOut.edge('flow_out')!.segments;
    const [, upOfTop] = parallel.edge('flow_top')!.segments;
    const [, upOfFork] = parallel.edge('flow_fork')!.segments;

    expect(DrawnEdge.collinearLength(rightOfIn!, rightOfOut!)).toBe(50);
    expect(DrawnEdge.collinearLength(upOfTop!, upOfFork!)).toBe(110);
    expect(DrawnEdge.collinearLength(leftOfIn!, downOfOut!)).toBe(0);
  });

  it('finds flows that cross, share an end or run along each other', async () => {
    const crossing = await planeOf('crossing');
    const inOut = await planeOf('in-out');

    expect(crossing.edge('flow_down')?.crosses(crossing.edge('flow_up')!)).toBe(true);
    expect(crossing.edge('flow_down')?.sharesEndWith(crossing.edge('flow_up')!)).toBe(false);
    expect(inOut.edge('flow_in')?.runsAlong(inOut.edge('flow_out')!)).toBe(true);
    expect(inOut.edge('flow_in')?.sharesEndWith(inOut.edge('flow_out')!)).toBe(true);
  });

  it('sums the length two flows share, without the segment pairs it skips', async () => {
    const plane = await planeOf('segment-overlap');
    const top = plane.edge('flow_top')!;
    const bottom = plane.edge('flow_bottom')!;

    expect(top.sharedLength(bottom)).toBe(200);
    expect(top.sharedLength(bottom, new Set(['2,2']))).toBe(0);
  });
});
