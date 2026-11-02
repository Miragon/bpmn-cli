import { describe, expect, it } from 'vitest';
import { IncrementalRouting } from '../../../../src/drawing/incremental/run/IncrementalRouting.js';
import type { PlaneEdge } from '../../../../src/drawing/plane/PlaneEdge.js';
import type { EdgeBefore } from '../../../../src/drawing/incremental/routing/EdgeRouter.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('IncrementalRouting', () => {
  const routingOf = (scene: PlacementScene, before = new Map<PlaneEdge, EdgeBefore>()): IncrementalRouting => new IncrementalRouting(scene.run, before);
  const TASK = 'manualTask_fz2ArchiveContractShipNotifyDocument';

  it('routes the flows of a node a batch just placed and measures the spacing again', async () => {
    const scene = await PlacementScene.of('add-flow');
    scene.place.placeAt(scene.plane, TASK, 520, 120, { width: 100, height: 80 });

    routingOf(scene).routeNow(scene.plane, TASK);

    const [incoming] = [...scene.plane.edges.values()].filter((edge) => edge.targetId === TASK);
    const [outgoing] = [...scene.plane.edges.values()].filter((edge) => edge.sourceId === TASK);
    expect(incoming!.points.at(-1)!.x).toBe(520);
    expect(outgoing!.points.length).toBeGreaterThanOrEqual(2);
    expect(scene.run.newEdges.has(outgoing!.id)).toBe(true);
    expect(scene.run.newEdges.has(incoming!.id)).toBe(false);
    expect(scene.run.routedNow.has(incoming!.id)).toBe(true);
    expect(scene.place.spacing.has(scene.plane)).toBe(false);
  });

  it('skips an element without a shape', async () => {
    const scene = await PlacementScene.of('add-flow');

    routingOf(scene).routeNow(scene.plane, TASK);

    expect(scene.run.newEdges.size).toBe(0);
  });

  it('places the label of a named event when its flows are routed', async () => {
    const scene = await PlacementScene.of('add-after');
    const end = scene.shape('Event_End');
    end.el.set('name', 'Done');

    routingOf(scene).routeNow(scene.plane, 'Event_End');

    expect(end.label).toBeDefined();
  });

  it('routes again what the placement broke, not message flows', async () => {
    const scene = await PlacementScene.of('add-after');
    const flow = [...scene.plane.edges.values()].find((edge) => edge.sourceId === 'Activity_CollectData' && edge.targetId === 'Activity_Analyse')!;
    const before = new Map([[flow, scene.drawing().routes.edgeBefore(flow)]]);
    scene.shape('Activity_Analyse').bounds = new Box(336, 200, 100, 80);

    routingOf(scene, before).routeNow(scene.plane, 'Event_End');

    expect(scene.run.routedNow.has(flow.id)).toBe(true);
  });

  it('routes all collected connections and reports the kept ones', async () => {
    const scene = await PlacementScene.of('add-after');
    const flow = [...scene.plane.edges.values()][0]!;
    scene.run.reroute.add(flow.id);
    flow.points = [new Point(0, 0), new Point(1, 1)];

    expect(routingOf(scene).routeAll()).toEqual([flow.id]);
    expect(flow.points.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a new connection out of the report, and notes one with no shape at an end', async () => {
    const scene = await PlacementScene.of('add-flow');
    const flow = [...scene.plane.edges.values()][0]!;
    scene.run.reroute.add(flow.id);
    scene.run.newEdges.add(flow.id);
    flow.points = [];
    const undrawn = scene.plane.shapes.get(flow.sourceId!)!;
    scene.plane.shapes.delete(undrawn.id);

    const rerouted = routingOf(scene).routeAll();

    expect(rerouted).toEqual([]);
    expect(scene.plane.edges.has(flow.id)).toBe(false);
    expect(scene.place.notes[0]).toContain('not drawn: an end has no shape');
  });

  it('routes a kept association a new shape touches, once, and keeps the line when it still touches', async () => {
    const scene = await PlacementScene.of('move-lane');
    const note = [...scene.plane.edges.values()].find((edge) => edge.kind === 'association')!;
    const placed = 'Activity_Validate';
    scene.place.placed.add(placed);
    note.points = [note.points[0]!, new Point(900, 450), note.points.at(-1)!];

    routingOf(scene).routeGrazed();

    expect(scene.plane.edges.has(note.id)).toBe(true);
  });
});
