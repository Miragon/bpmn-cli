import { describe, expect, it } from 'vitest';
import { Fixtures } from '../../support/Fixtures.js';
import { DataAssociationEnds } from '../../support/ModelValues.js';

async function crossScope() {
  const document = await Fixtures.read('layout/artifacts__04b-data-crossscope.bpmn');
  return (id: string) => document.tree.require(id);
}

describe('DataAssociationEnds', () => {
  it('names the node and the data of an input and an output', async () => {
    const element = await crossScope();
    const input = new DataAssociationEnds(element('DataInputAssociation_4'));
    const output = new DataAssociationEnds(element('DataOutputAssociation_1'));

    expect([input.node?.id, input.data?.id]).toEqual(['Activity_Score', 'DataObjectReference_App']);
    expect([output.node?.id, output.data?.id]).toEqual(['Activity_Score', 'DataObjectReference_Score']);
  });

  it('hides the inner end behind a collapsed sub-process the data is outside of', async () => {
    const element = await crossScope();

    expect(new DataAssociationEnds(element('DataInputAssociation_4')).hiddenEnd(() => true)).toEqual({ end: element('Activity_Score'), subProcess: element('Activity_Sub') });
  });

  it('hides nothing behind an expanded sub-process', async () => {
    const element = await crossScope();

    expect(new DataAssociationEnds(element('DataInputAssociation_4')).hiddenEnd(() => false)).toBeUndefined();
  });

  it('hides nothing when both ends sit in the same collapsed sub-process', async () => {
    const element = await crossScope();

    expect(new DataAssociationEnds(element('DataOutputAssociation_1')).hiddenEnd(() => true)).toBeUndefined();
  });

  it('skips a sub-process the check finds expanded', async () => {
    const element = await crossScope();
    const subProcess = element('Activity_Sub');

    expect(DataAssociationEnds.collapsedAround(element('Activity_Score'), element('DataObjectReference_App'), (scope) => scope !== subProcess)).toBeUndefined();
  });
});
