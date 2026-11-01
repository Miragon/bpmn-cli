import { describe, expect, it } from 'vitest';
import { LaneBox } from '../../../../src/drawing/full/scopes/LaneBox.js';
import { Box } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('LaneBox', () => {
  const lane = (id: string, x: number): LaneBox => new LaneBox(ScopeSketch.element('bpmn:Lane', id), id, new Box(x, 0, 10, 10));

  it('measures how deep lanes nest, 0 without lanes', () => {
    const parent = lane('parent', 0);
    parent.children.push(lane('child', 30));

    expect(LaneBox.depthOf([parent, lane('other', 0)])).toBe(2);
    expect(LaneBox.depthOf([])).toBe(0);
  });

  it('stretches a lane and its children to one right edge', () => {
    const parent = lane('parent', 0);
    const child = lane('child', 30);
    parent.children.push(child);

    parent.stretch(500);

    expect([parent.box.width, child.box.right]).toEqual([500, 500]);
  });
});
