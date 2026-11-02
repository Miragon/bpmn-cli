import { describe, expect, it } from 'vitest';
import { ExtensionLister } from '../../../src/views/facts/ExtensionLister.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ExtensionLister', () => {
  it('numbers the extension elements as ext remove takes them', async () => {
    const document = await Fixtures.read('views/implementation.bpmn');

    const listed = new ExtensionLister().list(document.tree.require('Charge'));

    expect(listed.map(({ index, type }) => [index, type])).toEqual([
      [0, 'zeebe:taskDefinition'],
      [1, 'zeebe:ioMapping'],
      [2, 'zeebe:taskHeaders'],
    ]);
    expect(listed[0]?.attrs).toEqual({ type: 'charge-card', retries: '3' });
  });

  it('lists nothing for a task without extension elements', async () => {
    const document = await Fixtures.read('views/implementation.bpmn');

    expect(new ExtensionLister().list(document.tree.require('Plain'))).toEqual([]);
  });

  it('reads an element it has no descriptor for, with attributes, body and children', async () => {
    const document = await Fixtures.read('models/views/claims.bpmn');

    const [inputOutput] = new ExtensionLister().list(document.tree.require('Activity_CheckPolicy'));

    expect(inputOutput).toMatchObject({ index: 0, type: 'camunda:inputOutput', children: [{ type: 'camunda:inputParameter', attrs: { name: 'policyId' }, body: '${policyId}' }, { type: 'camunda:outputParameter', attrs: { name: 'covered' } }] });
  });

  it('adds the extensions of nested elements with their slot', async () => {
    const document = await Fixtures.read('views/implementation.bpmn');

    const all = new ExtensionLister().listAll(document.tree.require('Charge'));

    expect(all.at(-1)).toMatchObject({ index: 0, slot: 'loop', type: 'zeebe:loopCharacteristics', attrs: { inputCollection: '=items' } });
  });
});
