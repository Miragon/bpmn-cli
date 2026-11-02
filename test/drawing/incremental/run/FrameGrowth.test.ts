import { describe, expect, it } from 'vitest';
import { FrameGrowth } from '../../../../src/drawing/incremental/run/FrameGrowth.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('FrameGrowth', () => {
  const growthOf = (scene: PlacementScene): FrameGrowth => new FrameGrowth(scene.run, scene.parts.before, new Map([...scene.plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()])));
  const LONG_NAME = 'An activity with a name that takes more lines than the hundred pixels of its shape can show';

  it('keeps a task at its size for a long new name, and its neighbour where it stood', async () => {
    const scene = await PlacementScene.of('rename');
    const task = scene.shape('Activity_Evaluate');
    const box = task.bounds.copy();
    const next = scene.shape('Activity_StandardTrack').bounds.copy();
    task.el.set('name', LONG_NAME);

    growthOf(scene).growForTitles();

    expect(task.bounds).toEqual(box);
    expect(scene.shape('Activity_StandardTrack').bounds).toEqual(next);
    expect(scene.place.notes).toEqual([]);
  });

  it('leaves a sub-process the engine drew', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const sub = scene.shape('SP');
    const inner = scene.shape('ST');
    inner.bounds = new Box(inner.bounds.x, sub.bounds.y + 22, 100, 80);
    const box = inner.bounds.copy();
    sub.el.set('name', `${LONG_NAME} ${LONG_NAME} ${LONG_NAME} ${LONG_NAME} ${LONG_NAME} ${LONG_NAME}`);
    scene.run.fromEngine.add(sub.id);

    growthOf(scene).growForTitles();

    expect(inner.bounds).toEqual(box);
  });

  it('makes room below a longer title of a sub-process', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const sub = scene.shape('SP');
    const inner = scene.shape('ST');
    inner.bounds = new Box(inner.bounds.x, sub.bounds.y + 22, 100, 80);
    sub.el.set('name', `${LONG_NAME} ${LONG_NAME} ${LONG_NAME} ${LONG_NAME} ${LONG_NAME} ${LONG_NAME}`);

    growthOf(scene).growForTitles();

    expect(inner.bounds.y).toBeGreaterThan(sub.bounds.y + 22);
    expect(scene.place.notes[0]).toContain('of room below its new title');
  });

  it('takes overlaps apart around what was placed', async () => {
    const scene = await PlacementScene.of('add-after');
    const report = scene.shape('Activity_Report');
    const analyse = scene.shape('Activity_Analyse');
    const growth = growthOf(scene);
    report.bounds = new Box(analyse.bounds.x + 40, analyse.bounds.y, 100, 80);
    scene.run.active.add(report.id);

    growth.separateAll();

    expect(report.bounds.overlaps(analyse.bounds)).toBe(false);
    expect(scene.place.moved.size).toBeGreaterThan(0);
  });

  it('moves nothing when nothing changed', async () => {
    const scene = await PlacementScene.of('add-after');

    growthOf(scene).separateAll();

    expect(scene.place.moved.size).toBe(0);
  });

  it('grows a group a new node reaches over', async () => {
    const scene = await PlacementScene.drawn('models/incremental/groups.bpmn');
    const group = scene.shape('G1');
    const width = group.bounds.width;
    const task = scene.shape('A');
    task.bounds = new Box(group.bounds.right - 50, 100, 100, 80);
    scene.place.placed.add('A');

    growthOf(scene).growGroups();

    expect(group.bounds.width).toBeGreaterThan(width);
    expect(scene.place.moved.has('G1')).toBe(true);
  });

  it('leaves a group around a node well inside it, and a plane without groups', async () => {
    const scene = await PlacementScene.drawn('models/incremental/groups.bpmn');
    const plain = await PlacementScene.of('add-after');
    const group = scene.shape('G1');
    const width = group.bounds.width;
    scene.place.placed.add('A');
    plain.place.placed.add('Activity_Report');

    growthOf(scene).growGroups();
    growthOf(plain).growGroups();

    expect(group.bounds.width).toBe(width);
  });
});
