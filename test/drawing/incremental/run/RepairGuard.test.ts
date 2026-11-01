import { describe, expect, it } from 'vitest';
import { RepairGuard } from '../../../../src/drawing/incremental/run/RepairGuard.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('RepairGuard', () => {
  it('runs out after its trials', async () => {
    const { run } = await PlacementScene.of('add-after');
    const guard = new RepairGuard(run);

    for (let trial = 0; trial < 8; trial++) {
      expect(guard.exhausted).toBe(false);
      guard.begin();
    }

    expect(guard.exhausted).toBe(true);
  });

  it('undoes a trial that does not lower the score', async () => {
    const { run } = await PlacementScene.of('add-after');
    const guard = new RepairGuard(run);
    guard.begin();

    expect(guard.keeps()).toBe(false);
  });

  it('keeps a trial that lowers the score without a new hard problem', async () => {
    const scene = await PlacementScene.of('add-after');
    const report = scene.shape('Activity_Report');
    report.bounds = new Box(346, 80, 100, 80);
    const guard = new RepairGuard(scene.run);
    guard.begin();

    report.bounds = new Box(496, 80, 100, 80);

    expect(guard.keeps()).toBe(true);
  });
});
