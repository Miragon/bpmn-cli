import { describe, expect, it } from 'vitest';
import { ScopeFrame } from '../../../../src/drawing/full/scopes/ScopeFrame.js';
import { ShapeSizes } from '../../../../src/drawing/plane/ShapeSizes.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('ScopeFrame', () => {
  it('counts a label reaching past the content', () => {
    const sketch = new ScopeSketch().node('end', 'e', 0, 0, { name: 'An end event with a really rather long name to read' });

    const { width, left } = new ScopeFrame(sketch.layout()).framedSize();

    expect(width).toBeGreaterThan(36);
    expect(left).toBeGreaterThan(0);
  });

  it('never makes a sub-process smaller than the minimum', () => {
    const parent = new ScopeSketch().node('subProcess', 'sub', 0, 0).at('sub');

    new ScopeFrame(new ScopeSketch().node('task', 'a', 0, 0).layout()).fitSubProcess(parent);

    expect(parent.width).toBeGreaterThanOrEqual(ShapeSizes.SUB_PROCESS_MIN.width);
    expect(parent.childPad?.top).toBeGreaterThanOrEqual(ShapeSizes.SUB_PROCESS_PADDING.top);
  });
});
