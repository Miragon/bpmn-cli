import { describe, expect, it } from 'vitest';
import { NeighbourhoodWalk } from '../../../src/views/around/NeighbourhoodWalk.js';
import { Fixtures } from '../../support/Fixtures.js';

const window = async (id: string, depth?: number, file = 'models/views/claims.bpmn') => {
  const found = new NeighbourhoodWalk(await Fixtures.read(file)).window(id, depth);
  return { ...found, ids: [...found.distances].map(([element, distance]) => [element.id, distance]) };
};

describe('NeighbourhoodWalk', () => {
  it('takes one flow step both ways by default, and carries the depth it used', async () => {
    const { depth, ids } = await window('Activity_Pay');

    expect(depth).toBe(1);
    expect(ids).toEqual([
      ['Activity_Pay', 0],
      ['Activity_SendDecision', 1],
      ['Gateway_Covered', 1],
    ]);
  });

  it('makes a boundary event and its host neighbours', async () => {
    expect((await window('Event_FraudSuspected', 1)).ids).toContainEqual(['Activity_Assess', 1]);
  });

  it('leaves a sub-process through its first and last nodes, and never enters one', async () => {
    expect((await window('Event_AssessStart', 1)).ids).toContainEqual(['Activity_Assess', 1]);
    expect((await window('Activity_Assess', 1)).ids.map(([id]) => id)).not.toContain('Event_AssessStart');
  });

  it('centres on both ends of a sequence flow', async () => {
    expect((await window('Flow_Covered', 0)).ids).toEqual([
      ['Gateway_Covered', 0],
      ['Activity_Pay', 0],
    ]);
  });

  it('makes link events of one name neighbours', async () => {
    expect((await window('LinkOut', 1, 'views/implementation.bpmn')).ids).toContainEqual(['LinkIn', 1]);
    expect((await window('LinkIn', 1, 'views/implementation.bpmn')).ids).toContainEqual(['LinkOut', 1]);
    expect((await window('LinkNameless', 1, 'views/implementation.bpmn')).ids).toHaveLength(1);
  });

  it.each([
    ['Pay claim', 1, 'E_NOT_FOUND'],
    ['Lane_Office', 1, 'E_USAGE'],
    ['Process_Claims', 1, 'E_USAGE'],
    ['Message_Claim', 1, 'E_USAGE'],
    ['Activity_Pay', -1, 'E_USAGE'],
    ['Activity_Pay', 1.5, 'E_USAGE'],
  ])('refuses --around %s with depth %d', async (id, depth, code) => {
    await expect(window(id, depth)).rejects.toMatchObject({ code });
  });

  it('points to --in for a whole container', async () => {
    await expect(window('Process_Claims')).rejects.toMatchObject({ details: { hint: expect.stringContaining('--in') } });
  });
});
