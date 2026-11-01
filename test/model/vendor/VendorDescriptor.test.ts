import { describe, expect, it } from 'vitest';
import { CAMUNDA } from '../../../src/model/vendor/CamundaDescriptor.js';
import { VendorDescriptor } from '../../../src/model/vendor/VendorDescriptor.js';
import { ZEEBE } from '../../../src/model/vendor/ZeebeDescriptor.js';

describe('VendorDescriptor', () => {
  it('knows a BPMN type to be a kind of another, any type to be a kind of *, and an unknown type to be none', () => {
    expect(VendorDescriptor.typeIs('bpmn:UserTask', 'bpmn:Activity')).toBe(true);
    expect(VendorDescriptor.typeIs('bpmn:UserTask', 'bpmn:Gateway')).toBe(false);
    expect(VendorDescriptor.typeIs('bpmn:Imaginary', 'bpmn:Activity')).toBe(false);
    expect(VendorDescriptor.typeIs('bpmn:Imaginary', '*')).toBe(true);
  });

  it('reads only the namespaces its engine owns', () => {
    const camunda = 'http://camunda.org/schema/1.0/bpmn';
    const operaton = 'http://operaton.org/schema/1.0/bpmn';
    const zeebe = 'http://camunda.org/schema/zeebe/1.0';

    expect([CAMUNDA.reads(camunda), CAMUNDA.reads(operaton), CAMUNDA.reads(zeebe), CAMUNDA.reads(undefined)]).toEqual([true, true, false, false]);
    expect([ZEEBE.reads(zeebe), ZEEBE.reads(operaton)]).toEqual([true, false]);
  });

  it('finds a vendor attribute with or without its prefix and refuses the attribute of another vendor', () => {
    expect(CAMUNDA.attr('assignee')).toEqual({ name: 'camunda:assignee', type: 'String', owners: ['bpmn:UserTask'] });
    expect(CAMUNDA.attr('camunda:assignee')).toBe(CAMUNDA.attr('assignee'));
    expect(CAMUNDA.attr('zeebe:assignee')).toBeUndefined();
    expect(ZEEBE.attr('modelerTemplate')?.owners).toContain('bpmn:Process');
    expect(CAMUNDA.attrs().map((attribute) => attribute.name)).toContain('camunda:historyTimeToLive');
  });

  it('finds a vendor element type by its local name in either case and lists the names of all of them', () => {
    expect(CAMUNDA.type('inputOutput')?.name).toBe('camunda:inputOutput');
    expect(CAMUNDA.type('camunda:InputOutput')).toBe(CAMUNDA.type('inputOutput'));
    expect(CAMUNDA.type('zeebe:taskDefinition')).toBeUndefined();
    expect(ZEEBE.typeNames()).toContain('zeebe:taskDefinition');
    expect(ZEEBE.typeNames()).not.toContain('zeebe:Template');
  });

  it('tells the elements an extension may hold only once, with or without the prefix', () => {
    expect([CAMUNDA.isSingle('inputOutput'), CAMUNDA.isSingle('camunda:inputOutput'), CAMUNDA.isSingle('field')]).toEqual([true, true, false]);
    expect([ZEEBE.isSingle('taskDefinition'), ZEEBE.isSingle('zeebe:ioMapping'), ZEEBE.isSingle('input')]).toEqual([true, true, false]);
  });
});
