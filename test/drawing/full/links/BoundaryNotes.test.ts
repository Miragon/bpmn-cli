import { describe, expect, it } from 'vitest';
import { BoundaryNotes } from '../../../../src/drawing/full/links/BoundaryNotes.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('BoundaryNotes', () => {
  const note = ScopeSketch.artifact('bpmn:TextAnnotation', 'note', 'annotation', { width: 100, height: 30 });

  it('puts a note lower left of a lone event', () => {
    const sketch = new ScopeSketch().node('task', 'host', 200, 100).boundary('event', 'host', 260);
    const event = sketch.at('event');

    const box = new BoundaryNotes(() => true, []).boxOf(note, event, sketch.at('host'));

    expect(box.right).toBeLessThan(event.box.x);
    expect(box.y).toBeGreaterThan(sketch.at('host').box.bottom);
  });

  it('stacks a note down when the spot is taken', () => {
    const sketch = new ScopeSketch().node('task', 'host', 200, 100).boundary('event', 'host', 260);
    const taken = new BoundaryNotes((box) => box.y > 200, []).boxOf(note, sketch.at('event'), sketch.at('host'));

    expect(taken.y).toBeGreaterThan(200);
  });

  it('keeps off a sibling event, its label and its line', () => {
    const sketch = new ScopeSketch().node('task', 'host', 200, 100).boundary('event', 'host', 220).boundary('sibling', 'host', 270, { name: 'Sibling' }).node('task', 'next', 400, 300).flow('sibling', 'next').flow('host', 'next');
    const host = sketch.at('host');

    const box = new BoundaryNotes(() => true, [host.box, sketch.at('next').box]).boxOf(note, sketch.at('sibling'), host);

    expect(box.overlaps(sketch.at('event').box)).toBe(false);
  });

  it('falls back to the stack when every spot is blocked', () => {
    const sketch = new ScopeSketch().node('task', 'host', 200, 100).boundary('event', 'host', 220).boundary('sibling', 'host', 270);
    const wall = new ScopeSketch().node('task', 'wall', 0, 0, { width: 1000, height: 1000 }).at('wall').box;
    const free = (): boolean => true;

    expect(new BoundaryNotes(free, [wall]).boxOf(note, sketch.at('sibling'), sketch.at('host')).y).toBe(sketch.at('host').box.bottom + 8);
  });
});
