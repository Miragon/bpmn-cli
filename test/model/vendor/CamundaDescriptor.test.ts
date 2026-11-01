import { describe, expect, it } from 'vitest';
import { CAMUNDA } from '../../../src/model/vendor/CamundaDescriptor.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('CamundaDescriptor', () => {
  it('tells which element an attribute belongs to, by element or by type, and nothing about an attribute it does not know', async () => {
    const document = await Fixtures.read('model/c7-vendor.bpmn');
    const form = document.tree.require('task_form');
    const rule = document.tree.require('task_rule');

    expect([CAMUNDA.attrAppliesTo('assignee', form), CAMUNDA.attrAppliesTo('assignee', rule), CAMUNDA.attrAppliesTo('decisionRef', rule)]).toEqual([true, false, true]);
    expect([CAMUNDA.attrAppliesTo('assignee', 'bpmn:UserTask'), CAMUNDA.attrAppliesTo('assignee', 'bpmn:ServiceTask')]).toEqual([true, false]);
    expect(CAMUNDA.attrAppliesTo('shoeSize', form)).toBeUndefined();
  });

  it('lists the attributes a business rule task may carry, and not those of a user task', async () => {
    const document = await Fixtures.read('model/c7-vendor.bpmn');

    const names = CAMUNDA.attrsFor(document.tree.require('task_rule')).map((attribute) => attribute.name);

    expect(names).toEqual(expect.arrayContaining(['camunda:decisionRef', 'camunda:asyncBefore', 'camunda:topic']));
    expect(names).not.toContain('camunda:assignee');
    expect(CAMUNDA.attrsFor('bpmn:UserTask').map((attribute) => attribute.name)).toContain('camunda:assignee');
  });

  it('allows an extension element where the schema puts it, anywhere for a wildcard, and says nothing about an unknown element', async () => {
    const document = await Fixtures.read('model/c7-vendor.bpmn');

    expect([CAMUNDA.allowedOn('inputOutput', 'bpmn:ServiceTask'), CAMUNDA.allowedOn('formData', 'bpmn:ServiceTask'), CAMUNDA.allowedOn('formData', document.tree.require('task_form'))]).toEqual([true, false, true]);
    expect(CAMUNDA.allowedOn('properties', 'bpmn:Process')).toBe(true);
    expect(CAMUNDA.allowedOn('executionListener', 'bpmn:SequenceFlow')).toBe(true);
    expect(CAMUNDA.allowedOn('shoeSize', 'bpmn:Task')).toBeUndefined();
  });

  it('lists the BPMN types an extension element may sit in', () => {
    expect(CAMUNDA.allowedParents('formData')).toEqual(['bpmn:StartEvent', 'bpmn:UserTask']);
    expect(CAMUNDA.allowedParents('shoeSize')).toEqual([]);
  });

  it('lists the extension elements that contain another one, through its super types as well', () => {
    expect(CAMUNDA.containersOf('inputParameter')).toEqual(['camunda:inputOutput']);
    expect(CAMUNDA.containersOf('formField')).toEqual(['camunda:formData']);
    expect(CAMUNDA.containersOf('field')).toEqual(['camunda:executionListener', 'camunda:taskListener']);
    expect(CAMUNDA.containersOf('shoeSize')).toEqual([]);
  });

  it('lists the attributes that reference an id', () => {
    expect(CAMUNDA.idReferenceAttrs()).toEqual([{ element: 'camunda:errorEventDefinition', attr: 'errorRef', target: 'bpmn:Error' }]);
  });
});
