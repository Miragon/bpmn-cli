import { describe, expect, it } from 'vitest';
import { RouteCosts } from '../../../../src/drawing/incremental/routing/RouteCosts.js';
import { RoutePorts } from '../../../../src/drawing/incremental/routing/RoutePorts.js';
import { ShapeSides } from '../../../../src/drawing/plane/ShapeSides.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('RoutePorts', () => {
  const box = new Box(100, 100, 100, 80);
  const other = new Box(400, 300, 100, 80);
  const rank = RouteCosts.SRC_RANK;

  it('offers the middle of a side first and a spot facing the other shape', () => {
    const ports = new RoutePorts([], 15, 15).of({ box, sides: ['right'], rank, other: new Box(400, 120, 100, 80) });

    expect(ports.map(({ y }) => y)).toEqual([140, 160]);
    expect(ports[0]?.cost).toBe(0);
    expect(ports[1]?.cost).toBeGreaterThan(RouteCosts.PORT_OFFSET);
  });

  it('keeps a gateway on its corner', () => {
    const ports = new RoutePorts([new Box(205, 100, 30, 80)], 15, 15).of({ box, sides: ['right'], rank, other, middle: true });

    expect(ports).toHaveLength(1);
  });

  it('leaves the middle beside an obstacle in its stub', () => {
    const blocker = new Box(205, 130, 30, 20);
    const offsets = new RoutePorts([blocker], 15, 15)
      .of({ box, sides: ['right'], rank, other: new Box(0, 0, 1, 1) })
      .map(({ y }) => y);

    expect(offsets).toContain(115);
    expect(offsets).toContain(165);
  });

  it('offers the quarters when another line docks on the middle', () => {
    const offsets = new RoutePorts([], 15, 15)
      .of({ box, sides: ['right'], rank, other: new Box(0, 0, 1, 1), docked: [new Point(200, 140)] })
      .map(({ y }) => y);

    expect(offsets).toEqual([120, 140, 160]);
  });

  it('charges a side another connection took and each later side by its rank', () => {
    const ports = new RoutePorts([], 15, 15).of({ box, sides: ['right', 'bottom', 'top'], rank, other: new Box(0, 0, 1, 1), avoid: ['bottom'] });

    expect(ports.map(({ side, cost }) => [side, cost])).toEqual([
      ['right', rank[0]],
      ['bottom', rank[1]! + RouteCosts.AVOID],
      ['top', rank[2]],
    ]);
  });

  it('faces the other shape on all four sides', () => {
    const middleOf = (side: 'left' | 'top' | 'bottom', far: Box): number => new RoutePorts([], 15, 15).of({ box, sides: [side], rank, other: far }).length;

    expect(middleOf('left', new Box(0, 110, 20, 20))).toBe(2);
    expect(middleOf('top', new Box(170, 0, 20, 20))).toBe(2);
    expect(middleOf('bottom', new Box(170, 300, 20, 20))).toBe(2);
  });

  it('falls back on the default sides and drops doubles', () => {
    expect(RoutePorts.sidesOf(undefined, ShapeSides.SOURCE_DEFAULT)).toBe(ShapeSides.SOURCE_DEFAULT);
    expect(RoutePorts.sidesOf(['top', 'top', 'left'], ShapeSides.SOURCE_DEFAULT)).toEqual(['top', 'left']);
  });
});
