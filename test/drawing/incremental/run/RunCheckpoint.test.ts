import { describe, expect, it } from 'vitest';
import { RunCheckpoint } from '../../../../src/drawing/incremental/run/RunCheckpoint.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('RunCheckpoint', () => {
  it('undoes what a trial changed: shapes, edges, planes, sets and notes', async () => {
    const scene = await PlacementScene.of('add-after');
    const { run, plane } = scene;
    const checkpoints = new RunCheckpoint(run);
    const report = scene.shape('Activity_Report');
    const box = report.bounds.copy();
    const checkpoint = checkpoints.take();

    report.bounds = new Box(0, 0, 1, 1);
    plane.shapes.delete('Event_End');
    plane.edges.clear();
    run.planes.push(plane);
    run.newEdges.add('Flow');
    run.notes.push('tried');
    run.place.placed.add('X');
    checkpoints.restore(checkpoint);

    expect(report.bounds).toEqual(box);
    expect(plane.shapes.has('Event_End')).toBe(true);
    expect(plane.edges.size).toBeGreaterThan(0);
    expect(run.planes).toEqual([plane]);
    expect(run.newEdges.size).toBe(0);
    expect(run.notes).toEqual([]);
    expect(run.place.placed.size).toBe(0);
  });

  it('keeps a node waiting to be placed again with its boundary events and content', async () => {
    const scene = await PlacementScene.drawn('models/incremental/sub.bpmn');
    const { run, plane } = scene;
    const shape = scene.shape('SP');
    const content = plane.contentOf('SP');
    run.place.reuse.set('SP', { shape, boundaries: [], from: plane, content });
    plane.shapes.delete('SP');
    const checkpoints = new RunCheckpoint(run);
    const checkpoint = checkpoints.take();
    const { x } = shape.bounds;
    const [point] = content.edges[0]!.points;
    const startX = point!.x;

    shape.bounds.x += 50;
    content.edges[0]!.translate(50, 0);
    checkpoints.restore(checkpoint);

    expect(shape.bounds.x).toBe(x);
    expect(content.edges[0]!.points[0]!.x).toBe(startX);
  });
});
