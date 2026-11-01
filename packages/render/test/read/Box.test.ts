import { describe, expect, it } from 'vitest';
import { Box } from '../../src/read/Box.js';

describe('Box', () => {
  it('spans the waypoints of a flow', () => {
    expect(Box.spanning([{ x: 10, y: 40 }, { x: 30, y: 20 }])).toEqual(new Box(10, 20, 20, 20));
  });

  it('finds nothing around no shapes', () => {
    expect(Box.around([])).toBeUndefined();
  });

  it('unites a task with its label below it', () => {
    expect(new Box(0, 0, 100, 80).union(new Box(20, 85, 40, 14))).toEqual(new Box(0, 0, 100, 99));
  });

  it('grows around a shape on every side', () => {
    expect(new Box(10, 10, 20, 20).grown(5)).toEqual(new Box(5, 5, 30, 30));
  });

  it('tells a label touching the view from one outside it', () => {
    const view = new Box(0, 0, 100, 100);
    expect(new Box(100, 100, 10, 10).meets(view)).toBe(true);
    expect(new Box(101, 0, 10, 10).meets(view)).toBe(false);
  });

  it('holds a point on its border', () => {
    expect(new Box(0, 0, 10, 10).contains({ x: 10, y: 10 })).toBe(true);
    expect(new Box(0, 0, 10, 10).contains({ x: 11, y: 10 })).toBe(false);
  });

  it('knows the middle of a gateway', () => {
    const gateway = new Box(100, 200, 50, 50);
    expect([gateway.centerX, gateway.centerY, gateway.right, gateway.bottom]).toEqual([125, 225, 150, 250]);
  });
});
