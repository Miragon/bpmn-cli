import { describe, expect, it } from 'vitest';
import { NodePlacer } from '../../../../src/drawing/incremental/placement/NodePlacer.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('ArtifactPlacer', () => {
  it('places a text annotation above and right of what it notes', async () => {
    const scene = await PlacementScene.of('add-annotation');
    const anchor = scene.shape('Activity_AutoFix');

    new NodePlacer(scene.place).placeArtifact('TextAnnotation_Fzt0');

    const note = scene.shape('TextAnnotation_Fzt0');
    expect(note.bounds.bottom).toBeLessThanOrEqual(anchor.bounds.y);
    expect(note.bounds.x).toBeGreaterThan(anchor.bounds.center.x);
  });

  it('places a data store below and right of the task that reads it, at its size', async () => {
    const scene = await PlacementScene.of('add-data');
    const anchor = scene.shape('Activity_Analyse');

    new NodePlacer(scene.place).placeArtifact('DataObjectReference_Fzd6');

    const store = scene.shape('DataObjectReference_Fzd6');
    expect(store.bounds).toMatchObject({ width: 50, height: 50 });
    expect(store.bounds.y).toBeGreaterThan(anchor.bounds.bottom);
  });

  it('places an artifact without an anchor below the content', async () => {
    const scene = await PlacementScene.of('add-annotation');
    const note = 'TextAnnotation_Fzt0';
    scene.plane.shapes.delete('Activity_AutoFix');

    new NodePlacer(scene.place).placeArtifact(note);

    expect(scene.plane.shapes.has(note)).toBe(true);
  });

  it('finds no plane for an element of no diagram', async () => {
    const scene = await PlacementScene.of('add-annotation');
    scene.place.hooks.planeFor = () => undefined;

    expect(new NodePlacer(scene.place).placeArtifact('TextAnnotation_Fzt0')).toBe(false);
  });
});
