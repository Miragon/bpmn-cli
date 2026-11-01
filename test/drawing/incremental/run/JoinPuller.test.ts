import { describe, expect, it } from 'vitest';
import { JoinPuller } from '../../../../src/drawing/incremental/run/JoinPuller.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('JoinPuller', () => {
  const pullerOf = (scene: PlacementScene): JoinPuller => new JoinPuller(scene.run, scene.parts.before);

  it('leaves a gateway a new flow enters forward', async () => {
    const scene = await PlacementScene.of('add-branch');

    pullerOf(scene).pullJoins();

    expect(scene.run.relocated.size).toBe(0);
  });

  it('places a kept join again right of a new flow from beyond it, before its one successor', async () => {
    const scene = await PlacementScene.of('join-backwards');
    const join = scene.shape('Join');

    pullerOf(scene).pullJoins();

    expect(scene.plane.shapes.has('Join')).toBe(false);
    expect(scene.place.reuse.get('Join')?.shape).toBe(join);
    expect(scene.place.joins.get('Join')).toBe('Last');
    expect(scene.run.relocated.has('Join')).toBe(true);
    expect([...scene.run.reroute]).toEqual(expect.arrayContaining(['F2', 'F4']));
  });

  it('leaves a join on a loop, one with no single successor and one the successor of which lies left of a predecessor', async () => {
    const looped = await PlacementScene.of('join-backwards');
    looped.place.semantics.byId.get('Last')!.set('outgoing', [looped.place.semantics.byId.get('F1')]);
    looped.place.semantics.byId.get('F1')!.set('sourceRef', looped.place.semantics.byId.get('Last'));
    const crowded = await PlacementScene.of('join-backwards');
    crowded.shape('Last').bounds = new Box(380, 100, 100, 80);

    pullerOf(looped).pullJoins();
    pullerOf(crowded).pullJoins();

    expect(looped.run.relocated.size).toBe(0);
    expect(crowded.run.relocated.size).toBe(0);
  });

  it('pushes a kept target right of a new flow that enters it backwards', async () => {
    const scene = await PlacementScene.of('connect');
    const target = scene.shape('Event_DataArchived');
    target.bounds = new Box(100, 400, 36, 36);
    const collect = scene.shape('Activity_CollectData');
    collect.bounds = new Box(180, 360, 100, 80);

    pullerOf(scene).pushTargets();

    expect(target.bounds.x).toBeGreaterThan(collect.bounds.right);
  });

  it('leaves what was relocated where it will be placed', async () => {
    const scene = await PlacementScene.of('connect');
    const target = scene.shape('Event_DataArchived');
    target.bounds = new Box(100, 400, 36, 36);
    scene.run.relocated.add(target.id);

    pullerOf(scene).pushTargets();

    expect(target.bounds.x).toBe(100);
  });
});
