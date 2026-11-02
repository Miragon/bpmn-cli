import { describe, expect, it } from 'vitest';
import { NodePlacer } from '../../../../src/drawing/incremental/placement/NodePlacer.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('NodePlacer', () => {
  it('moves a node into its new lane at the same x, and the lane grows only when it must', async () => {
    const scene = await PlacementScene.of('move-lane');
    const placer = new NodePlacer(scene.place);
    const event = scene.shape('Event_Fixed');
    const lane = scene.shape('Lane_Agent');
    event.laneId = lane.id;
    const { x } = event.bounds;

    expect(placer.changeLane(scene.plane, 'Event_Fixed')).toBe(true);

    expect(event.bounds.x).toBe(x);
    expect(event.bounds.isInside(lane.bounds)).toBe(true);
    expect(scene.place.moved.has('Event_Fixed')).toBe(true);
  });

  it('leaves a node already in its lane, one without a lane and an unknown one', async () => {
    const scene = await PlacementScene.of('add-annotation');
    const placer = new NodePlacer(scene.place);
    const noLane = await PlacementScene.of('add-after');

    expect(placer.changeLane(scene.plane, 'Activity_Draft')).toBe(false);
    expect(placer.changeLane(scene.plane, 'Unknown')).toBe(false);
    expect(new NodePlacer(noLane.place).changeLane(noLane.plane, 'Activity_Report')).toBe(false);
  });

  it('places what connects first and returns what has no plane', async () => {
    const scene = await PlacementScene.of('add-boundary');
    scene.place.hooks.planeFor = (id) => (id === 'Activity_Fzbh3' ? undefined : scene.plane);

    const skipped = new NodePlacer(scene.place).placeFlowNodes(['Activity_Fzbh3', 'Event_Fzb3']);

    expect(skipped).toEqual(['Activity_Fzbh3']);
    expect(scene.plane.shapes.has('Event_Fzb3')).toBe(true);
  });

  it('places a boundary event after its host, its exception path after the normal flow', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const order: string[] = [];
    scene.place.hooks.afterNode = (_, id) => order.push(id);
    scene.plane.shapes.delete('D');

    new NodePlacer(scene.place).placeFlowNodes(['Activity_Fzbh3', 'Event_Fzb3', 'D']);

    expect(order).toEqual(['D', 'Event_Fzb3']);
  });

  it('drops a node drawn in the meantime', async () => {
    const scene = await PlacementScene.of('add-boundary');

    expect(new NodePlacer(scene.place).placeFlowNodes(['A'])).toEqual([]);
    expect(scene.place.placed.size).toBe(0);
  });

  it('places a join again right of its rightmost predecessor when a flow would enter it backwards', async () => {
    const scene = await PlacementScene.of('split');
    const created = scene.parts.changes.created.map(({ id }) => id).filter((id) => scene.place.semantics.byId.get(id)?.is('bpmn:FlowNode'));

    new NodePlacer(scene.place).placeFlowNodes(created);

    const join = scene.shape('gateway_fz8SplitJoin');
    const preds = scene.place.semantics.predecessors(join.id).map((id) => scene.shape(id));
    expect(preds.every((pred) => pred.bounds.right < join.bounds.center.x)).toBe(true);
  });

  it('pushes a drawn target right of a source that enters it backwards', async () => {
    const scene = await PlacementScene.of('connect');
    const placer = new NodePlacer(scene.place);
    const target = scene.shape('Activity_PrepareOffer');
    target.bounds = new Box(0, 160, 100, 80);

    expect(placer.pushBehind(scene.plane, scene.shape('Activity_CollectData'), target)).toBe(true);
  });
});
