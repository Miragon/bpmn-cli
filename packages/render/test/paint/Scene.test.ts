import { describe, expect, it } from 'vitest';
import { Scene } from '../../src/paint/Scene.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('Scene', () => {
  const gallery = 'models/render/gallery.bpmn';

  it('draws every shape and flow of a plane', async () => {
    const plane = await CorpusModel.plane(gallery);
    const scene = new Scene(plane, undefined);
    expect(scene.drawnIds).toHaveLength(plane.shapes.size + plane.edges.size);
  });

  it('layers pools below lanes below tasks below flows below labels', async () => {
    const plane = await CorpusModel.plane('models/step1/lane-label.bpmn');
    const { items } = new Scene(plane, undefined);
    const layerOf = (mark: string): number => items.find((item) => item.svg.startsWith(mark))?.layer ?? -1;
    const pool = [...plane.shapes.values()].find((shape) => shape.kind === 'participant')!;
    const lane = [...plane.shapes.values()].find((shape) => shape.kind === 'lane')!;
    const flow = [...plane.edges.values()][0]!;
    expect(layerOf(`<g data-id="${pool.id}"`)).toBeLessThan(layerOf(`<g data-id="${lane.id}"`));
    expect(layerOf(`<g data-id="${lane.id}"`)).toBeLessThan(layerOf(`<g data-id="${flow.id}"`));
  });

  it('keeps a nested lane above its parent and a nested sub-process above the one around it', async () => {
    const plane = await CorpusModel.plane('models/step1/nested.bpmn');
    const subProcesses = [...plane.shapes.values()].filter((shape) => shape.expanded);
    const { items } = new Scene(plane, undefined);
    const layers = subProcesses.map((shape) => items.find((item) => item.svg.startsWith(`<g data-id="${shape.id}"`))?.layer ?? 0);
    expect(new Set(layers).size).toBeGreaterThan(1);
  });

  it('fades a flow with one end in the fit, fitted to a stub, and leaves out one with none', async () => {
    const plane = await CorpusModel.plane(gallery);
    const edge = [...plane.edges.values()].find((candidate) => candidate.kind === 'sequenceFlow' && candidate.sourceId && candidate.targetId)!;
    const scene = new Scene(plane, new Set([edge.sourceId!]));
    const faded = scene.items.filter((item) => item.svg.startsWith('<g data-faded'));
    expect(faded.some((item) => item.svg.includes(`data-faded="${edge.id}"`) && item.fitted)).toBe(true);
    expect(scene.drawnIds).toEqual([edge.sourceId]);
  });

  it('cuts the stub of a fit at the target end as well', async () => {
    const plane = await CorpusModel.plane(gallery);
    const edge = [...plane.edges.values()].find((candidate) => candidate.kind === 'sequenceFlow' && candidate.element.text('name'))!;
    const scene = new Scene(plane, new Set([edge.targetId!]));
    const label = scene.items.find((item) => item.context && item.svg.startsWith('<g opacity'));
    expect(label).toBeDefined();
  });

  it('shows the frames around a fit as context', async () => {
    const plane = await CorpusModel.plane(gallery);
    const scene = new Scene(plane, new Set(['Activity_InnerTask']));
    expect(scene.items.some((item) => item.context && item.svg.includes('data-context="Activity_ExpandedSubProcess"'))).toBe(true);
    expect(scene.items.some((item) => item.svg.includes('data-context="Participant_RenderGallery"'))).toBe(true);
  });

  it('skips an edge with fewer than two waypoints', async () => {
    const plane = await CorpusModel.plane('../packages/render/test/golden/fixtures/edges.bpmn');
    expect(new Scene(plane, undefined).drawnIds).not.toContain('Flow_Pointless');
  });
});
