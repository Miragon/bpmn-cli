import { describe, expect, it } from 'vitest';
import { LinkPaths } from '../../../../src/drawing/full/links/LinkPaths.js';
import type { LinkEnds } from '../../../../src/drawing/full/links/LinkRuns.js';
import { Box } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('LinkPaths', () => {
  const ends = (artifactBox: Box, targetBox: Box, end: LinkEnds['end'] = 'shape', shapes: Box[] = []): LinkEnds => ({ artifactBox, targetBox, end, note: false, shapes });

  it('offers straight down first where the two face each other', () => {
    const { paths } = new LinkPaths(ends(new Box(110, 0, 36, 50), new Box(100, 200, 100, 80)), undefined, undefined).candidates([]);

    expect(paths[0]!.map((point) => point.x)).toEqual([128, 128]);
  });

  it('offers a level way across where they sit side by side, either way round', () => {
    const left = new LinkPaths(ends(new Box(0, 110, 36, 50), new Box(200, 100, 100, 80)), undefined, undefined).candidates([]);
    const right = new LinkPaths(ends(new Box(400, 110, 36, 50), new Box(200, 100, 100, 80)), undefined, undefined).candidates([]);

    expect(left.paths[0]!.map((point) => point.y)).toEqual([135, 135]);
    expect(right.paths[0]![0]!.x).toBe(400);
  });

  it('enters a node where the way round does, so two lines into one target join', () => {
    const node = new ScopeSketch().node('task', 'a', 100, 200).at('a');

    const { paths } = new LinkPaths(ends(new Box(150, 0, 36, 50), node.box), node, undefined).candidates([]);

    expect(paths[0]![0]!.x).toBe(180);
  });

  it('ends on a flow at its point, from straight above when the note reaches over it', () => {
    const { paths } = new LinkPaths(ends(new Box(100, 0, 100, 30), new Box(150, 200, 0, 0), 'flow'), undefined, undefined).candidates([]);

    expect(paths.some((path) => path.at(-1)!.x === 150 && path.at(-1)!.y === 200 && path.length === 2)).toBe(true);
  });

  it('keeps the spare ways behind the standard ones and adds the join heights', () => {
    const { paths, spare } = new LinkPaths(ends(new Box(0, 0, 36, 50), new Box(300, 300, 100, 80)), undefined, undefined).candidates([777]);

    expect(spare).toBeLessThanOrEqual(paths.length);
    expect(paths.some((path) => path.some((point) => point.y === 777))).toBe(true);
  });

  it('turns halfway between a target and a shape close beside it', () => {
    const wall = new Box(190, 150, 20, 300);
    const { paths } = new LinkPaths(ends(new Box(0, 0, 36, 50), new Box(220, 300, 100, 80), 'shape', [wall]), undefined, undefined).candidates([]);

    expect(paths.some((path) => path.some((point) => point.x === 215))).toBe(true);
  });
});
