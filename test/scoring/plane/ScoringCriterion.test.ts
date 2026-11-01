import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProblemKinds } from '../../../src/scoring/plane/ProblemKinds.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

const FIXTURES = readdirSync(new URL('../../../corpus/scoring/', import.meta.url));

describe('ScoringCriterion', () => {
  it('pins every kind but failed to exactly one criterion of 22', () => {
    const named = Scorer.CRITERIA.flatMap((criterion) => [...criterion.kinds]);

    expect(Scorer.CRITERIA).toHaveLength(22);
    expect([...named].sort()).toEqual(ProblemKinds.ALL.filter((kind) => kind !== 'failed').sort());
  });

  it.each(FIXTURES)('reports only the kinds it names on %s', async (file) => {
    const document = await Fixtures.read(`scoring/${file}`);

    for (const criterion of Scorer.CRITERIA) {
      const { problems } = new Scorer([criterion]).score(document);

      expect(problems.filter(({ kind }) => kind !== 'failed' && !criterion.kinds.includes(kind))).toEqual([]);
    }
  });
});
