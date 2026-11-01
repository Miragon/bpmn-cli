import { describe, expect, it } from 'vitest';
import { LinkRuns, type LinkEnds } from '../../../../src/drawing/full/links/LinkRuns.js';
import { Box } from '../../../support/ModelValues.js';

describe('LinkRuns', () => {
  const ends = (shapes: Box[], end: LinkEnds['end'] = 'shape', note = false): LinkEnds => ({ artifactBox: new Box(100, 100, 36, 50), targetBox: new Box(300, 100, 100, 80), end, note, shapes });

  it('runs level with the artifact, under it, over it and under all between', () => {
    const blocker = new Box(200, 120, 50, 100);
    const { standard } = new LinkRuns(ends([blocker]), undefined).of(118, 150);

    expect(standard).toEqual(expect.arrayContaining([125, 165, 85, 240]));
  });

  it('runs into a flow at its height and halfway to it', () => {
    const { standard } = new LinkRuns(ends([], 'flow'), undefined).of(118, 150);

    expect(standard).toEqual(expect.arrayContaining([140, 145]));
  });

  it('takes a gap narrower than 30 px as a run, a wide one as a spare run', () => {
    const shapes = [new Box(110, 170, 20, 20), new Box(110, 0, 20, 40)];
    const { gaps, spare } = new LinkRuns(ends(shapes), undefined).of(118, 150);

    expect(gaps).toContain(160);
    expect(spare).toContain(70);
  });

  it('keeps its spare runs inside the lanes and no run above a laned scope with no room', () => {
    const bands = [{ nodes: new Set<never>(), top: 90, bottom: 260 }];
    const { spare } = new LinkRuns(ends([]), bands).of(118, 150);
    const tight = { ...ends([]), artifactBox: new Box(100, 5, 36, 50) };

    expect(spare.every((run) => run > 90 && run < 260)).toBe(true);
    expect(new LinkRuns(tight, bands).of(118, 150).standard).not.toContain(-10);
  });

  it('adds the middle of a gap a standard run hugs a box in', () => {
    const shapes = [new Box(200, 150, 50, 12), new Box(200, 180, 50, 10)];

    expect(new LinkRuns(ends(shapes), undefined).of(118, 150).spare).toContain(171);
    expect(new LinkRuns(ends([new Box(200, 165, 50, 2)]), undefined).of(118, 150).spare).toContain(155);
    expect(new LinkRuns(ends([new Box(200, 150, 50, 12)]), undefined).of(118, 150).spare).toContain(172);
  });
});
