import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../../src/drawing/runners/DrawnDiagram.js';
import { FrameEscape } from '../../../../src/drawing/runners/placement/FrameEscape.js';
import { Box } from '../../../support/ModelValues.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('FrameEscape', () => {
  async function drawn(name: string): Promise<DrawnDiagram> {
    return new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
  }

  const movedTo = ({ width, height }: Box, x: number, y: number): Box => new Box(x, y, width, height);

  it('lets a shape stay in its lane, and past the far edge of the last lane', async () => {
    const diagram = await drawn('lanes');
    const escape = new FrameEscape(diagram.planes[0]!);
    const { shape } = diagram.drawnShape('A');
    const lane = diagram.drawnShape('L1').shape;
    const last = diagram.drawnShape('L2').shape;

    expect(escape.of(shape, lane, shape.bounds)).toBeUndefined();
    expect(escape.of({ ...shape, poolId: 'Pool' } as typeof shape, last, movedTo(shape.bounds, last.bounds.x + 100, last.bounds.bottom + 50))).toBeUndefined();
  });

  it('names the lane a shape would land in', async () => {
    const diagram = await drawn('lanes');
    const { shape } = diagram.drawnShape('A');
    const lane = diagram.drawnShape('L1').shape;
    const other = diagram.drawnShape('L2').shape;

    expect(new FrameEscape(diagram.planes[0]!).of(shape, lane, movedTo(shape.bounds, shape.bounds.x, other.bounds.y + 10))).toBe(other);
  });

  it('answers the frame itself when a shape leaves over its header', async () => {
    const diagram = await drawn('lanes');
    const { shape } = diagram.drawnShape('A');
    const lane = diagram.drawnShape('L1').shape;

    expect(new FrameEscape(diagram.planes[0]!).of(shape, lane, movedTo(shape.bounds, lane.bounds.x - 50, shape.bounds.y))).toBe(lane);
  });

  it('answers the lane when another lane follows underneath and the shape lands in none', async () => {
    const diagram = await drawn('boundary-lanes');
    const { shape } = diagram.drawnShape('Check');
    const lane = diagram.drawnShape('Sales').shape;
    const pool = diagram.drawnShape('Pool').shape;

    expect(new FrameEscape(diagram.planes[0]!).of(shape, lane, movedTo(shape.bounds, shape.bounds.x, pool.bounds.bottom + 50))).toBe(lane);
  });

  it('names the other pool a shape would land in', async () => {
    const diagram = await drawn('two-pools');
    const { shape } = diagram.drawnShape('Need');
    const home = diagram.drawnShape('Customer').shape;
    const other = diagram.drawnShape('Supplier').shape;

    expect(new FrameEscape(diagram.planes[0]!).of(shape, home, movedTo(shape.bounds, other.bounds.x + 100, other.bounds.y + 30))).toBe(other);
  });
});
