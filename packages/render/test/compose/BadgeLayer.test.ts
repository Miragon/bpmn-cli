import { describe, expect, it } from 'vitest';
import { BadgeLayer } from '../../src/compose/BadgeLayer.js';
import { Box } from '../../src/read/Box.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('BadgeLayer', () => {
  const gallery = 'models/render/gallery.bpmn';

  async function layer(scale = 1): Promise<{ layer: BadgeLayer; center: { x: number; y: number } }> {
    const plane = await CorpusModel.plane(gallery);
    const { bounds } = plane.shapes.get('Activity_UserTask')!;
    return { layer: new BadgeLayer(plane, new Box(-1000, -1000, 8000, 8000), scale), center: { x: bounds.centerX, y: bounds.centerY } };
  }

  it('numbers a badge at the middle of its element', async () => {
    const { layer: badges, center } = await layer();
    const [placed] = badges.placed([{ n: 3, ids: ['Activity_UserTask'] }]);
    expect(placed?.n).toBe(3);
    expect(placed?.svg).toContain('data-badge="3"');
    expect(placed?.box.centerX).toBeCloseTo(center.x, 6);
  });

  it('keeps its size in the image when the drawing is scaled down', async () => {
    const { layer: badges } = await layer(0.5);
    expect(badges.placed([{ n: 1, ids: ['Activity_UserTask'] }])[0]?.svg).toContain('r="18"');
  });

  it('draws a three-digit number smaller', async () => {
    const { layer: badges } = await layer();
    expect(badges.placed([{ n: 100, ids: ['Activity_UserTask'] }])[0]?.svg).toContain('font-size="9"');
  });

  it('moves a second badge at the same spot aside, inside the box of its element', async () => {
    const { layer: badges, center } = await layer();
    const [first, second] = badges.placed([{ n: 1, ids: ['Activity_UserTask'] }, { n: 2, ids: ['Activity_UserTask'], at: center }]);
    expect(first?.box.centerX === second?.box.centerX && first?.box.centerY === second?.box.centerY).toBe(false);
  });

  it('stacks badges when no free spot is left in the box', async () => {
    const plane = await CorpusModel.plane(gallery);
    const event = plane.shapes.get('Event_MessageStartInEventSubProcess')!;
    const badges = new BadgeLayer(plane, new Box(-1000, -1000, 8000, 8000), 0.5);
    const placed = badges.placed([1, 2].map((n) => ({ n, ids: [event.id] })));
    expect(placed[1]?.box.x).toBe(placed[0]?.box.x);
  });

  it('draws no badge for an id off the plane or a point outside the view', async () => {
    const plane = await CorpusModel.plane(gallery);
    const badges = new BadgeLayer(plane, new Box(0, 0, 1, 1), 1);
    expect(badges.placed([{ n: 1, ids: ['Nothing'] }, { n: 2, ids: ['Activity_UserTask'] }])).toEqual([]);
  });

  it('puts a badge on a flow and its label', async () => {
    const { layer: badges } = await layer();
    expect(badges.placed([{ n: 1, ids: ['Flow_WhichPathToRejected'] }])).toHaveLength(1);
  });
});
