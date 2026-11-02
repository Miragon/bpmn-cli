import { describe, expect, it } from 'vitest';
import { ElementText } from '../../../src/model/kinds/ElementText.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ElementText', () => {
  it('lists the attributes of a vendor element', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const input = document.tree.buildAny('zeebe:input', 'http://camunda.org/schema/zeebe/1.0', { source: '=a' });

    expect(ElementText.ownEntries(input).filter(([property]) => property === 'source')).toEqual([['source', '=a']]);
  });

  it('shows the id of an element and a question mark when there is no element', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(ElementText.shownId(document.tree.require('task_review'))).toBe('task_review');
    expect(ElementText.shownId(undefined)).toBe(ElementText.UNKNOWN_ID);
  });

  it('labels an element by its kind, its id and its name when it has one', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const labelOf = (id: string): string => ElementText.labelOf(document.tree.require(id));

    expect(['task_review', 'boundary_late', 'start_timer'].map(labelOf)).toEqual(['userTask task_review "Review order"', 'boundaryEvent:error boundary_late', 'startEvent:timer start_timer "Every hour"']);
  });

  it('reads the vendor attributes of an element and none from a model without any', async () => {
    const c7 = await Fixtures.read('model/c7-vendor.bpmn');
    const c8 = await Fixtures.read('model/c8-vendor.bpmn');

    expect(ElementText.vendorAttributes(c7.tree.require('task_form'))).toEqual({ 'camunda:assignee': 'alice', 'camunda:formKey': 'review' });
    expect(ElementText.vendorAttributes(c8.tree.require('Process_c8'))).toEqual({});
  });

  it('lists what vendors put on an element: attributes, extension elements and documentation', async () => {
    const c7 = await Fixtures.read('model/c7-vendor.bpmn');
    const c8 = await Fixtures.read('model/c8-vendor.bpmn');
    const events = await Fixtures.read('model/events.bpmn');

    expect(ElementText.vendorContent(c7.tree.require('task_form'))).toEqual(['camunda:assignee', 'camunda:formKey', 'camunda:inputOutput']);
    expect(ElementText.vendorContent(c8.tree.require('task_worker'))).toEqual(['zeebe:taskDefinition', 'zeebe:ioMapping']);
    expect(ElementText.vendorContent(events.tree.require('start_timer'))).toEqual(['documentation']);
    expect(ElementText.vendorContent(c8.tree.require('Process_c8'))).toEqual([]);
  });
});
