import { describe, expect, it } from 'vitest';
import { C7DescriptorNames } from '../../../../src/checks/camunda/values/C7DescriptorNames.js';
import { EngineRows } from '../../../support/EngineRows.js';

describe('C7DescriptorNames', () => {
  const names = new C7DescriptorNames();

  it('lists the attributes of a camunda type, those of its BPMN super types too', () => {
    const attributes = names.attrNames(EngineRows.camundaType('errorEventDefinition'));

    expect(attributes).toContain('expression');
    expect(attributes).toContain('errorRef');
  });

  it('lists the children a camunda type takes as text', () => {
    expect(names.textChildNames(EngineRows.camundaType('field'))).toContain('string');
  });

  it('suggests only top-level types the descriptor knows', () => {
    expect(names.typeNames()).toContain('inputOutput');
    expect(names.typeNames()).not.toContain('noSuchType');
  });
});
