import { describe, expect, it } from 'vitest';
import { LabelRefresh } from '../../../../src/drawing/incremental/run/LabelRefresh.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('LabelRefresh', () => {
  const refreshOf = (scene: PlacementScene): LabelRefresh => new LabelRefresh(scene.run, scene.parts.before);

  it('places the label of a new event', async () => {
    const scene = await PlacementScene.of('add-after');
    const end = scene.shape('Event_End');
    end.el.set('name', 'Done');
    scene.place.placed.add(end.id);

    refreshOf(scene).labels(new Set());

    expect(end.label?.y).toBeGreaterThan(end.bounds.y);
  });

  it('moves a kept label off a new line', async () => {
    const scene = await PlacementScene.of('add-after');
    const end = scene.shape('Event_End');
    end.label = new Box(end.bounds.x, end.bounds.y - 100, 40, 14);
    const [flow] = scene.plane.edges.values();
    flow!.points = [new Point(end.bounds.x - 50, end.bounds.y - 93), new Point(end.bounds.x + 100, end.bounds.y - 93)];

    refreshOf(scene).labels(new Set([flow!.id]));

    expect(scene.place.notes).toContain('label of Event_End moved off a new line');
  });

  it('fits the label of a renamed event and a renamed flow, leaves engine drawings alone', async () => {
    const scene = await PlacementScene.of('add-after');
    const end = scene.shape('Event_End');
    const flow = [...scene.plane.edges.values()][0]!;
    end.label = new Box(end.bounds.x, end.bounds.bottom + 6, 36, 14);
    flow.label = new Box(flow.points[0]!.x, flow.points[0]!.y + 4, 20, 14);
    const before = flow.label.copy();
    end.el.set('name', 'A much longer name of the end event of this process');
    flow.el.set('name', 'A much longer name of this flow');
    scene.run.fromEngine.add(flow.id);

    refreshOf(scene).labels(new Set());

    expect(end.label.width).toBeGreaterThan(36);
    expect(flow.label).toEqual(before);
  });

  it('takes a label off the title of a sub-process it was clear of', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const event = scene.shape('SS');
    const sub = scene.shape('SP');
    sub.el.set('name', 'Title');
    event.el.set('name', 'Go');
    scene.parts.before.names.set('SS', 'Go');
    event.label = new Box(sub.bounds.x + 5, sub.bounds.y + 6, 200, 14);

    refreshOf(scene).labels(new Set());

    expect(scene.place.notes).toContain('label of SS moved off the name of SP');
  });
});
