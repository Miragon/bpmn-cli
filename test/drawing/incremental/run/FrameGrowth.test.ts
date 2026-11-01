import { describe, expect, it } from 'vitest';
import { FrameGrowth } from '../../../../src/drawing/incremental/run/FrameGrowth.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('FrameGrowth', () => {
  const growthOf = (scene: PlacementScene): FrameGrowth => new FrameGrowth(scene.run, scene.parts.before, new Map([...scene.plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()])));
  const LONG_NAME = 'An activity with a name that takes more lines than the hundred pixels of its shape can show';

  it('grows an activity that does not fit its new name, wider first, and makes room on its row', async () => {
    const scene = await PlacementScene.of('rename');
    const task = scene.shape('Activity_Evaluate');
    const next = scene.shape('Activity_StandardTrack');
    const nextX = next.bounds.x;
    task.el.set('name', LONG_NAME);

    growthOf(scene).growForNames();

    expect(task.bounds.width).toBeGreaterThan(100);
    expect(next.bounds.x).toBeGreaterThanOrEqual(nextX);
    expect(next.bounds.x).toBeGreaterThanOrEqual(task.bounds.right + 40);
    expect(scene.run.grown.has(task.id)).toBe(true);
    expect(scene.place.notes[0]).toContain('to fit its name');
  });

  it('leaves an activity whose name fits, and one the engine drew', async () => {
    const scene = await PlacementScene.of('rename');
    const engine = scene.shape('Activity_Review');
    engine.el.set('name', LONG_NAME);
    scene.run.fromEngine.add(engine.id);

    growthOf(scene).growForNames();

    expect(engine.bounds.width).toBe(100);
    expect(scene.shape('Activity_Evaluate').bounds.width).toBe(100);
  });

  it('keeps a grown activity under its frame title and inside its pool', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const task = scene.shape('ST');
    task.el.set('name', `${LONG_NAME} ${LONG_NAME} ${LONG_NAME}`);

    growthOf(scene).growForNames();

    expect(task.bounds.isInside(scene.shape('SP').bounds)).toBe(true);
  });

  it('makes room below a longer title of a sub-process', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const sub = scene.shape('SP');
    const inner = scene.shape('ST');
    inner.bounds = new Box(inner.bounds.x, sub.bounds.y + 22, 100, 80);
    sub.el.set('name', `${LONG_NAME} ${LONG_NAME} ${LONG_NAME} ${LONG_NAME} ${LONG_NAME} ${LONG_NAME}`);

    growthOf(scene).growForNames();

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
