import { describe, expect, it } from 'vitest';
import { RowChooser } from '../../../../src/drawing/incremental/placement/RowChooser.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('RowChooser', () => {
  const size = { width: 100, height: 80 };
  const search = (left: number, exclude: Iterable<string> = [], extent = 0) => ({ left, size, extent, exclude: new Set(exclude) });

  it('finds the first free rows below a start and flags those on a line', async () => {
    const scene = await PlacementScene.of('add-branch');

    const rows = scene.rows.freeRows(scene.plane, undefined, search(606), { centre: 178, step: 140, count: 2 });

    expect(rows[0]!.centre).toBe(318);
    expect(rows).toHaveLength(2);
  });

  it('keeps the room for the chain free of shapes', async () => {
    const scene = await PlacementScene.of('add-branch');

    const [row] = scene.rows.freeRows(scene.plane, undefined, search(300, [], 300), { centre: 178, step: 140, count: 1 });

    expect(row!.centre).toBeGreaterThan(178);
  });

  it('answers the start when no row is free below it, and nothing above', async () => {
    const scene = await PlacementScene.of('add-branch');
    const wide = { left: -2000, size: { width: 9000, height: 80 }, extent: 0, exclude: new Set<string>() };

    expect(scene.rows.freeRows(scene.plane, undefined, wide, { centre: 178, step: 1, count: 1 })[0]).toEqual({ centre: 178, onLine: false });
    expect(scene.rows.freeRows(scene.plane, undefined, wide, { centre: 178, step: 1, count: 1, up: true })).toEqual([]);
  });

  it('chooses the cheapest candidate, the one the repair asks for, and records the number of candidates', async () => {
    const scene = await PlacementScene.of('add-branch');
    const from = scene.shape('Gateway_Inner');
    const near = { x: 606, centre: 318, size, penalty: 0 };
    const far = { x: 606, centre: 618, size, penalty: 0 };

    expect(scene.rows.cheapest('Node', scene.plane, from, 'task', [far, near])).toBe(near);
    expect(scene.place.heads.get('Node')).toBe(2);
    scene.place.skip.set('Node', 1);
    expect(scene.rows.cheapest('Node', scene.plane, from, 'task', [far, near])).toBe(far);
  });

  it('opens a row when a line runs between the anchor and the first row', async () => {
    const scene = await PlacementScene.of('connect');
    const main = scene.shape('Activity_PrepareOffer');
    const first = main.bounds.center.y + 100;

    const cands = scene.rows.rowCandidates(scene.plane, { parentId: undefined, poolId: undefined }, undefined, search(320, [], 100), { first, step: 140, floor: main.bounds.bottom, anchor: main, descend: main.bounds.center.x });

    expect(cands.length).toBeGreaterThan(0);
  });

  it('opens a taken row with the space tool, costing less than a crossing', async () => {
    const scene = await PlacementScene.of('add-branch');
    const anchor = scene.shape('Activity_C');

    const cands = scene.rows.rowCandidates(scene.plane, {}, undefined, search(496), { first: anchor.bounds.center.y, step: 140, floor: 100, anchor });
    const opened = cands.find((cand) => cand.insert);

    expect(opened?.insert?.delta).toBeGreaterThan(0);
    expect(opened?.penalty).toBeLessThan(300);
  });

  it('grows the frame for a row below its interior', async () => {
    const scene = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const pool = scene.shape('Pool');
    const anchor = scene.shape('A');

    const [cand] = scene.rows.rowCandidates(scene.plane, anchor, pool, search(260), { first: 340, step: 140, floor: anchor.bounds.bottom, anchor });

    expect(cand?.grow?.delta).toBeGreaterThan(0);
  });

  it('offers rows above inside the frame and opens the frame top for the first one', async () => {
    const free = await PlacementScene.of('add-branch');
    const anchor = free.shape('Activity_C');
    const probe = free.place.probeOf(free.plane, 'Activity_D');
    const above = free.rows.rowsAbove(free.plane, probe, undefined, search(496), { anchor, start: 38, step: 140, penalty: RowChooser.TOP_ROW });
    const pooled = await PlacementScene.drawn('models/incremental/pool.bpmn');
    const a = pooled.shape('A');
    const inside = pooled.rows.rowsAbove(pooled.plane, pooled.place.probeOf(pooled.plane, 'C'), pooled.shape('Pool'), search(260), { anchor: a, start: 60, step: 140, penalty: 160 });

    expect(above[0]).toMatchObject({ centre: 38, penalty: RowChooser.TOP_ROW });
    expect(inside[0]?.insert?.delta).toBeGreaterThan(0);
  });

  it('prefers the rows of a neighbour in a lane, then its own, then a row below', async () => {
    const scene = await PlacementScene.of('add-annotation');
    const lane = scene.shape('Lane_Backend');

    expect(scene.rows.rowInLane(scene.plane, lane, { left: 266, size, exclude: new Set() }, [458])).toBe(458);
    expect(scene.rows.rowInLane(scene.plane, lane, { left: 696, size, exclude: new Set() }, [])).toBeGreaterThan(lane.bounds.y + 100);
  });

  it('moves a candidate into the node\'s own lane only when it lies outside', async () => {
    const scene = await PlacementScene.of('add-annotation');
    const probe = { ...scene.place.probeOf(scene.plane, 'Activity_AutoFix'), id: 'New' };

    expect(scene.rows.intoOwnLane(scene.plane, { id: 'X', kind: 'task' }, 266, 178, size, [])).toBe(178);
    expect(scene.rows.intoOwnLane(scene.plane, probe, 266, 458, size, [])).toBe(458);
    expect(scene.rows.intoOwnLane(scene.plane, probe, 266, 178, size, [])).toBeGreaterThan(360);
    expect(scene.rows.intoOwnLane(scene.plane, probe, 696, 620, size, [], scene.shape('Activity_AutoFix'))).toBe(620);
  });
});
