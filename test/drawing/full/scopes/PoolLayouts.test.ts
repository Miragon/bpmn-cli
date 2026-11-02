import { describe, expect, it } from 'vitest';
import { PoolLayouts } from '../../../../src/drawing/full/scopes/PoolLayouts.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('PoolLayouts', () => {
  it('finds the pool of a participant and of an element inside its process', async () => {
    const document = await Fixtures.read('models/incremental/pool.bpmn');
    const participant = Fixtures.element(document, 'Pool');
    const pools = new PoolLayouts();
    const pool = { participant, process: Fixtures.element(document, 'P1'), box: new Box(0, 0, 100, 100), origin: new Point(0, 0) };
    pools.list.push(pool);

    expect(pools.of(participant)).toBe(pool);
    expect(pools.of(Fixtures.element(document, 'A'))).toBe(pool);
  });

  it('finds no pool for an element of another process', async () => {
    const document = await Fixtures.read('models/incremental/pool.bpmn');

    expect(new PoolLayouts().of(Fixtures.element(document, 'A'))).toBeUndefined();
  });
});
