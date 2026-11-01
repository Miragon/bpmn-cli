import { describe, expect, it } from 'vitest';
import { LabelPainter } from '../../src/paint/LabelPainter.js';
import { Box } from '../../src/read/Box.js';

describe('LabelPainter', () => {
  const painter = new LabelPainter('#123456');

  it('centres an external label at 11 px below its point', () => {
    const { box, svg } = painter.external('Event_Done', 'Done', 100, 50);
    expect(box.centerX).toBeCloseTo(100, 6);
    expect(box.y).toBe(50);
    expect(svg).toContain('data-label="Event_Done"');
    expect(svg).toContain('font-size="11"');
    expect(svg).toContain('fill="#123456"');
  });

  it('breaks a long external label at 90 px', () => {
    const { box } = painter.external('Flow_A', 'Is the order complete and correct', 100, 50);
    expect(box.height).toBeCloseTo(3 * 13.2, 6);
  });

  it('starts a message label at the middle of its flow, 10 px below', () => {
    const { box, svg } = painter.message('Flow_B', 'Reminder', { x: 200, y: 100 });
    expect([box.x, box.y]).toEqual([200, 110]);
    expect(svg).toContain('data-message="Flow_B"');
  });

  it('centres a name inside a task', () => {
    const svg = painter.inBox('Check', new Box(0, 0, 100, 80), { horizontal: 'center', vertical: 'middle', padding: 7 });
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('x="50"');
  });

  it('starts an annotation at its left padding, at the top', () => {
    const svg = painter.inBox('Note', new Box(10, 20, 100, 80), { horizontal: 'left', vertical: 'top', padding: 7 });
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain('x="17"');
    expect(svg).toContain('y="37.8"');
  });
});
