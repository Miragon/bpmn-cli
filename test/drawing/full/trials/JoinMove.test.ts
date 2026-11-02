import { describe, expect, it } from 'vitest';
import type { GNode, ScopeLayout } from '../../../../src/drawing/full/scopes/GNode.js';
import { ScopeGraph } from '../../../../src/drawing/full/scopes/ScopeGraph.js';
import { ScopeGrid } from '../../../../src/drawing/full/scopes/ScopeGrid.js';
import { ChannelRouter } from '../../../../src/drawing/full/routing/ChannelRouter.js';
import { ScopeLabels } from '../../../../src/drawing/full/scopes/ScopeLabels.js';
import { ArrangementCheckpoint } from '../../../../src/drawing/full/trials/ArrangementCheckpoint.js';
import type { Routes } from '../../../../src/drawing/full/trials/ArrangementTrial.js';
import { JoinMove } from '../../../../src/drawing/full/trials/JoinMove.js';
import { TakenColumns } from '../../../../src/drawing/full/trials/TakenColumns.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('JoinMove', () => {
  function routesOf(layout: ScopeLayout): Routes {
    const checkpoint = new ArrangementCheckpoint(layout);
    const router = new ChannelRouter(layout);
    router.route();
    const labels = new ScopeLabels(layout);
    const routes = { ...router.faults(labels.all()), rises: new Set(), above: new Set(), straight: new Set(), bends: 0, shared: 0, sharing: new Set() } as Routes;
    checkpoint.restore();
    return routes;
  }

  it('undoes a move that draws no better', async () => {
    const document = await Fixtures.read('layout/controlflow__s14.bpmn');
    const { layout } = new ScopeGraph(document.tree.processes()[0]!, () => {});
    const grid = new ScopeGrid(layout);
    grid.arrange();
    const shifts = new Map<GNode, number>();
    const before = routesOf(layout);
    const [candidate] = layout.nodes;
    const x = candidate!.box.x;

    const kept = new JoinMove({ layout, arrange: (moves) => grid.arrange(moves), route: () => before, shifts }, candidate!, new TakenColumns(layout).of(), before).attempt();

    expect(kept).toBeUndefined();
    expect(shifts.size).toBe(0);
    expect(candidate!.box.x).toBe(x);
  });

  it('keeps a move that lowers the faults and hands over the columns it leaves', async () => {
    const document = await Fixtures.read('layout/controlflow__s14.bpmn');
    const { layout } = new ScopeGraph(document.tree.processes()[0]!, () => {});
    const grid = new ScopeGrid(layout);
    grid.arrange();
    const shifts = new Map<GNode, number>();
    const before = { ...routesOf(layout), hits: 5 };
    const after = { ...before, hits: 0 };

    const kept = new JoinMove({ layout, arrange: (moves) => grid.arrange(moves), route: () => after, shifts }, layout.nodes[0]!, new TakenColumns(layout).of(), before).attempt();

    expect(kept?.routes).toBe(after);
    expect(shifts.get(layout.nodes[0]!)).toBeGreaterThan(0);
  });
});
