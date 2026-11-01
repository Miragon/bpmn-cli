import { describe, expect, it } from 'vitest';
import { ElementAddress } from '../../../../src/checks/camunda/rules/ElementAddress.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('ElementAddress', () => {
  it('addresses an element by its own id', async () => {
    const { tree } = await Fixtures.read('engine/structure/cancel-boundary-on-a-task.bpmn');

    expect(ElementAddress.of(tree.require('T'), undefined)).toEqual(new ElementAddress('T', ''));
  });

  it('addresses an event definition through its event, by index among several', async () => {
    const { tree } = await Fixtures.read('engine/structure/event-with-two-definitions.bpmn');
    const event = tree.require('Start');
    const [first, second] = event.list('eventDefinitions');

    expect(ElementAddress.of(first!, event)).toEqual(new ElementAddress('Start', 'definition[0].'));
    expect(ElementAddress.of(second!, event)).toEqual(new ElementAddress('Start', 'definition[1].'));
  });

  it('addresses the one event definition without an index', async () => {
    const { tree } = await Fixtures.read('engine/structure/cancel-boundary-on-a-task.bpmn');
    const event = tree.require('B');

    expect(ElementAddress.of(event.list('eventDefinitions')[0]!, event)).toEqual(new ElementAddress('B', 'definition.'));
  });
});
