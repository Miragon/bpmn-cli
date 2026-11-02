import { describe, expect, it } from 'vitest';
import { FullLayout } from '../../../../src/drawing/full/FullLayout.js';
import { BlockAdopter } from '../../../../src/drawing/incremental/steps/BlockAdopter.js';
import { ContainerPlacer } from '../../../../src/drawing/incremental/steps/ContainerPlacer.js';
import { DrawingPair } from '../../../support/DrawingPair.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('ContainerPlacer', () => {
  const placerOf = (scene: PlacementScene): ContainerPlacer => new ContainerPlacer(scene.run, scene.parts.before, new BlockAdopter(scene.run), () => FullLayout.engineDrawing(scene.parts.document, scene.parts.changes.expansions));
  const noChanges = { created: [], changed: [], removed: [], relocated: [], expand: [], collapse: [], renamed: [] };

  function collaborationAdded(xml: string): string {
    return xml.replace(/<bpmn:process id="([^"]+)"/, '<bpmn:collaboration id="NewCollaboration"><bpmn:participant id="NewPool" name="Pool" processRef="$1"/></bpmn:collaboration><bpmn:process id="$1"');
  }

  it('follows a collaboration that now wraps the process and hands its pool to the shapes', async () => {
    const xml = Fixtures.text('drawing/placement/join-backwards.before.bpmn');
    const parts = await DrawingPair.of(xml, collaborationAdded(xml), noChanges);
    const scene = new PlacementScene(parts);

    const wrapped = placerOf(scene).followRoot();

    expect(wrapped).toBe('NewPool');
    expect(scene.plane.rootId).toBe('NewCollaboration');
    expect(scene.shape('Split').poolId).toBe('NewPool');
  });

  it('keeps a root that stayed', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');

    expect(placerOf(scene).followRoot()).toBeUndefined();
  });

  it('keeps the drawing when the old root has no plane any more', async () => {
    const xml = Fixtures.text('drawing/placement/join-backwards.before.bpmn');
    const scene = new PlacementScene(await DrawingPair.of(xml, collaborationAdded(xml), noChanges));
    scene.parts.before.rootId = 'Gone';

    expect(placerOf(scene).followRoot()).toBeUndefined();
  });

  it('draws a new lane in its pool', async () => {
    const xml = Fixtures.text('models/incremental/pool.bpmn');
    const added = xml.replace('<bpmn:startEvent id="S"', '<bpmn:laneSet id="LS"><bpmn:lane id="NewLane" name="Lane"><bpmn:flowNodeRef>S</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet><bpmn:startEvent id="S"');
    const scene = new PlacementScene(await DrawingPair.of(xml, added, noChanges));

    await placerOf(scene).placeContainers(undefined);

    expect(scene.place.placed.has('NewLane')).toBe(true);
  });

  it('notes a lane whose process has no pool', async () => {
    const xml = Fixtures.text('drawing/placement/join-backwards.before.bpmn');
    const added = xml.replace('<bpmn:startEvent id="Start"', '<bpmn:laneSet id="LS"><bpmn:lane id="NewLane" name="Lane"/></bpmn:laneSet><bpmn:startEvent id="Start"');
    const scene = new PlacementScene(await DrawingPair.of(xml, added, noChanges));

    await placerOf(scene).placeContainers(undefined);

    expect(scene.place.placed.has('NewLane')).toBe(false);
    expect(scene.place.notes[0]).toContain('lane NewLane not drawn');
  });

  it('draws a new pool below the others with what the engine drew for its process', async () => {
    const xml = Fixtures.text('models/incremental/pool.bpmn');
    const process = '<bpmn:process id="P2"><bpmn:startEvent id="S2"/></bpmn:process>';
    const added = xml.replace('</bpmn:collaboration>', '<bpmn:participant id="Pool2" name="Other" processRef="P2"/></bpmn:collaboration>').replace('</bpmn:process>', `</bpmn:process>${process}`);
    const scene = new PlacementScene(await DrawingPair.of(xml, added, noChanges));

    await placerOf(scene).placeContainers(undefined);

    expect(scene.shape('Pool2').bounds.y).toBeGreaterThanOrEqual(scene.shape('Pool').bounds.bottom);
    expect(scene.shape('S2').bounds.isInside(scene.shape('Pool2').bounds)).toBe(true);
    expect(scene.run.fromEngine.has('S2')).toBe(true);
  });

  it('draws a black box pool without a process', async () => {
    const xml = Fixtures.text('models/incremental/pool.bpmn');
    const added = xml.replace('</bpmn:collaboration>', '<bpmn:participant id="Box" name="Other"/></bpmn:collaboration>');
    const scene = new PlacementScene(await DrawingPair.of(xml, added, noChanges));

    await placerOf(scene).placeContainers(undefined);

    expect(scene.shape('Box').bounds.height).toBe(60);
  });

  it('opens a plane for the content of a sub-process that is new and collapsed, none outside one', async () => {
    const pair = await DrawingPair.read('add-subprocess');
    pair.changes.expansions.expand('Activity_Fzs3', false);
    const scene = new PlacementScene(pair);
    const placer = placerOf(scene);
    const expanded = placerOf(await PlacementScene.of('add-subprocess'));

    expect(expanded.planeFor('Activity_Fzs3i')).toBeUndefined();
    expect(placer.planeFor('Activity_Fzs3i')?.rootId).toBe('Activity_Fzs3');
    scene.place.planes.length = 0;
    expect(placer.planeFor('A')).toBeUndefined();
  });

  it('opens a plane for the content of a collapsed sub-process, none for a drawn expanded one', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const placer = placerOf(scene);
    scene.place.hooks.planeFor = () => undefined;
    scene.place.planes.forEach((plane) => plane.shapes.delete('SS'));

    expect(placer.planeFor('ST')).toBe(scene.plane);
    expect(placer.planeFor('Unknown')).toBeUndefined();
    scene.shape('SP').expanded = false;
    expect(placer.planeFor('SS')?.rootId).toBe('SP');
  });
});
