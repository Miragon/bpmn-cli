import { describe, expect, it } from 'vitest';
import { DetachedEdgeCriterion } from '../../../src/scoring/flows/DetachedEdgeCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DetachedEdgeCriterion', () => {
  it('finds a flow ending far from its target, not one ending within the gap', async () => {
    const { problems } = new Scorer([new DetachedEdgeCriterion()]).score(await Fixtures.read('scoring/detached-edge.bpmn'));

    expect(problems).toEqual([{ kind: 'detachedEdge', ids: ['flow_away', 'task_b'] }]);
  });

  it('holds a data association to the data object it writes', async () => {
    const { problems } = new Scorer([new DetachedEdgeCriterion()]).score(await Fixtures.read('scoring/data-association.bpmn'));

    expect(problems).toEqual([{ kind: 'detachedEdge', ids: ['output', 'data_written'] }]);
  });
});
