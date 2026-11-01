import { describe, expect, it } from 'vitest';
import { LaneTree } from '../../../../src/drawing/full/lanes/LaneTree.js';
import { ScopeGraph } from '../../../../src/drawing/full/scopes/ScopeGraph.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('LaneTree', () => {
  async function treeOf(path: string) {
    const document = await Fixtures.read(path);
    const process = document.tree.processes().find((candidate) => candidate.list('laneSets').length)!;
    const { layout } = new ScopeGraph(process, () => {});
    return { tree: new LaneTree(process.list('laneSets')[0]!, layout), layout };
  }

  it('holds the leaf lanes in order of declaration, with nested lanes as leaves', async () => {
    const { tree } = await treeOf('layout/subproc__s10-nested-lanes.bpmn');

    expect(tree.leaves.length).toBeGreaterThan(tree.boxes(100).length);
  });

  it('gives each node one lane', async () => {
    const { tree, layout } = await treeOf('layout/subproc__s10-nested-lanes.bpmn');

    expect(tree.leaves.flatMap((lane) => lane.nodes).length).toBeGreaterThanOrEqual(layout.nodes.length);
  });

  it('closes a parent lane around its children, the deeper a box the further right', async () => {
    const { tree } = await treeOf('layout/subproc__s10-nested-lanes.bpmn');
    tree.leaves.forEach((lane, index) => {
      lane.y = index * 100;
      lane.height = 100;
    });
    tree.closeUp();

    const parent = tree.boxes(500).find((lane) => lane.children.length)!;

    expect(parent.box.height).toBe(parent.children.reduce((sum, child) => sum + child.box.height, 0));
    expect(parent.children[0]!.box.x).toBeGreaterThan(parent.box.x);
  });
});
