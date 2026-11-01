import { describe, expect, it } from 'vitest';
import { ExtensionStructure } from '../../../src/edit/extensions/ExtensionStructure.js';

const structure = ExtensionStructure.INSTANCE;

describe('ExtensionStructure', () => {
  it('knows the elements the engines read only inside a container', () => {
    expect(structure.isNestedOnly('camunda:inputParameter')).toBe(true);
    expect(structure.isNestedOnly('operaton:constraint')).toBe(true);
    expect(structure.isNestedOnly('camunda:formData')).toBe(false);
    expect(structure.isNestedOnly('zeebe:input')).toBe(false);
  });

  it('files a child into its one container, from the top level and from a path', () => {
    expect(structure.homeAt('camunda:inputParameter', undefined)).toBe('camunda:inputOutput');
    expect(structure.homeAt('operaton:inputParameter', undefined)).toBe('operaton:inputOutput');
    expect(structure.homeAt('camunda:connectorId', undefined)).toBe('camunda:connector');
    expect(structure.homeAt('zeebe:input', undefined)).toBe('zeebe:ioMapping');
    expect(structure.homeAt('camunda:inputParameter', 'camunda:connector')).toBe('camunda:inputOutput');
  });

  it('leaves an element at a level that holds it, and one without a single home', () => {
    expect(structure.homeAt('camunda:inputParameter', 'camunda:inputOutput')).toBeUndefined();
    expect(structure.homeAt('camunda:formData', undefined)).toBeUndefined();
    expect(structure.homeAt('camunda:formField', 'camunda:connector')).toBeUndefined();
    expect(structure.homeAt('camunda:value', undefined)).toBeUndefined();
  });

  it('creates containers on the way of a path, never an item that needs a key', () => {
    expect(structure.isCreatable('camunda:inputOutput')).toBe(true);
    expect(structure.isCreatable('camunda:failedJobRetryTimeCycle')).toBe(true);
    expect(structure.isCreatable('camunda:connectorId')).toBe(true);
    expect(structure.isCreatable('camunda:inputParameter')).toBe(false);
  });

  it('allows one of a single-instance type per level', () => {
    expect(structure.isSingle('camunda:inputOutput', undefined)).toBe(true);
    expect(structure.isSingle('camunda:executionListener', undefined)).toBe(false);
    expect(structure.isSingle('operaton:validation', 'operaton:formField')).toBe(true);
    expect(structure.isSingle('camunda:script', 'camunda:inputParameter')).toBe(false);
  });

  it('names the keys of an item, in the order that decides', () => {
    expect(structure.keysOf('operaton:property')).toEqual(['name', 'id']);
    expect(structure.keysOf('zeebe:input')).toEqual(['target']);
    expect(structure.keysOf('camunda:inputOutput')).toEqual([]);
  });

  it('keeps the order the engines read children in', () => {
    expect(structure.childOrder('operaton:inputOutput')).toEqual(['camunda:inputParameter', 'camunda:outputParameter']);
    expect(structure.childOrder('camunda:properties')).toBeUndefined();
  });

  it('tells a container that means nothing when empty', () => {
    expect(structure.isPureContainer('zeebe:ioMapping')).toBe(true);
    expect(structure.isPureContainer('camunda:connector')).toBe(false);
  });

  it('lists the containers of an item in its own family, without the parameter wrappers', () => {
    expect(structure.containersOf('operaton:script')).toContain('operaton:executionListener');
    expect(structure.containersOf('camunda:list').join()).not.toContain('inputOutputParameter');
  });

  it('builds the example path a misplaced item should have taken', () => {
    expect(structure.examplePath('camunda:constraint', structure.containersOf('camunda:constraint'))).toBe('camunda:formField[id=<id>]/camunda:validation/camunda:constraint');
    expect(structure.examplePath('camunda:value', structure.containersOf('camunda:value'))).toBe('camunda:formField[id=<id>]/camunda:value');
    expect(structure.examplePath('camunda:script', structure.containersOf('camunda:script'))).toBe('camunda:executionListener/camunda:script');
    expect(structure.examplePath('camunda:inputParameter', structure.containersOf('camunda:inputParameter'))).toBe('camunda:inputOutput/camunda:inputParameter');
  });
});
