import { describe, expect, it } from 'vitest';
import { ElementLabels } from '../../../src/model/kinds/ElementLabels.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ElementLabels', () => {
  async function labelsOf(id: string, path = 'model/speaking-ids.bpmn'): Promise<ElementLabels> {
    return new ElementLabels((await Fixtures.read(path)).tree.require(id));
  }

  it.each([
    ['task_Check', 'Check'],
    ['task_AfterCheck', 'AfterCheck'],
    ['gateway_AfterCheckJoin', 'Check Join'],
    ['Activity_0f3k9d2', 'Task'],
    ['Gateway_0a1b2c3', 'Gateway'],
    ['Event_0a1b2c3', 'Timer'],
    ['flow_0f3k9d2', 'Flow'],
    ['Association_0a1b2c3', 'Association'],
    ['Activity_1x2y3z4', 'Pay bill'],
  ])('calls the element %s "%s"', async (id, label) => {
    expect((await labelsOf(id)).label()).toBe(label);
  });

  it('calls an element by its speaking id even when it has a name', async () => {
    expect((await labelsOf('task_review', 'model/events.bpmn')).label()).toBe('review');
  });

  it('calls a text annotation by its id, its text or its type', async () => {
    expect(await Promise.all(['note_Hint', 'Annotation_0f3k9d2', 'TextAnnotation_1a2b3c4'].map(async (id) => (await labelsOf(id)).label()))).toEqual(['Hint', 'Ask the customer', 'TextAnnotation']);
  });

  it('puts a word before the label to tell where an element is', async () => {
    const labels = await labelsOf('task_Check');

    expect([labels.context('After'), labels.context('Before'), labels.context('On'), labels.context('In')]).toEqual(['After Check', 'Before Check', 'On Check', 'In Check']);
  });

  it('names the kind of an unnamed anchor in the context after it, and drops the word it already holds', async () => {
    expect((await labelsOf('task_AfterCheck')).anchorContext('After')).toEqual({ context: 'After Check', anchorKind: 'Task' });
    expect((await labelsOf('gateway_AfterCheck')).anchorContext('Before')).toEqual({ context: 'Before Gateway AfterCheck' });
    expect((await labelsOf('gateway_AfterCheckJoin')).anchorContext('After')).toEqual({ context: 'After Check Join', anchorKind: 'Gateway' });
  });

  it('keeps the plain label as the context of an element with a name or a hash id', async () => {
    expect((await labelsOf('Activity_1x2y3z4')).anchorContext('After')).toEqual({ context: 'After Pay bill' });
    expect((await labelsOf('Activity_0f3k9d2')).anchorContext('On')).toEqual({ context: 'On Task' });
  });

  it('remembers the kind word a context-like id was built from, and Join for a join gateway', async () => {
    expect(await Promise.all(['task_AfterCheck', 'gateway_AfterCheck', 'gateway_AfterCheckJoin', 'task_Check'].map(async (id) => (await labelsOf(id)).formerLabels()))).toEqual([['Task'], ['Gateway'], ['Join'], []]);
  });

  it('asks for the id of a flow by the labels of both ends and keeps the name of the flow', async () => {
    const document = await Fixtures.read('model/speaking-ids.bpmn');
    const source = document.tree.require('task_Check');
    const target = document.tree.require('task_Pay');
    const unspoken = document.tree.require('Activity_0f3k9d2');

    expect(ElementLabels.flowRequest('bpmn:SequenceFlow', source, target, 'ok')).toEqual({ key: 'bpmn:SequenceFlow', source: 'task_Check', target: 'task_Pay', name: 'ok', sourceLabel: 'Check', targetLabel: 'Pay' });
    expect(ElementLabels.flowRequest('bpmn:MessageFlow', unspoken, target)).toEqual({ key: 'bpmn:MessageFlow', source: 'Activity_0f3k9d2', target: 'task_Pay', sourceLabel: 'Task', targetLabel: 'Pay' });
  });
});
