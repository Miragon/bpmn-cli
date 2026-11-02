import { describe, expect, it } from 'vitest';
import { LaneRows } from '../../../../src/drawing/full/lanes/LaneRows.js';
import { LaneTree } from '../../../../src/drawing/full/lanes/LaneTree.js';
import { ScopeGraph } from '../../../../src/drawing/full/scopes/ScopeGraph.js';
import { ScopeGrid } from '../../../../src/drawing/full/scopes/ScopeGrid.js';
import { ChainLiftTrial } from '../../../../src/drawing/full/trials/ChainLiftTrial.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('ChainLiftTrial', () => {
  async function lifted(path: string) {
    const document = await Fixtures.read(path);
    const process = document.tree.processes().find((candidate) => candidate.list('laneSets').length)!;
    const { layout } = new ScopeGraph(process, () => {});
    new ScopeGrid(layout).arrange();
    const rows = new LaneRows(layout, new LaneTree(process.list('laneSets')[0]!, layout).leaves);
    rows.arrange();
    const before = new Map(layout.nodes.map((node) => [node, node.row]));
    new ChainLiftTrial(layout, () => rows.arrange()).run();
    return { layout, moved: layout.nodes.filter((node) => node.row !== before.get(node)), before };
  }

  it('does nothing without lanes', async () => {
    const document = await Fixtures.read('layout/gallery__01-xor-join.bpmn');
    const { layout } = new ScopeGraph(document.tree.processes()[0]!, () => {});
    new ScopeGrid(layout).arrange();

    new ChainLiftTrial(layout, () => {}).run();

    expect(layout.laneBands).toBeUndefined();
  });

  it.each(['layout/subproc__s09-lanes-zigzag.bpmn', 'layout/subproc__s16-lanes-parallel-join.bpmn', 'layout/lanes__complaint-t2.bpmn', 'layout/subproc__s19-lanes-loop-3.bpmn'])('only ever lifts a node to a higher row in %s', async (path) => {
    const { moved, before } = await lifted(path);

    expect(moved.every((node) => node.row < before.get(node)!)).toBe(true);
  });
});
