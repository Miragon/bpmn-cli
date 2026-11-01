import { describe, expect, it } from 'vitest';
import { TakenColumns } from '../../../../src/drawing/full/trials/TakenColumns.js';
import { Box } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('TakenColumns', () => {
  const rising = (): ScopeSketch => new ScopeSketch().node('task', 'a', 0, 0).node('gateway', 'join', 200, 0).node('task', 'blocker', 200, 150).node('task', 'low', 0, 300).flow('a', 'join').flow('low', 'join');

  it('names what lies in the column under a node entered from below', () => {
    const sketch = rising();

    expect(new TakenColumns(sketch.layout()).of().get(sketch.at('join'))).toContain(sketch.at('blocker'));
  });

  it('leaves out entries drawn over the top', () => {
    const sketch = rising();

    expect(new TakenColumns(sketch.layout()).of(new Set([sketch.edge('low', 'join')])).size).toBe(0);
  });

  it('answers nothing when no flow rises, and counts data in the way', () => {
    const flat = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 200, 0).flow('a', 'b');
    const sketch = rising();
    const layout = sketch.layout();
    const data = ScopeSketch.artifact('bpmn:DataObjectReference', 'data', 'dataObject', { width: 36, height: 50 }, 'data');
    data.box = new Box(sketch.at('join').riseX() - 18, 100, 36, 50);
    data.anchorNode = sketch.at('a');
    layout.artifacts.push(data);

    expect(new TakenColumns(flat.layout()).of().size).toBe(0);
    expect(new TakenColumns(layout).of().get(sketch.at('join'))).toContain(sketch.at('a'));
  });
});
