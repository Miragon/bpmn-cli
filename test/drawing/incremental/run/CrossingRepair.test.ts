import { describe, expect, it } from 'vitest';
import { CrossingRepair } from '../../../../src/drawing/incremental/run/CrossingRepair.js';
import { RunCheckpoint } from '../../../../src/drawing/incremental/run/RunCheckpoint.js';
import { IncrementalLayout } from '../../../../src/drawing/incremental/IncrementalLayout.js';
import { DrawingPair } from '../../../support/DrawingPair.js';
import { Point } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('CrossingRepair', () => {
  async function chainCrossing(redraws: { count: number }): Promise<{ scene: PlacementScene; repair: () => Promise<string[]> }> {
    const scene = await PlacementScene.of('connect');
    const { run } = scene;
    const [first, second] = [...scene.plane.edges.values()];
    const checkpoints = new RunCheckpoint(run);
    const start = checkpoints.take();
    const cross = (): void => {
      run.newEdges.add(first!.id);
      first!.points = [new Point(200, 300), new Point(600, 300)];
      second!.points = [new Point(400, 100), new Point(400, 500)];
    };
    run.place.placed.add(first!.targetId!);
    run.place.heads.set(first!.targetId!, 3);
    cross();
    return {
      scene,
      repair: () => new CrossingRepair(run, checkpoints).repair([], start, async () => {
        redraws.count++;
        run.place.heads.set(first!.targetId!, 3);
        cross();
        return [];
      }),
    };
  }

  it('hands a drawing without crossings back as it is', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const checkpoints = new RunCheckpoint(scene.run);
    const rerouted = ['Flow'];

    await expect(new CrossingRepair(scene.run, checkpoints).repair(rerouted, checkpoints.take(), () => Promise.reject(new Error('never')))).resolves.toBe(rerouted);
  });

  it('routes a kept line again that a new one crosses, and says so', async () => {
    const { document, before, changes } = await DrawingPair.read('crossing-kept');

    const { notes, rerouted } = await new IncrementalLayout(document, before).place(changes);

    expect(notes.join()).toContain('routed again: it crossed the new');
    expect(rerouted).toContain('Flow_15');
  });

  it('places a chain at its next row when routing again does not help', async () => {
    const { document, before, changes } = await DrawingPair.read('chain-retry');

    const { notes } = await new IncrementalLayout(document, before).place(changes);

    expect(notes).toContain('Activity_Fzbh3 placed at another row: at the first one its path crossed a line');
  });

  it('keeps the first drawing when the redraw fails', async () => {
    const redraws = { count: 0 };
    const { scene, repair } = await chainCrossing(redraws);
    const failing = await failingRepair(scene);

    await failing();

    expect(scene.place.notes.join()).not.toContain('placed at another row');
    await repair();
    expect(redraws.count).toBe(0);
  });

  function failingRepair(scene: PlacementScene): () => Promise<string[]> {
    const checkpoints = new RunCheckpoint(scene.run);
    const start = checkpoints.take();
    return () => new CrossingRepair(scene.run, checkpoints).repair([], start, () => Promise.reject(new Error('no room')));
  }
});
