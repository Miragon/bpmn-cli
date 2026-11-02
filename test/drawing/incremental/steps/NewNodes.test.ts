import { describe, expect, it } from 'vitest';
import { FullLayout } from '../../../../src/drawing/full/FullLayout.js';
import { BlockAdopter } from '../../../../src/drawing/incremental/steps/BlockAdopter.js';
import { NewNodes } from '../../../../src/drawing/incremental/steps/NewNodes.js';
import { ModelOrder } from '../../../../src/drawing/incremental/run/ModelOrder.js';
import { DrawingPair } from '../../../support/DrawingPair.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('NewNodes', () => {
  function nodesOf(scene: PlacementScene): NewNodes {
    const { document, changes } = scene.parts;
    return new NewNodes(scene.run, new ModelOrder(document.tree.definitions), changes.created.map(({ id }) => id), new BlockAdopter(scene.run), () => FullLayout.engineDrawing(document, changes.expansions));
  }

  it('draws a new sub-process with the content the engine laid out as one block', async () => {
    const scene = await PlacementScene.of('add-subprocess');

    await nodesOf(scene).place(() => undefined);

    expect(scene.shape('Activity_Fzs3').bounds.width).toBeGreaterThan(100);
    expect(scene.shape('Activity_Fzs3i').bounds.isInside(scene.shape('Activity_Fzs3').bounds)).toBe(true);
    expect(scene.run.fromEngine.has('Activity_Fzs3i')).toBe(true);
  });

  it('adopts the content of a new collapsed sub-process on a plane of its own', async () => {
    const pair = await DrawingPair.read('add-subprocess');
    pair.changes.expansions.expand('Activity_Fzs3', false);
    const scene = new PlacementScene(pair);
    scene.place.hooks.planeFor = (id) => scene.place.semantics.homePlane(scene.place.planes, id);

    await nodesOf(scene).place(() => undefined);

    expect(scene.place.planes.find(({ rootId }) => rootId === 'Activity_Fzs3')?.shapes.has('Activity_Fzs3i')).toBe(true);
    expect(scene.shape('Activity_Fzs3').bounds.width).toBe(100);
  });

  it('calls back after each node a batch places but the last', async () => {
    const scene = await PlacementScene.of('split');
    const placed: string[] = [];

    await nodesOf(scene).place((_, id) => placed.push(id));

    expect(placed.length).toBeGreaterThan(1);
    expect(scene.place.hooks.afterNode).toBeUndefined();
    expect(scene.place.hooks.afterPlace).toBeUndefined();
  });

  it('places new artifacts after the nodes', async () => {
    const scene = await PlacementScene.of('add-annotation');

    await nodesOf(scene).place(() => undefined);

    expect(scene.plane.shapes.has('TextAnnotation_Fzt0')).toBe(true);
  });

  it('notes what belongs to no diagram', async () => {
    const scene = await PlacementScene.of('add-annotation');
    scene.place.hooks.planeFor = () => undefined;

    await nodesOf(scene).place(() => undefined);

    expect(scene.place.notes).toContain('TextAnnotation_Fzt0 not drawn: it belongs to no diagram');
  });
});
