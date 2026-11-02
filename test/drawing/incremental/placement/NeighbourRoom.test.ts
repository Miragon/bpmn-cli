import { describe, expect, it } from 'vitest';
import { NeighbourRoom } from '../../../../src/drawing/incremental/placement/NeighbourRoom.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('NeighbourRoom', () => {
  const roomOf = (scene: PlacementScene): NeighbourRoom => new NeighbourRoom(scene.place, scene.obstacles);

  it('makes room right of a line along what follows, the rest of the drawing stays', async () => {
    const scene = await PlacementScene.drawn('models/incremental/groups.bpmn');
    const a = scene.shape('A');
    const x = scene.shape('B').bounds.x;
    const successor = scene.shape('E1');
    const left = successor.bounds.x;

    roomOf(scene).push(scene.plane, a, a, { line: a.bounds.right + 1, delta: 60, successor });

    expect(successor.bounds.x).toBe(left + 60);
    expect(scene.shape('B').bounds.x).toBe(x);
    expect(scene.place.moved.has('E1')).toBe(true);
  });

  it('grows the sub-process around a push inside it', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const task = scene.shape('ST');
    const width = scene.shape('SP').bounds.width;

    roomOf(scene).push(scene.plane, task, task, { line: task.bounds.right + 1, delta: 200, successor: scene.shape('SE'), fixed: new Set(['SS']) });

    expect(scene.shape('SP').bounds.width).toBeGreaterThan(width);
  });

  it('moves a target entered backwards right of its source, one gap away', async () => {
    const scene = await PlacementScene.of('connect');
    const source = scene.shape('Activity_CollectData');
    const target = scene.shape('Activity_PrepareOffer');
    target.bounds = new Box(0, 160, 100, 80);

    expect(roomOf(scene).pushBehind(scene.plane, source, target)).toBe(true);

    expect(target.bounds.x).toBeGreaterThan(source.bounds.right);
  });

  it('leaves a loop return and a forward flow alone', async () => {
    const scene = await PlacementScene.of('add-branch');
    const room = roomOf(scene);

    expect(room.pushBehind(scene.plane, scene.shape('Gateway_Outer'), scene.shape('Activity_A'))).toBe(false);
    expect(room.pushBehind(scene.plane, scene.shape('Activity_A'), scene.shape('Activity_C'))).toBe(false);
  });

  it('leaves a target that leads to the source along its boundary event', async () => {
    const scene = await PlacementScene.of('add-boundary');

    expect(roomOf(scene).pushBehind(scene.plane, scene.shape('E2'), scene.shape('A'))).toBe(false);
  });

  it('asks only for the room that is missing', async () => {
    const scene = await PlacementScene.of('add-after');
    const successor = scene.shape('Gateway_Sufficient');
    const box = new Box(616, 80, 100, 80);

    const need = roomOf(scene).localShift(scene.plane, box, 610, { boxes: [successor.bounds], labels: [] }, successor, 60);

    expect(need).toBe(box.right + 60 - successor.bounds.x);
  });

  it('gives up on what lies in the way before the line, a label and a bend included', async () => {
    const scene = await PlacementScene.of('add-after');
    const box = new Box(100, 80, 100, 80);
    const room = roomOf(scene);

    expect(room.localShift(scene.plane, box, 500, { boxes: [new Box(150, 80, 100, 80)], labels: [] }, undefined, 60)).toBeUndefined();
    expect(room.localShift(scene.plane, box, 500, { boxes: [], labels: [new Box(150, 80, 40, 14)] }, undefined, 60)).toBeUndefined();
    expect(room.localShift(scene.plane, box, 0, { boxes: [], labels: [] }, undefined, 60)).toBe(0);
  });

  it('measures how far a label reaches beyond its shape', async () => {
    const scene = await PlacementScene.of('add-after');
    const end = scene.shape('Event_End');
    end.label = new Box(end.bounds.x - 7, end.bounds.bottom + 6, 50, 14);

    expect(roomOf(scene).reachOf(end)).toEqual({ side: 'below', left: 7, right: 7 });
    end.label = new Box(end.bounds.right + 6, end.bounds.y, 50, 14);
    expect(roomOf(scene).reachOf(end)).toBeUndefined();
    end.label = undefined;
    expect(roomOf(scene).reachOf(end)).toBeUndefined();
  });

  it('knows the reach of the label a new gateway gets, none for a task or a boundary event', async () => {
    const gateway = await PlacementScene.of('split');
    gateway.place.semantics.byId.get('gateway_fz8Split')!.set('name', 'A rather long question for a gateway?');
    const boundary = await PlacementScene.of('add-boundary');

    expect(roomOf(gateway).newReach('gateway_fz8Split', { width: 50, height: 50 })).toMatchObject({ side: 'above' });
    expect(roomOf(gateway).newReach('task_fz8B0N0', { width: 100, height: 80 })).toBeUndefined();
    expect(roomOf(boundary).newReach('Event_Fzb3', { width: 36, height: 36 })).toBeUndefined();
    expect(roomOf(boundary).newReach('Unknown', { width: 36, height: 36 })).toBeUndefined();
  });

  it('keeps labels of neighbours on one side apart', async () => {
    const scene = await PlacementScene.of('add-after');
    const room = roomOf(scene);

    expect(room.labelRoom({ side: 'above', left: 0, right: 10 }, { side: 'above', left: 6, right: 0 })).toBe(20);
    expect(room.labelRoom({ side: 'above', left: 0, right: 10 }, { side: 'below', left: 6, right: 0 })).toBe(0);
    expect(room.labelRoom(undefined, { side: 'below', left: 6, right: 0 })).toBe(0);
  });
});
