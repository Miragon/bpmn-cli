import { describe, expect, it } from 'vitest';
import { NodePlacer } from '../../../../src/drawing/incremental/placement/NodePlacer.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('NeighbourPlacer', () => {
  const placeAll = (scene: PlacementScene, ids: string[]): string[] => new NodePlacer(scene.place).placeFlowNodes(ids);

  it('continues the row of its anchor', async () => {
    const scene = await PlacementScene.of('add-flow');
    const task = 'manualTask_fz2ArchiveContractShipNotifyDocument';
    scene.place.semantics.byId.get(task)!.set('outgoing', []);

    placeAll(scene, [task]);

    expect(scene.shape(task).bounds.center.y).toBe(scene.shape('C').bounds.center.y);
    expect(scene.place.continued.has(task)).toBe(true);
  });

  it('runs an exception path below its host', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const anchor = scene.shape('manualTask_fz2ArchiveContractShipNotifyDocument');

    placeAll(scene, ['Event_Fzb3', 'Activity_Fzbh3']);

    expect(scene.shape('Activity_Fzbh3').bounds.center.y).toBeGreaterThan(anchor.bounds.bottom);
  });

  it('splices a node into its flow, on the row of the node it goes before, making only the room it needs', async () => {
    const scene = await PlacementScene.of('add-flow');
    const task = 'manualTask_fz2ArchiveContractShipNotifyDocument';
    const before = scene.shape('C').bounds.right;

    placeAll(scene, [task]);

    const shape = scene.shape(task);
    expect(shape.bounds.x).toBeGreaterThan(before);
    expect(shape.bounds.center.y).toBe(scene.shape('D').bounds.center.y);
    expect(scene.shape('D').bounds.x).toBeGreaterThanOrEqual(shape.bounds.right + 40);
    expect(scene.shape('E2').bounds.x).toBe(292);
  });

  it('opens a new branch on a free row below its anchor', async () => {
    const scene = await PlacementScene.of('split');
    const shapes = [...scene.plane.shapes.keys()];
    const created = scene.parts.changes.created.map(({ id }) => id).filter((id) => scene.place.semantics.byId.get(id)?.is('bpmn:FlowNode'));

    placeAll(scene, created);

    expect(created.every((id) => scene.plane.shapes.has(id))).toBe(true);
    expect(shapes.every((id) => scene.plane.shapes.has(id))).toBe(true);
  });

  it('places a node before a drawn successor when nothing leads to it', async () => {
    const scene = await PlacementScene.of('add-flow');
    const task = 'manualTask_fz2ArchiveContractShipNotifyDocument';
    const element = scene.place.semantics.byId.get(task)!;
    element.set('incoming', []);

    placeAll(scene, [task]);

    expect(scene.shape(task).bounds.right).toBeLessThan(scene.shape('D').bounds.x);
  });

  it('places an unconnected node below the content of its frame', async () => {
    const scene = await PlacementScene.of('add-flow');
    const task = 'manualTask_fz2ArchiveContractShipNotifyDocument';
    const element = scene.place.semantics.byId.get(task)!;
    element.set('incoming', []);
    element.set('outgoing', []);

    placeAll(scene, [task]);

    const shape = scene.shape(task);
    expect(shape.bounds.y).toBeGreaterThan(scene.shape('A').bounds.bottom);
    expect(shape.bounds.x).toBe(152);
  });

  it('places the first node of an empty sub-process inside it', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const inner = ['SS', 'ST', 'SE'].map((id) => scene.shape(id));
    inner.forEach(({ id }) => scene.plane.shapes.delete(id));
    scene.place.semantics.byId.get('SS')!.set('outgoing', []);

    placeAll(scene, ['SS']);

    expect(scene.shape('SS').bounds.isInside(scene.shape('SP').bounds)).toBe(true);
  });

  it('places the first node of an empty plane near its origin', async () => {
    const scene = await PlacementScene.of('add-flow');
    const task = 'manualTask_fz2ArchiveContractShipNotifyDocument';
    const element = scene.place.semantics.byId.get(task)!;
    element.set('incoming', []);
    element.set('outgoing', []);
    scene.plane.shapes.clear();
    scene.plane.edges.clear();

    placeAll(scene, [task]);

    expect(scene.shape(task).bounds.x).toBe(160);
  });
});
