import { describe, expect, it } from 'vitest';
import { ProblemKinds, type ProblemKind } from '../../../src/scoring/plane/ProblemKinds.js';
import { Fixtures } from '../../support/Fixtures.js';

const recorded: { kinds: ProblemKind[]; weights: Record<ProblemKind, number> } = JSON.parse(Fixtures.text('layout/scores.json'));

describe('ProblemKinds', () => {
  it('holds main\'s 26 kinds and weights in main\'s order', () => {
    expect(ProblemKinds.ALL).toEqual(recorded.kinds);
    expect(ProblemKinds.ALL).toHaveLength(26);
    expect(ProblemKinds.ALL.map((kind) => ProblemKinds.recordOf(kind).weight)).toEqual(recorded.kinds.map((kind) => recorded.weights[kind]));
  });

  it('calls a kind hard from weight 6 on, but never an import warning', () => {
    expect(ProblemKinds.ALL.filter((kind) => ProblemKinds.isHard(kind))).toEqual(['overlaps', 'frameIntrusion', 'frameOverlap', 'through', 'degenerateEdge', 'detachedEdge', 'missing', 'outsideLane', 'outsidePool', 'outsideSub']);
  });

  it('makes one fresh value per kind', () => {
    const lists = ProblemKinds.perKind<string[]>(() => []);

    lists.overlaps.push('task');

    expect(lists.crossings).toEqual([]);
    expect(Object.keys(lists)).toEqual(ProblemKinds.ALL);
  });
});
