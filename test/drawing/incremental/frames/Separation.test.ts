import { describe, expect, it } from 'vitest';
import { Separation } from '../../../../src/drawing/incremental/frames/Separation.js';
import { SpaceTool } from '../../../../src/drawing/incremental/space/SpaceTool.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('Separation', () => {
  async function separationOf(path = 'models/incremental/boundary.bpmn') {
    const document = await Fixtures.read(path);
    const plane = new PlaneReader(document.tree.definitions).planes()[0]!;
    return { plane, separation: new Separation(plane, new SpaceTool(plane)) };
  }

  it('parts two overlapping shapes', async () => {
    const { plane, separation } = await separationOf();
    plane.shapes.get('C')!.bounds.x = 330;

    expect(separation.separate({ active: ['C'] }).moved.has('C')).toBe(true);
  });

  it('tidies every leaf of a plane', async () => {
    const { plane, separation } = await separationOf();
    plane.shapes.get('C')!.bounds.x = 330;
    const { moved, resized, unresolved } = separation.tidy();

    expect(moved).toContain('C');
    expect(resized).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it('tidies only the shapes it is given, by the gap it is given', async () => {
    const { plane, separation } = await separationOf();
    plane.shapes.get('C')!.bounds.x = 345;

    expect(separation.tidy({ ids: ['S'] }).moved).toEqual([]);
    expect(separation.tidy({ ids: ['C'], gap: 3 }).moved).toEqual([]);
    expect(separation.tidy({ ids: ['C'], gap: 20 }).moved).toContain('C');
  });
});
