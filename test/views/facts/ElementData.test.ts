import { describe, expect, it } from 'vitest';
import { ElementData } from '../../../src/views/facts/ElementData.js';
import { Fixtures } from '../../support/Fixtures.js';

const claims = async () => {
  const document = await Fixtures.read('models/views/claims.bpmn');
  return { data: new ElementData(document), of: (id: string) => document.tree.require(id) };
};

describe('ElementData', () => {
  it('starts a data reference with nobody on either side', async () => {
    const { of } = await claims();

    expect(ElementData.empty(of('DataObjectReference_ClaimFile'))).toMatchObject({ kind: 'dataObject', from: [], to: [] });
  });

  it('reads what a node reads and writes', async () => {
    const { of } = await claims();

    expect(ElementData.of(of('Activity_Pay')).reads.map(({ id }) => id)).toEqual(['DataObjectReference_ClaimFile']);
    expect(ElementData.of(of('Activity_RateDamage')).writes.map(({ id }) => id)).toEqual(['DataObjectReference_ClaimFile']);
  });

  it('links data and nodes from both sides, and nothing without data', async () => {
    const { data, of } = await claims();

    expect(data.links(of('Activity_RateDamage'))).toMatchObject({ writes: [{ id: 'DataObjectReference_ClaimFile', name: 'Claim file' }] });
    expect(data.links(of('DataObjectReference_ClaimFile'))).toMatchObject({ readBy: [{ id: 'Activity_Pay' }], writtenBy: [{ id: 'Activity_RateDamage' }] });
    expect(data.links(of('Activity_Assess'))).toBeUndefined();
  });

  it('counts the flow nodes of a process, sub-processes included', async () => {
    const { data, of } = await claims();

    expect(data.nodesWithin(of('Process_Claims'))).toHaveLength(16);
  });
});
