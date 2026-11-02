import { describe, expect, it } from 'vitest';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('LayoutRun', () => {
  it('reads a drawing that counts what its frame edits move', async () => {
    const { run, plane, place } = await PlacementScene.of('add-after');

    expect(run.drawing(plane).touched).toBe(place.moved);
  });

  it('knows the id an element had before the operations and the one it has now', async () => {
    const { run, shape, before } = await sceneWithRename();

    expect(run.oldId(shape)).toBe('Old');
    expect(run.cur('Old')).toBe(shape.id);
    expect(run.cur(undefined)).toBeUndefined();
    expect(before.currentId('Unknown')).toBe('Unknown');
  });

  it('falls back to the id now without a DI from before', async () => {
    const scene = await PlacementScene.of('add-after');
    const fresh = scene.place.newShape(scene.plane, 'serviceTask_fz1ShipNotifyPaymentOrderApproveAndShip', scene.shape('Activity_Report').bounds.copy());

    expect(scene.run.oldId(fresh)).toBe('serviceTask_fz1ShipNotifyPaymentOrderApproveAndShip');
  });

  it('remembers the title of an expanded sub-process, none for a task', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');

    expect(scene.run.oldTitle(scene.shape('T'))).toBeUndefined();
    expect(scene.run.oldTitle(scene.shape('SP'))?.height).toBeGreaterThan(0);
  });

  it('puts its sets back as copies', async () => {
    const { run } = await PlacementScene.of('add-after');
    const sets = run.sets();
    run.reroute.add('Flow');

    run.restoreSets(sets);
    run.reroute.add('Other');

    expect(sets.reroute.size).toBe(0);
    expect([...run.reroute]).toEqual(['Other']);
  });

  async function sceneWithRename() {
    const scene = await PlacementScene.of('add-after');
    const shape = scene.shape('Activity_Report');
    const entry = scene.parts.before.byPlaneElement.get(shape.planeElement!)!;
    scene.parts.before.byPlaneElement.set(shape.planeElement!, { ...entry, id: 'Old' });
    scene.parts.before.els.set('Old', shape.el);
    return { run: scene.run, shape, before: scene.parts.before };
  }
});
