import { describe, expect, it } from 'vitest';
import { BoundaryPlacer } from '../../../../src/drawing/incremental/placement/BoundaryPlacer.js';
import { RowChooser } from '../../../../src/drawing/incremental/placement/RowChooser.js';
import { ShapeSides } from '../../../../src/drawing/plane/ShapeSides.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('BoundaryPlacer', () => {
  const placerOf = (scene: PlacementScene): BoundaryPlacer => new BoundaryPlacer(scene.place, scene.obstacles, scene.rows);
  const search = { left: 0, size: { width: 100, height: 80 }, extent: 0, exclude: new Set<string>() };

  it('places a new boundary event on the bottom border of its host, and a task stays its size', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const host = scene.shape('manualTask_fz2ArchiveContractShipNotifyDocument');

    expect(placerOf(scene).placeBoundary(scene.plane, 'Event_Fzb3')).toBe(true);

    expect(ShapeSides.attached(scene.shape('Event_Fzb3').bounds, host.bounds)).toBe('bottom');
    expect(host.bounds).toMatchObject({ width: 100, height: 80 });
  });

  it('refuses when the host is not drawn', async () => {
    const scene = await PlacementScene.of('add-flow');

    expect(placerOf(scene).placeBoundary(scene.plane, 'S')).toBe(false);
  });

  it('makes room below for the flow out of the event', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const host = scene.shape('manualTask_fz2ArchiveContractShipNotifyDocument');
    const blocker = scene.shape('E2');
    blocker.bounds = new Box(host.bounds.x + 30, host.bounds.bottom + 20, 36, 36);

    placerOf(scene).placeBoundary(scene.plane, 'Event_Fzb3');

    expect(blocker.bounds.y).toBeGreaterThan(host.bounds.bottom + 20);
  });

  it('puts boundary events of a host drawn late back on its border', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const event = scene.shape('B');
    event.bounds = new Box(900, 400, 36, 36);

    placerOf(scene).reattachBoundaries(scene.plane, scene.shape('A'));

    const moved = scene.shape('B');
    expect(moved.bounds.y).toBeLessThan(400);
    expect(scene.place.moved.has('B')).toBe(true);
    expect(moved.planeElement).toBe(event.planeElement);
  });

  it('leaves an event on its border alone', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const event = scene.shape('B');

    placerOf(scene).reattachBoundaries(scene.plane, scene.shape('A'));

    expect(scene.shape('B')).toBe(event);
  });

  it('offers rows above the host for a path from a bottom event the CLI placed', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const placer = placerOf(scene);
    const host = scene.shape('manualTask_fz2ArchiveContractShipNotifyDocument');
    placer.placeBoundary(scene.plane, 'Event_Fzb3');
    const event = scene.shape('Event_Fzb3');

    const cands = placer.topCandidates(scene.plane, 'Activity_Fzbh3', scene.place.probeOf(scene.plane, 'Activity_Fzbh3'), event, host, undefined, search);

    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]!.penalty).toBeGreaterThanOrEqual(RowChooser.TOP_ROW);
    expect(cands[0]!.top?.y).toBe(host.bounds.y - 18);
  });

  it('keeps an event drawn by hand on its border, and one on the top border', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const placer = placerOf(scene);
    const host = scene.shape('A');
    const event = scene.shape('B');
    const probe = scene.place.probeOf(scene.plane, 'Activity_Fzbh3');
    const left = new Box(host.bounds.x - 18, host.bounds.bottom - 18, 36, 36);
    event.bounds = left;
    const byHand = placer.topCandidates(scene.plane, 'Activity_Fzbh3', probe, event, host, undefined, search);
    event.bounds = new Box(280, host.bounds.y - 18, 36, 36);

    expect(byHand).toEqual([]);
    expect(placer.topCandidates(scene.plane, 'Activity_Fzbh3', probe, event, host, undefined, search)).toEqual([]);
  });

  it('offers nothing above when the event already has a path', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const placer = placerOf(scene);
    const probe = scene.place.probeOf(scene.plane, 'Activity_Fzbh3');

    expect(placer.topCandidates(scene.plane, 'Activity_Fzbh3', probe, scene.shape('B'), scene.shape('A'), undefined, search)).toEqual([]);
  });

  it('moves an event to its spot on the top border and places its label again', async () => {
    const scene = await PlacementScene.of('add-boundary');
    const event = scene.shape('B');
    event.label = new Box(290, 180, 40, 14);
    const spot = new Box(300, 62, 36, 36);

    placerOf(scene).seatOnTop(scene.plane, event, spot);

    expect(event.bounds).toMatchObject({ x: 300, y: 62 });
    expect(scene.place.relabel.has('B')).toBe(true);
    expect(scene.place.moved.has('B')).toBe(true);
    expect(scene.place.notes[0]).toContain('moved to the top border of A');
  });
});
