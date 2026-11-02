import { describe, expect, it } from 'vitest';
import { BpmnSchema } from '../../../../src/checks/camunda/values/BpmnSchema.js';
import { EngineRows } from '../../../support/EngineRows.js';

describe('BpmnSchema', () => {
  const schema = new BpmnSchema(EngineRows.moddle(), EngineRows.bpmnUri());

  it('knows that a user task is an activity', () => {
    expect(schema.isA('bpmn:UserTask', 'bpmn:Activity')).toBe(true);
    expect(schema.isA('bpmn:UserTask', 'bpmn:Event')).toBe(false);
  });

  it('finds the BPMN type of an element in the file', () => {
    expect(schema.typeOf('userTask', EngineRows.bpmnUri(), undefined)).toBe('bpmn:UserTask');
    expect(schema.descriptor('bpmn:NoSuchType')).toBeUndefined();
  });

  it('lists the attributes the schema types as xsd:boolean', () => {
    expect(schema.booleanAttrs('bpmn:Process')).toContain('isExecutable');
  });

  it('orders the children of a process by the slots of the schema', () => {
    const slots = schema.slotsOf('bpmn:Process');

    expect(slots.get('laneSet')!).toBeLessThan(slots.get('userTask') ?? slots.get('flowElement') ?? Number.MAX_VALUE);
  });
});
