import { describe, expect, it } from 'vitest';
import { PlaneShape } from '../../../src/drawing/plane/PlaneShape.js';
import { Box } from '../../support/ModelValues.js';
import { ScopeSketch } from '../../support/ScopeSketch.js';

describe('PlaneShape', () => {
  const shape = (kind: PlaneShape['kind'], bounds = new Box(100, 100, 36, 36), container = false): PlaneShape => new PlaneShape('shape', ScopeSketch.element('bpmn:Task', 'shape'), bounds, kind, container);
  const size = { width: 40, height: 14 };

  it('counts a shape as a leaf unless it is a container or a group', () => {
    expect([shape('task').isLeaf, shape('group').isLeaf, shape('lane', undefined, true).isLeaf]).toEqual([true, false, false]);
  });

  it('names a frame in words', () => {
    expect(['participant', 'lane', 'subProcess'].map((kind) => shape(kind as PlaneShape['kind']).frameWord)).toEqual(['pool', 'lane', 'sub-process']);
  });

  it('moves its label along', () => {
    const moved = shape('event');
    moved.label = new Box(100, 150, 40, 14);

    moved.translate(10, 20);

    expect([moved.bounds.x, moved.label.y]).toEqual([110, 170]);
  });

  it('draws events and data with an external label, below by default, gateways above', () => {
    expect(['event', 'boundary', 'gateway', 'data', 'task'].map((kind) => PlaneShape.hasExternalLabel(kind as PlaneShape['kind']))).toEqual([true, true, true, true, false]);
    expect(PlaneShape.defaultLabelSide('gateway')).toBe('above');
    expect(PlaneShape.defaultLabelSide('event')).toBe('below');
    expect(PlaneShape.defaultLabelSide('task')).toBe('below');
  });

  it('places a label on each side', () => {
    const event = shape('event');

    expect(event.labelAt(size, 'below')).toMatchObject({ x: 98, y: 142 });
    expect(event.labelAt(size, 'above')).toMatchObject({ x: 98, y: 80 });
    expect(event.labelAt(size, 'right')).toMatchObject({ x: 142, y: 111 });
    expect(event.labelAt(size, 'left')).toMatchObject({ x: 54, y: 111 });
    expect(event.labelAt(size, 'below', undefined, 1).y).toBe(160);
  });

  it('hangs the label of a boundary event below its host, right of the event', () => {
    const event = shape('boundary', new Box(100, 162, 36, 36));
    const host = shape('task', new Box(50, 100, 100, 80));

    expect(event.labelAt(size, 'below', host)).toMatchObject({ x: 140, y: 182 });
  });

  it('tells on which side a label sits', () => {
    const labelled = shape('event');
    const sideOf = (label: Box | undefined, host?: Box): string | undefined => {
      labelled.label = label;
      return labelled.labelSide(host);
    };

    expect(sideOf(undefined)).toBeUndefined();
    expect(sideOf(new Box(100, 140, 40, 14))).toBe('below');
    expect(sideOf(new Box(100, 80, 40, 14))).toBe('above');
    expect(sideOf(new Box(140, 110, 40, 14))).toBe('right');
    expect(sideOf(new Box(50, 110, 40, 14))).toBe('left');
    expect(sideOf(new Box(105, 105, 10, 10))).toBe('inside');
  });

  it("counts a boundary event's label below its host as below", () => {
    const event = shape('boundary', new Box(100, 100, 36, 36));
    event.label = new Box(140, 125, 40, 14);

    expect(event.labelSide(new Box(50, 40, 100, 80))).toBe('below');
  });
});
