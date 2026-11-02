import { describe, expect, it } from 'vitest';
import { CleanEngine } from '../../../../src/drawing/full/pools/CleanEngine.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('PoolStacker', () => {
  async function plane(path: string) {
    const document = await Fixtures.read(path);
    const { warnings } = new CleanEngine(document, document.diagram.expandedIds()).run();
    return { warnings, plane: new PlaneReader(document.tree.definitions).planes()[0]! };
  }

  it('stacks the pools one below the other at one width', async () => {
    const { plane: drawn } = await plane('layout/subproc__s08-collab3.bpmn');
    const pools = [...drawn.shapes.values()].filter((shape) => shape.kind === 'participant').sort((first, second) => first.bounds.y - second.bounds.y);

    expect(new Set(pools.map((pool) => pool.bounds.width)).size).toBe(1);
    pools.slice(1).forEach((pool, index) => {
      expect(pool.bounds.y).toBeGreaterThan(pools[index]!.bounds.bottom);
    });
  });

  it('draws each message flow from its source to its target', async () => {
    const { plane: drawn, warnings } = await plane('layout/subproc__s17-msgflow-targets.bpmn');
    const flows = [...drawn.edges.values()].filter((edge) => edge.kind === 'messageFlow');

    expect(warnings).toEqual([]);
    expect(flows.length).toBeGreaterThan(0);
    expect(flows.every((flow) => flow.points.length >= 2)).toBe(true);
  });

  it('reorders pools when a stack in another order cuts fewer shapes', async () => {
    const { plane: drawn } = await plane('layout/agent__onb.bpmn');
    const top = [...drawn.shapes.values()].filter((shape) => shape.kind === 'participant').sort((first, second) => first.bounds.y - second.bounds.y)[0];

    expect(top?.id).toBe('Participant_HiringManager');
  });
});
