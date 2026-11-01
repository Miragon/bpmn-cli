import { describe, expect, it } from 'vitest';
import { ChainSearch } from '../../../../src/drawing/incremental/placement/ChainSearch.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('ChainSearch', () => {
  it('keeps room for one event behind a task without a successor yet, not behind an end event', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    scene.place.semantics.byId.get('C')!.set('outgoing', []);
    scene.place.semantics.byId.get('E')!.set('incoming', []);

    expect(new ChainSearch(scene.place).extent('C', new Set(), 60)).toBe(96);
    expect(new ChainSearch(scene.place).extent('E', new Set(), 60)).toBe(0);
  });

  it('counts the new nodes that follow in a simple chain, an end event ends it', async () => {
    const scene = await PlacementScene.of('split');

    const search = new ChainSearch(scene.place);

    expect(search.extent('task_fz8B0N0', new Set(['sendTask_fz8B0N1']), 60)).toBe(160);
    expect(search.extent('task_fz8B0N0', new Set(), 60)).toBe(0);
  });

  it('finds the node a new task was spliced before, through the flow it took over', async () => {
    const scene = await PlacementScene.of('add-flow');

    expect(new ChainSearch(scene.place).spliceTarget(scene.plane, 'manualTask_fz2ArchiveContractShipNotifyDocument', 'C')).toBe('D');
  });

  it('continues the splice of the node before it in a chain', async () => {
    const scene = await PlacementScene.of('split');
    scene.place.placed.add('task_fz8B0N0');
    scene.place.spliced.set('task_fz8B0N0', 'gateway_fz8SplitJoin');

    expect(new ChainSearch(scene.place).spliceTarget(scene.plane, 'sendTask_fz8B0N1', 'task_fz8B0N0')).toBe('gateway_fz8SplitJoin');
  });

  it('answers the successor of a join placed again', async () => {
    const scene = await PlacementScene.of('add-flow');
    scene.place.joins.set('C', 'D');

    expect(new ChainSearch(scene.place).spliceTarget(scene.plane, 'C', 'A')).toBe('D');
  });

  it('has no target for a plain continuation', async () => {
    const scene = await PlacementScene.of('add-after');

    expect(new ChainSearch(scene.place).spliceTarget(scene.plane, 'Activity_Report', 'Activity_Analyse')).toBeUndefined();
  });
});
