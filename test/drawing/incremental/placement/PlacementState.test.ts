import { describe, expect, it } from 'vitest';
import { ShapeSizes } from '../../../../src/drawing/plane/ShapeSizes.js';
import { Box, ChangeSet } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('PlacementState', () => {
  const NEW_TASK = 'serviceTask_fz1ShipNotifyPaymentOrderApproveAndShip';

  it('sizes a new task by the table, however wide the drawn tasks are', async () => {
    const scene = await PlacementScene.of('add-after');
    scene.shape('Activity_Report').bounds = new Box(496, 80, 180, 120);

    expect(scene.place.sizeFor(NEW_TASK)).toEqual(ShapeSizes.TASK);
  });

  it('starts a new sub-process expanded at the size bpmn-js gives it, and a collapsed one like a task', async () => {
    const expanded = await PlacementScene.of('add-subprocess');
    const changes = new ChangeSet();
    changes.expansions.expand('Activity_Fzs3', false);
    const collapsed = new PlacementScene({ ...expanded.parts, changes });

    expect(expanded.place.sizeFor('Activity_Fzs3')).toEqual(ShapeSizes.NEW_SUB_PROCESS);
    expect(collapsed.place.sizeFor('Activity_Fzs3')).toEqual(ShapeSizes.TASK);
  });

  it('keeps the size of a node placed again and of a block laid out elsewhere', async () => {
    const scene = await PlacementScene.of('add-after');
    const shape = scene.shape('Activity_Report');
    shape.bounds = new Box(0, 0, 130, 90);
    scene.place.reuse.set('Activity_Report', { shape, boundaries: [], from: scene.plane });
    scene.place.blockSize.set(NEW_TASK, { width: 500, height: 300 });

    expect(scene.place.sizeFor('Activity_Report')).toEqual({ width: 130, height: 90 });
    expect(scene.place.sizeFor(NEW_TASK)).toEqual({ width: 500, height: 300 });
  });

  it('puts back what a repair trial placed', async () => {
    const scene = await PlacementScene.of('add-after');
    const memo = scene.place.checkpoint();
    scene.place.placed.add(NEW_TASK);
    scene.place.skip.set(NEW_TASK, 1);
    scene.place.spacing.clear();

    scene.place.restore(memo);

    expect(scene.place.placed.size).toBe(0);
    expect(scene.place.skip.size).toBe(0);
    expect(scene.place.spacing.has(scene.plane)).toBe(true);
  });

  it('keeps one drawing per plane', async () => {
    const scene = await PlacementScene.of('add-after');

    expect(scene.place.drawing(scene.plane)).toBe(scene.place.drawing(scene.plane));
  });

  it('measures the spacing again without the flows of a node still to be routed', async () => {
    const scene = await PlacementScene.of('add-after');
    scene.place.spacing.clear();

    expect(scene.place.spacingFor(scene.plane).gap).toBe(60);
    expect(scene.place.spacingWithout(scene.plane, ['Activity_Analyse']).gap).toBe(60);
  });

  it('takes a shape back under its frame when it was placed above the interior', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const shape = scene.place.newShape(scene.plane, 'A', new Box(100, 80, 100, 80));

    scene.place.commit(scene.plane, shape);

    expect(shape.bounds.x).toBeGreaterThan(100);
    expect(shape.bounds.y).toBeGreaterThan(80);
  });

  it('gives a node placed again its DI and moves its label along', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const old = scene.shape('B');
    old.label = new Box(290, 180, 40, 14);
    scene.place.reuse.set('B', { shape: old, boundaries: [], from: scene.plane });

    const shape = scene.place.newShape(scene.plane, 'B', new Box(old.bounds.x + 10, old.bounds.y + 5, 36, 36));

    expect(shape.di).toBe(old.di);
    expect(shape.label).toMatchObject({ x: 300, y: 185 });
  });

  it('brings boundary events and content of a relocated sub-process along', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const shape = scene.shape('SP');
    const content = scene.plane.contentOf('SP');
    const firstX = content.shapes[0]!.bounds.x;
    const firstPoint = content.edges[0]!.points[0]!.x;
    scene.plane.shapes.delete('SP');
    scene.place.reuse.set('SP', { shape, boundaries: [], from: scene.plane, content });

    scene.place.placeAt(scene.plane, 'SP', shape.bounds.x + 40, shape.bounds.center.y, scene.place.sizeFor('SP'));

    expect(content.shapes[0]!.bounds.x).toBe(firstX + 40);
    expect(content.edges[0]!.points[0]!.x).toBe(firstPoint + 40);
    expect(scene.place.reuse.has('SP')).toBe(false);
    expect(scene.place.moved.has(content.shapes[0]!.id)).toBe(true);
  });

  it('follows a flow only forward, loops included', async () => {
    const scene = await PlacementScene.of('add-branch');

    expect(scene.place.leadsTo('Activity_A', 'Activity_E')).toBe(true);
    expect(scene.place.leadsTo('Event_End', 'Activity_A')).toBe(false);
  });

  it('knows the frame of a shape not drawn yet', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');

    expect(scene.place.probeOf(scene.plane, 'A')).toMatchObject({ id: 'A', kind: 'task', poolId: 'Pool' });
  });
});
