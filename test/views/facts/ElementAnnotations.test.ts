import { describe, expect, it } from 'vitest';
import { ElementAnnotations } from '../../../src/views/facts/ElementAnnotations.js';
import { Fixtures } from '../../support/Fixtures.js';

const claims = async () => {
  const document = await Fixtures.read('models/views/claims.bpmn');
  return { annotations: new ElementAnnotations(document), of: (id: string) => document.tree.require(id) };
};

describe('ElementAnnotations', () => {
  it('lists the annotations a collaboration owns with what they are attached to', async () => {
    const { annotations, of } = await claims();

    expect(annotations.in([of('Collaboration_Claims')])).toEqual([{ id: 'TextAnnotation_Sla', text: 'Answer within 5 days', attachedTo: [{ id: 'Activity_SendDecision', kind: 'sendTask', name: 'Send decision' }] }]);
  });

  it('finds the annotation at an element and the element at an annotation', async () => {
    const { annotations, of } = await claims();

    expect(annotations.at(of('Activity_Pay')).map(({ id }) => id)).toEqual(['TextAnnotation_Pay']);
    expect(annotations.attachedTo(of('TextAnnotation_Pay')).map(({ id }) => id)).toEqual(['Activity_Pay']);
    expect(annotations.at(of('Gateway_Covered'))).toEqual([]);
  });

  it('reads the text of an annotation', async () => {
    const { of } = await claims();

    expect(ElementAnnotations.textOf(of('TextAnnotation_Pay'))).toEqual({ id: 'TextAnnotation_Pay', text: 'Paid by bank transfer' });
  });
});
