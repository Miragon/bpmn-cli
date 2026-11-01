import { describe, expect, it } from 'vitest';
import { ScopeGraph } from '../../../../src/drawing/full/scopes/ScopeGraph.js';
import { ScopeGrid } from '../../../../src/drawing/full/scopes/ScopeGrid.js';
import { JoinColumnTrial } from '../../../../src/drawing/full/trials/JoinColumnTrial.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('JoinColumnTrial', () => {
  async function trial(path: string) {
    const document = await Fixtures.read(path);
    const { layout } = new ScopeGraph(document.tree.processes()[0]!, () => {});
    const grid = new ScopeGrid(layout);
    grid.arrange();
    const before = new Map(layout.nodes.map((node) => [node, node.layer]));
    new JoinColumnTrial(layout, (shifts) => grid.arrange(shifts)).run();
    return layout.nodes.filter((node) => node.layer !== before.get(node));
  }

  it('moves nothing where no column is blocked', async () => {
    expect(await trial('layout/gallery__01-xor-join.bpmn')).toEqual([]);
  });

  it.each(['layout/agent__large.bpmn', 'layout/gallery__06-big.bpmn', 'layout/gallery__07-fixture-large.bpmn'])('only ever moves a node right in %s', async (path) => {
    const moved = await trial(path);

    expect(moved.every((node) => node.layer >= 0)).toBe(true);
  });
});
