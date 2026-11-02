import { describe, expect, it } from 'vitest';
import { PropertyCoercer } from '../../../src/edit/properties/PropertyCoercer.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import type { BpmnElement } from '../../support/ModelValues.js';

async function open(path = 'edit/properties-hosts.bpmn') {
  const document = await Fixtures.readForWrite(path);
  return { document, coercer: new PropertyCoercer(new EditSession(document)) };
}

function propertyOf(element: BpmnElement, name: string) {
  return element.descriptor.propertiesByName![name]!;
}

describe('PropertyCoercer', () => {
  it.each([['${ok}', true], [' #{ok} ', true], ['ok', false], ['${a} and ${b', false]])('tells an expression from a script: %s', (body, expression) => {
    expect(PropertyCoercer.isExpression(body)).toBe(expression);
  });

  it.each([['true', true], [' YES ', true], ['1', true], ['on', true], ['false', false], ['no', false], ['0', false], ['Off', false]])('reads %s as a boolean', async (value, expected) => {
    const { document } = await open();

    expect(PropertyCoercer.booleanOf(document.tree.require('task_plain'), 'isForCompensation', value)).toBe(expected);
  });

  it('refuses a boolean it cannot read', async () => {
    const { document } = await open();

    expect(() => PropertyCoercer.booleanOf(document.tree.require('task_plain'), 'isForCompensation', 'maybe')).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', details: expect.objectContaining({ hint: 'Use isForCompensation=true or isForCompensation=false.' }) }));
  });

  describe('coerce', () => {
    it('turns a value into what the property holds', async () => {
      const { document, coercer } = await open();
      const task = document.tree.require('task_plain');
      const gateway = document.tree.require('gateway_split');

      expect(coercer.coerce(task, propertyOf(task, 'name'), 'Review')).toBe('Review');
      expect(coercer.coerce(task, propertyOf(task, 'isForCompensation'), 'yes')).toBe(true);
      expect(coercer.coerce(task, propertyOf(task, 'startQuantity'), '-2')).toBe(-2);
      expect(coercer.coerce(gateway, propertyOf(gateway, 'gatewayDirection'), 'diverging')).toBe('Diverging');
    });

    it('turns a reference into the element it names', async () => {
      const { document, coercer } = await open();
      const flow = document.tree.require('flow_plain');

      expect(coercer.coerce(flow, propertyOf(flow, 'sourceRef'), 'gateway_split')).toBe(document.tree.require('gateway_split'));
    });

    it('refuses what is no integer and no literal, under the label it is given', async () => {
      const { document, coercer } = await open();
      const task = document.tree.require('task_plain');
      const gateway = document.tree.require('gateway_split');

      expect(() => coercer.coerce(task, propertyOf(task, 'startQuantity'), '1.5', 'loop.startQuantity')).toThrow(expect.objectContaining({ message: expect.stringContaining('Invalid value for loop.startQuantity on task_plain: "1.5" is not an integer') }));
      expect(() => coercer.coerce(gateway, propertyOf(gateway, 'gatewayDirection'), 'sideways')).toThrow(expect.objectContaining({ message: expect.stringContaining('is not one of Unspecified|Converging|Diverging|Mixed') }));
    });
  });

  describe('vendor values', () => {
    it('normalises a Camunda boolean and leaves the rest', async () => {
      const { document, coercer } = await open();
      const task = document.tree.require('task_plain');

      expect(coercer.vendorValue(task, 'camunda:asyncBefore', 'yes')).toBe('true');
      expect(coercer.vendorValue(task, 'camunda:assignee', 'yes')).toBe('yes');
      expect(coercer.vendorValue(task, 'zeebe:modelerTemplate', 'yes')).toBe('yes');
      expect(coercer.vendorValue(task, 'camunda:asyncBefore', '')).toBe('');
    });

    it('writes an attribute, declares its namespace and removes it again', async () => {
      const { document, coercer } = await open('edit/properties-decisions-bare.bpmn');
      const task = document.tree.require('task_new');

      coercer.setVendorAttribute(task, 'camunda:asyncBefore', 'true');
      expect(task.attrs['camunda:asyncBefore']).toBe('true');
      expect(document.tree.definitions.attrs['xmlns:camunda']).toBe('http://camunda.org/schema/1.0/bpmn');

      coercer.setVendorAttribute(task, 'camunda:asyncBefore', '');
      expect(task.attrs).not.toHaveProperty('camunda:asyncBefore');
    });

    it('tells the engine a key belongs to from its prefix', async () => {
      const { coercer } = await open();

      expect(coercer.camundaLocal('camunda:class')).toBe('class');
      expect(coercer.camundaLocal('zeebe:retries')).toBeUndefined();
      expect(coercer.camundaLocal('plain')).toBeUndefined();
      expect(coercer.zeebeLocal('zeebe:retries')).toBe('retries');
      expect(coercer.zeebeLocal('camunda:class')).toBeUndefined();
      expect(coercer.zeebeLocal(':retries')).toBeUndefined();
    });
  });

  describe('script resources', () => {
    it('knows a script resource key under a prefix of Camunda or Operaton', async () => {
      const { coercer } = await open();

      expect(coercer.isResourceKey('camunda:resource')).toBe(true);
      expect(coercer.isResourceKey('camunda:class')).toBe(false);
      expect(coercer.isResourceKey('zeebe:resource')).toBe(false);
      expect((await open('model/operaton.bpmn')).coercer.isResourceKey('operaton:resource')).toBe(true);
    });

    it('finds the resource key of a condition, if it has one', async () => {
      const { document, coercer } = await open('edit/properties-flows.bpmn');
      const conditionOf = (id: string) => document.tree.require(id).get<BpmnElement>('conditionExpression');

      expect(coercer.resourceKeyOf(conditionOf('flow_resource'))).toBe('camunda:resource');
      expect(coercer.resourceKeyOf(conditionOf('flow_juel'))).toBeUndefined();
      expect(coercer.resourceKeyOf(undefined)).toBeUndefined();
    });
  });

  describe('setModelProperty', () => {
    it('sets a settable attribute and clears it with an empty value', async () => {
      const { document, coercer } = await open();
      const task = document.tree.require('task_plain');

      coercer.setModelProperty(task, 'startQuantity', '2');
      expect(task.get('startQuantity')).toBe(2);

      coercer.setModelProperty(task, 'isForCompensation', '');
      expect(task.get('isForCompensation')).toBe(false);
    });

    it('clears a stray attribute the file carries', async () => {
      const { document, coercer } = await open('model/c8-vendor.bpmn');
      const task = document.tree.require('task_own_link');

      coercer.setModelProperty(task, 'calledDecision', '');

      expect(task.attrs).not.toHaveProperty('calledDecision');
    });

    it.each([
      ['a key BPMN does not know', 'task_plain', 'nosuch', 'x', 'Unknown key "nosuch"'],
      ['clearing a key the element lacks', 'task_plain', 'nosuch', '', 'Unknown key "nosuch"'],
      ['the id', 'task_plain', 'id', 'x', 'Unknown key "id"'],
      ['a key another command owns', 'flow_plain', 'sourceRef', 'task_plain', 'use source=<nodeId>'],
      ['a list', 'task_plain', 'incoming', 'x', 'incoming is not an attribute'],
    ])('refuses %s', async (_case, id, key, value, message) => {
      const { document, coercer } = await open();

      expect(() => coercer.setModelProperty(document.tree.require(id), key, value)).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_KEY', message: expect.stringContaining(message) }));
    });
  });
});
