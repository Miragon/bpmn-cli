import { describe, expect, it } from 'vitest';
import { ProblemKinds } from '../../src/scoring/plane/ProblemKinds.js';
import { Scorer } from '../../src/scoring/Scorer.js';
import { Fixtures } from '../support/Fixtures.js';

interface RecordedScore {
  score: number;
  counts: Record<string, number>;
}

const recorded: { kinds: string[]; weights: Record<string, number>; files: Record<string, RecordedScore> } = JSON.parse(Fixtures.text('layout/scores.json'));

describe('Scorer', () => {
  it.each(Object.entries(recorded.files))('gives main\'s counts per kind on %s', async (path, { counts, score }) => {
    const result = new Scorer().score(await Fixtures.read(path));

    expect(result.counts).toEqual(counts);
    expect(result.score).toBe(score);
  });
});
