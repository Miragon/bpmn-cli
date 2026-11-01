import { describe, expect, it } from 'vitest';
import { LaneRows } from '../../../../src/drawing/full/lanes/LaneRows.js';
import { LaneTree } from '../../../../src/drawing/full/lanes/LaneTree.js';
import { ScopeGrid } from '../../../../src/drawing/full/scopes/ScopeGrid.js';
import { ScopeGraph } from '../../../../src/drawing/full/scopes/ScopeGraph.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('LaneRows', () => {
  async function arranged(path: string) {
    const document = await Fixtures.read(path);
    const process = document.tree.processes().find((candidate) => candidate.list('laneSets').length)!;
    const { layout } = new ScopeGraph(process, () => {});
    new ScopeGrid(layout).arrange();
    const { leaves } = new LaneTree(process.list('laneSets')[0]!, layout);
    new LaneRows(layout, leaves).arrange();
    return { layout, leaves };
  }

  it('puts each node inside its lane band', async () => {
    const { layout, leaves } = await arranged('layout/subproc__s09-lanes-zigzag.bpmn');

    expect(layout.laneBands).toHaveLength(leaves.length);
    for (const band of layout.laneBands!) {
      expect([...band.nodes].every((node) => node.box.y >= band.top && node.box.bottom <= band.bottom)).toBe(true);
    }
  });

  it('stacks the lanes without a gap', async () => {
    const { leaves } = await arranged('layout/lanes__complaint-t1.bpmn');

    leaves.slice(1).forEach((lane, index) => {
      expect(lane.y).toBe(leaves[index]!.y + leaves[index]!.height);
    });
  });
});
