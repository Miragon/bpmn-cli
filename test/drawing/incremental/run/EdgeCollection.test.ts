import { describe, expect, it } from 'vitest';
import { EdgeCollection } from '../../../../src/drawing/incremental/run/EdgeCollection.js';
import type { PlaneEdge } from '../../../../src/drawing/plane/PlaneEdge.js';
import type { EdgeBefore } from '../../../../src/drawing/incremental/routing/EdgeRouter.js';
import { Plane } from '../../../../src/drawing/plane/Plane.js';
import { Point } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('EdgeCollection', () => {
  function collected(scene: PlacementScene): Set<string> {
    const before = new Map<PlaneEdge, EdgeBefore>([...scene.plane.edges.values()].map((edge) => [edge, scene.drawing().routes.edgeBefore(edge)]));
    new EdgeCollection(scene.run, scene.parts.before, before).collect();
    return scene.run.reroute;
  }

  it('routes nothing of a drawing nothing happened to', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');

    expect(collected(scene).size).toBe(0);
  });

  it('gives a connection without DI an edge and routes it', async () => {
    const scene = await PlacementScene.of('connect');

    const reroute = collected(scene);

    expect(scene.plane.edges.has('flow_collectDataToDataArchived')).toBe(true);
    expect(scene.run.newEdges.has('flow_collectDataToDataArchived')).toBe(true);
    expect(reroute.has('flow_collectDataToDataArchived')).toBe(true);
  });

  it('routes again a kept flow whose end changed, whichever flow the ends moved to', async () => {
    const scene = await PlacementScene.of('add-flow');
    const reEnded = [...scene.plane.edges.values()].find((edge) => edge.sourceId === 'C')!;

    const reroute = collected(scene);

    expect(reroute.has(reEnded.id)).toBe(true);
    expect(reEnded.targetId).toBe('manualTask_fz2ArchiveContractShipNotifyDocument');
  });

  it('routes a flow one of whose ends was placed', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    scene.place.placed.add('A');

    const reroute = collected(scene);

    expect([...reroute].length).toBe(2);
  });

  it('leaves a flow routed when its second end was placed unless it broke since', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const [held, broken] = [...scene.plane.edges.values()];
    scene.run.routedNow.set(held!.id, scene.drawing().routes.edgeBefore(held!));
    scene.run.routedNow.set(broken!.id, scene.drawing().routes.edgeBefore(broken!));
    broken!.points = [new Point(0, 0)];

    const reroute = collected(scene);

    expect(reroute.has(held!.id)).toBe(false);
    expect(reroute.has(broken!.id)).toBe(true);
  });

  it('leaves what came from the engine as it was drawn', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const [edge] = [...scene.plane.edges.values()];
    scene.run.fromEngine.add(edge!.id);
    scene.place.placed.add('A');

    expect(collected(scene).has(edge!.id)).toBe(false);
  });

  it('moves a connection drawn on the wrong plane to the plane of its ends', async () => {
    const scene = await PlacementScene.of('connect');
    const [first] = scene.place.planes;
    const elsewhere = new Plane('Elsewhere', 'Other', first!.root);
    scene.place.planes.unshift(elsewhere);
    const edge = [...first!.edges.values()].find(({ sourceId }) => sourceId === 'Event_RequestReceived')!;
    first!.edges.delete(edge.id);
    elsewhere.edges.set(edge.id, edge);

    const reroute = collected(scene);

    expect(first!.edges.has(edge.id)).toBe(true);
    expect(elsewhere.edges.has(edge.id)).toBe(false);
    expect(reroute.has(edge.id)).toBe(true);
  });
});
