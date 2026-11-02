import { describe, expect, it } from 'vitest';
import { DrawingCheckpoint } from '../../../src/drawing/plane/DrawingCheckpoint.js';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { Box, Point } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DrawingCheckpoint', () => {
  async function planeOf() {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  it('restores bounds, waypoints and labels, more than once', async () => {
    const plane = await planeOf();
    const checkpoint = new DrawingCheckpoint(plane);
    const shape = plane.shapes.get('A')!;
    const edge = plane.edges.get('F1')!;
    const startX = shape.bounds.x;

    for (const run of [1, 2]) {
      shape.bounds.translate(500 * run, 0);
      shape.label = new Box(0, 0, 10, 10);
      edge.points = [new Point(0, 0)];
      edge.label = new Box(0, 0, 10, 10);
      edge.targetId = 'other';

      checkpoint.restore();

      expect(shape.bounds.x).toBe(startX);
      expect(shape.label).toBeUndefined();
      expect(edge.points.length).toBeGreaterThan(1);
      expect(edge.label).toBeUndefined();
      expect(edge.targetId).toBe('A');
    }
  });

  it('keeps the first state of a shape', async () => {
    const plane = await planeOf();
    const checkpoint = new DrawingCheckpoint();
    const shape = plane.shapes.get('A')!;
    const edge = plane.edges.get('F1')!;
    const startX = shape.bounds.x;
    checkpoint.keepShape(shape);
    checkpoint.keepEdge(edge);

    shape.bounds.translate(50, 0);
    checkpoint.keepShape(shape);
    checkpoint.keepEdge(edge);

    expect(checkpoint.boundsOf(shape).x).toBe(startX);
  });
});
