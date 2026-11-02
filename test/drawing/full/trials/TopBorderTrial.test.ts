import { describe, expect, it } from 'vitest';
import { ScopeGraph } from '../../../../src/drawing/full/scopes/ScopeGraph.js';
import { ScopeGrid } from '../../../../src/drawing/full/scopes/ScopeGrid.js';
import { TopBorderTrial } from '../../../../src/drawing/full/trials/TopBorderTrial.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('TopBorderTrial', () => {
  async function tried(path: string) {
    const document = await Fixtures.read(path);
    const { layout } = new ScopeGraph(document.tree.processes()[0]!, () => {});
    new ScopeGrid(layout).arrange();
    new TopBorderTrial(layout).run();
    return layout.nodes.flatMap((node) => node.boundary);
  }

  it('leaves events alone whose flows lead below their host', async () => {
    const events = await tried('layout/gallery__03-loop-boundary.bpmn');

    expect(events.every((event) => !event.onTop)).toBe(true);
  });

  it('moves an event up when a way over the host draws better than one round it', () => {
    const sketch = new ScopeSketch().node('start', 'before', -160, 222).node('task', 'host', 0, 200).boundary('event', 'host', 50).node('task', 'blocker', 200, 200).node('task', 'target', 200, 0).flow('before', 'host').flow('host', 'blocker').flow('event', 'target');

    new TopBorderTrial(sketch.layout()).run();

    expect(sketch.at('event').onTop).toBe(true);
  });

  it('keeps an event on the bottom border when a sub-process title takes the spot above', () => {
    const name = 'A sub-process with a title so long that it runs over the whole of its top border and further';
    const sketch = new ScopeSketch().node('start', 'before', -160, 222).node('subProcess', 'host', 0, 200, { name }).boundary('event', 'host', 50).node('task', 'blocker', 200, 200).node('task', 'target', 200, 0).flow('before', 'host').flow('host', 'blocker').flow('event', 'target');
    sketch.at('host').child = new ScopeSketch().layout();

    new TopBorderTrial(sketch.layout()).run();

    expect(sketch.at('event').onTop).toBeUndefined();
  });

  it('keeps an event on the bottom border when the top border is full', () => {
    const sketch = new ScopeSketch().node('start', 'before', -160, 222).node('task', 'host', 0, 200).boundary('one', 'host', 10, { onTop: true }).boundary('two', 'host', 50, { onTop: true }).boundary('event', 'host', 50).node('task', 'blocker', 200, 200).node('task', 'target', 200, 0).flow('before', 'host').flow('host', 'blocker').flow('event', 'target');

    new TopBorderTrial(sketch.layout()).run();

    expect(sketch.at('event').onTop).toBeUndefined();
  });

  it('never moves a message flow end or a compensation event', async () => {
    const compensation = await tried('layout/artifacts__09-compensation.bpmn');

    expect(compensation.filter((event) => event.compensationHandler).every((event) => !event.onTop)).toBe(true);
  });
});
