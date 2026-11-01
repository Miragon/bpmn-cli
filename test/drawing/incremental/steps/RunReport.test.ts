import { describe, expect, it } from 'vitest';
import { RunReport } from '../../../../src/drawing/incremental/steps/RunReport.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('RunReport', () => {
  const reportOf = (scene: PlacementScene): RunReport => new RunReport(scene.run, scene.parts.before);

  it('reports what was placed, moved and reshaped', async () => {
    const scene = await PlacementScene.of('add-after');
    const flow = [...scene.plane.edges.values()][0]!;
    const before = new Map([[flow, scene.drawing().routes.edgeBefore(flow)]]);
    flow.points = [new Point(0, 0), new Point(10, 0)];
    scene.place.placed.add('New');
    scene.shape('Activity_Report').bounds = new Box(600, 80, 100, 80);

    const report = reportOf(scene).of([], [], before);

    expect(report.placed).toEqual(['New']);
    expect(report.moved).toEqual(['Activity_Report']);
    expect(report.reshaped).toEqual([flow.id]);
  });

  it('counts a relocated node as moved, not as placed', async () => {
    const scene = await PlacementScene.of('add-after');
    scene.place.placed.add('Activity_Report');
    scene.run.relocated.add('Activity_Report');

    const { placed, moved } = reportOf(scene).of([], [], new Map());

    expect(placed).toEqual([]);
    expect(moved).toEqual(['Activity_Report']);
  });

  it('does not count a routed connection as reshaped', async () => {
    const scene = await PlacementScene.of('add-after');
    const flow = [...scene.plane.edges.values()][0]!;
    const before = new Map([[flow, scene.drawing().routes.edgeBefore(flow)]]);
    flow.points = [new Point(0, 0), new Point(10, 0)];

    expect(reportOf(scene).of([], [flow.id], before).reshaped).toEqual([]);
  });

  it('reports what left the document as pruned', async () => {
    const scene = await PlacementScene.of('remove-node');
    const { tree } = scene.parts.document;
    scene.parts.before.byDi.set(tree.build('bpmndi:BPMNShape', { id: 'Removed_di' }), { id: 'Removed', type: 'bpmn:Task', kind: 'task' });

    expect(reportOf(scene).of(['Pruned'], [], new Map()).pruned).toEqual(['Pruned', 'Removed']);
  });

  it('refuses what touches a vertical plane, and lets the rest pass', async () => {
    const scene = await PlacementScene.drawn('models/incremental/vertical.bpmn');
    const report = reportOf(scene);

    expect(() => report.assertHorizontal([])).not.toThrow();
    scene.place.moved.add('A');
    expect(() => report.assertHorizontal([])).toThrow(/pool Pool is drawn vertically/);
    scene.plane.shapes.delete('Pool');
    expect(() => report.assertHorizontal([])).toThrow(/lane L1 is drawn vertically/);
  });
});
