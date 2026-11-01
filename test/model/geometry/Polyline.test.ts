import { describe, expect, it } from 'vitest';
import { Box } from '../../../src/model/geometry/Box.js';
import { Point } from '../../../src/model/geometry/Point.js';
import { type BoxesByX, Polyline } from '../../../src/model/geometry/Polyline.js';

describe('Polyline', () => {
  const route = new Polyline([new Point(0, 0), new Point(100, 0), new Point(100, 100)]);
  const shape = new Box(40, -20, 20, 40);
  const elsewhere = new Box(300, 300, 20, 20);

  function indexed(boxes: readonly Box[]): BoxesByX {
    return {
      each(_low, _high, visit) {
        return boxes.some((box) => visit(box) === true);
      },
    };
  }

  it('cuts a route into its segments, none for a single point', () => {
    expect(route.segments().map(({ start, end }) => [start.x, end.y])).toEqual([
      [0, 0],
      [100, 100],
    ]);
    expect(new Polyline([new Point(0, 0)]).segments()).toEqual([]);
  });

  it('copies a route so the copy moves alone', () => {
    const copy = route.copy();

    new Polyline(copy).translate(1, 1);

    expect(copy[0]).toEqual(new Point(1, 1));
    expect(route.points[0]).toEqual(new Point(0, 0));
  });

  it('holds two routes the same within the tolerance and of equal length', () => {
    expect(route.same(new Polyline([new Point(0.4, 0), new Point(100, 0), new Point(100, 100)]))).toBe(true);
    expect(route.same(new Polyline([new Point(0, 0)]))).toBe(false);
  });

  it('finds that two routes cross', () => {
    const other = new Polyline([new Point(50, -10), new Point(50, 10)]);

    expect(route.crosses(other)).toBe(true);
    expect(route.crosses(new Polyline([new Point(-10, -10), new Point(-5, -5)]))).toBe(false);
  });

  it('finds that a route runs through a shape', () => {
    expect(route.hits(shape)).toBe(true);
    expect(route.hits(elsewhere)).toBe(false);
  });

  it('counts each shape a route cuts once, skipping the ones to ignore', () => {
    expect(route.hitCount([shape, elsewhere], [])).toBe(1);
    expect(route.hitCount([shape], [shape])).toBe(0);
    expect(route.hitCount(indexed([shape]), [])).toBe(1);
  });

  it('answers whether a route cuts any shape, from a list or an index by x', () => {
    expect(route.hitsAny([shape], [])).toBe(true);
    expect(route.hitsAny([shape], [shape])).toBe(false);
    expect(route.hitsAny(indexed([shape]), [])).toBe(true);
    expect(route.hitsAny(indexed([elsewhere]), [])).toBe(false);
  });

  it('holds a route orthogonal within the tolerance', () => {
    expect(route.isOrthogonal()).toBe(true);
    expect(new Polyline([new Point(0, 0), new Point(10, 10)]).isOrthogonal()).toBe(false);
  });

  it('drops repeated points and rounds to whole pixels', () => {
    expect(new Polyline([new Point(1, 1), new Point(1, 1), new Point(2, 1)]).deduped()).toEqual([new Point(1, 1), new Point(2, 1)]);
    expect(new Polyline([new Point(1.2, 1.2), new Point(0.9, 1.4), new Point(5.6, 1)]).rounded()).toEqual([new Point(1, 1), new Point(6, 1)]);
  });

  it('counts every crossing of a route with other lines', () => {
    const across = new Polyline([new Point(50, -50), new Point(50, 50)]);
    const twice = new Polyline([new Point(120, -10), new Point(80, -10), new Point(80, 50), new Point(120, 50)]);

    expect(route.crossingCount([across, twice])).toBe(3);
    expect(route.crossingCount([])).toBe(0);
  });

  it('drops collinear and repeated points, and keeps both ends of ports on one spot', () => {
    const bent = new Polyline([new Point(0, 0), new Point(50, 0), new Point(100, 0), new Point(100, 0), new Point(100, 100)]);
    const spot = new Polyline([new Point(5, 5), new Point(5, 5)]);

    expect(bent.simplified().map(({ x, y }) => [x, y])).toEqual([[0, 0], [100, 0], [100, 100]]);
    expect(spot.simplified()).toHaveLength(2);
    expect(new Polyline([new Point(1, 1)]).simplified()).toHaveLength(1);
  });
});
