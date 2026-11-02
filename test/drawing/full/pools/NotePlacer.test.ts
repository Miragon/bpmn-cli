import { describe, expect, it } from 'vitest';
import { NotePlacer } from '../../../../src/drawing/full/pools/NotePlacer.js';
import { Box, Point, Polyline } from '../../../support/ModelValues.js';

describe('NotePlacer', () => {
  const job = { width: 100, height: 30 };
  const pool = new Box(100, 100, 800, 300);

  it('puts a note above its anchor, inside the pool when it belongs there', () => {
    const anchor = new Box(300, 250, 100, 80);

    const [box] = new NotePlacer({ obstacles: [anchor], lines: [], pools: [pool] }).place([{ ...job, anchor, pool }]);

    expect(box!.bottom).toBeLessThanOrEqual(anchor.y);
    expect(box!.isInside(pool)).toBe(true);
  });

  it('goes beside an anchor at the top of a pool, and stays off lines', () => {
    const anchor = new Box(300, 110, 100, 80);
    const lines = new Polyline([new Point(0, 150), new Point(380, 150)]).segments();

    const [box] = new NotePlacer({ obstacles: [anchor], lines, pools: [pool] }).place([{ ...job, anchor, pool }]);

    expect(box!.x).toBeGreaterThan(anchor.right);
  });

  it('keeps a note without a pool outside all pools', () => {
    const anchor = new Box(300, 90, 0, 0);

    const [box] = new NotePlacer({ obstacles: [], lines: [], pools: [pool] }).place([{ ...job, anchor }]);

    expect(box!.overlaps(pool)).toBe(false);
  });

  it('stacks notes without a spot right of the whole drawing', () => {
    const [first, second] = new NotePlacer({ obstacles: [], lines: [], pools: [pool] }).place([job, job]);

    expect(first!.x).toBeGreaterThan(pool.right);
    expect(second!.y).toBeGreaterThan(first!.bottom);
  });
});
