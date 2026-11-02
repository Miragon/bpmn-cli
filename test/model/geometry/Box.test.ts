import { describe, expect, it } from 'vitest';
import { Box } from '../../../src/model/geometry/Box.js';
import { Point } from '../../../src/model/geometry/Point.js';

describe('Box', () => {
  const task = new Box(100, 100, 100, 80);

  it('knows the right and bottom border and the centre of a task', () => {
    expect([task.right, task.bottom]).toEqual([200, 180]);
    expect(task.center).toEqual(new Point(150, 140));
  });

  it('treats two shapes as the same within half a pixel', () => {
    expect(Box.same(task, new Box(100.4, 100, 100, 80))).toBe(true);
    expect(Box.same(task, new Box(100.6, 100, 100, 80))).toBe(false);
    expect(Box.same(task, new Box(100.4, 100, 100, 80), 0)).toBe(false);
  });

  it('holds two missing shapes the same, but not a missing one and a drawn one', () => {
    expect(Box.same(undefined, undefined)).toBe(true);
    expect(Box.same(task, undefined)).toBe(false);
  });

  it('finds that two shapes overlap only when they share interior', () => {
    expect(task.overlaps(new Box(150, 150, 10, 10))).toBe(true);
    expect(task.overlaps(new Box(200, 100, 10, 10))).toBe(false);
    expect(task.overlaps(new Box(205, 100, 10, 10), 10)).toBe(true);
  });

  it('finds a shape inside a pool within half a pixel of its padding', () => {
    const pool = new Box(0, 0, 400, 300);

    expect(task.isInside(pool)).toBe(true);
    expect(new Box(-0.4, 0, 10, 10).isInside(pool)).toBe(true);
    expect(new Box(5, 0, 10, 10).isInside(pool, 10)).toBe(false);
  });

  it('holds a point on the border as contained, and one past the tolerance not', () => {
    expect(task.contains(new Point(200, 180))).toBe(true);
    expect(task.contains(new Point(201, 100))).toBe(false);
    expect(task.contains(new Point(201, 100), 1)).toBe(true);
  });

  it('unites boxes into the frame around them', () => {
    expect(task.union(new Box(0, 300, 10, 10))).toEqual(new Box(0, 100, 200, 210));
    expect(Box.unionAll([task, new Box(0, 300, 10, 10)])).toEqual(new Box(0, 100, 200, 210));
  });

  it('has no frame around no boxes, and a copy around one', () => {
    expect(Box.unionAll([])).toBeUndefined();
    expect(Box.unionAll([task])).not.toBe(task);
    expect(Box.unionAll([task])).toEqual(task);
  });

  it('grows on every side and moves in place', () => {
    const moved = task.copy();

    moved.translate(10, 20);

    expect(task.grow(5)).toEqual(new Box(95, 95, 110, 90));
    expect(moved).toEqual(new Box(110, 120, 100, 80));
    expect(task.x).toBe(100);
  });
});
