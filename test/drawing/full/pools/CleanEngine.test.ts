import { describe, expect, it } from 'vitest';
import { CleanEngine } from '../../../../src/drawing/full/pools/CleanEngine.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('CleanEngine', () => {
  async function drawn(path: string, expanded?: Set<string>) {
    const document = await Fixtures.read(path);
    const { warnings } = new CleanEngine(document, expanded ?? document.diagram.expandedIds()).run();
    return { warnings, planes: new PlaneReader(document.tree.definitions).planes() };
  }

  it('draws a process on one plane', async () => {
    const { planes } = await drawn('layout/gallery__01-xor-join.bpmn');

    expect(planes).toHaveLength(1);
  });

  it('draws a collapsed sub-process on a plane of its own, and leaves its ids unique', async () => {
    const { planes } = await drawn('layout/subproc__s03-collapsed.bpmn', new Set());

    expect(planes.length).toBeGreaterThan(1);
    expect(new Set(planes.map((plane) => plane.id)).size).toBe(planes.length);
  });

  it('draws the lanes of a process without a pool, content inside them', async () => {
    const { planes } = await drawn('layout/lanes__complaint-t1.bpmn');
    const lanes = [...planes[0]!.shapes.values()].filter((shape) => shape.kind === 'lane');

    expect(lanes.length).toBeGreaterThan(1);
    expect(planes[0]!.leaves().every((shape) => lanes.some((lane) => shape.bounds.isInside(lane.bounds)))).toBe(true);
  });

  it('removes the old diagram of a file without a process', async () => {
    const { planes } = await drawn('drawing/full/no-process.bpmn');

    expect(planes).toEqual([]);
  });
});
