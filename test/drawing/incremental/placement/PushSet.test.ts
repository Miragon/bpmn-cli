import { describe, expect, it } from 'vitest';
import { PushSet, type PushRequest } from '../../../../src/drawing/incremental/placement/PushSet.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('PushSet', () => {
  const pushed = (scene: PlacementScene, request: PushRequest): Set<string> => new PushSet(scene.plane, request, (shape) => scene.drawing().space.unitBox(shape)).collect();

  it('moves the successor and what follows it, not the rest beyond the line', async () => {
    const scene = await PlacementScene.drawn('models/incremental/groups.bpmn');

    const moved = pushed(scene, { line: 400, delta: 100, successor: scene.shape('E1') });

    expect(moved.has('E1')).toBe(true);
    expect(moved.has('E2')).toBe(false);
  });

  it('leaves a fixed shape where it is', async () => {
    const scene = await PlacementScene.of('add-branch');

    const moved = pushed(scene, { line: 300, delta: 100, successor: scene.shape('Activity_C'), fixed: new Set(['Activity_D']) });

    expect(moved.has('Activity_C')).toBe(true);
    expect(moved.has('Activity_D')).toBe(false);
  });

  it('takes along what a new node would come close to', async () => {
    const scene = await PlacementScene.of('add-after');
    const box = new Box(640, 80, 100, 80);

    const moved = pushed(scene, { id: 'New', box, line: 600, delta: 160, successor: undefined });

    expect(moved.has('Gateway_Sufficient')).toBe(true);
    expect(moved.has('Event_End')).toBe(true);
  });

  it('never moves a pool, a lane or a boundary event by itself', async () => {
    const scene = await PlacementScene.of('add-annotation');

    const moved = pushed(scene, { line: 0, delta: 50, successor: scene.shape('Participant_Publisher') });

    expect(moved.size).toBe(0);
  });

  it('takes a boundary event with its host and the path it starts', async () => {
    const scene = await PlacementScene.of('add-boundary');

    const moved = pushed(scene, { line: 200, delta: 80, successor: scene.shape('A') });

    expect(moved).toEqual(expect.objectContaining({ size: expect.any(Number) }));
    expect([...moved]).toEqual(expect.arrayContaining(['A', 'B', 'E2', 'C']));
  });

  it('takes a group whose member moves, with the members of a group beyond the line', async () => {
    const scene = await PlacementScene.drawn('models/incremental/groups.bpmn');

    const moved = pushed(scene, { line: 760, delta: 80, successor: scene.shape('C') });

    expect([...moved]).toEqual(expect.arrayContaining(['G2', 'S3', 'C', 'E3', 'D']));
  });

  it('takes the sources of an association, and an annotation along with its anchor', async () => {
    const scene = await PlacementScene.of('move-lane');

    const moved = pushed(scene, { line: 900, delta: 40, successor: scene.shape('TextAnnotation_Fzt0') });

    expect(moved.has('TextAnnotation_Fzt0')).toBe(true);
  });
});
