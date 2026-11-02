import { describe, expect, it } from 'vitest';
import { DeclaredNamespaces } from '../../../src/model/vendor/DeclaredNamespaces.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DeclaredNamespaces', () => {
  it('knows the BPMN namespace and the prefixes it can declare by itself', () => {
    expect(DeclaredNamespaces.BPMN).toBe('http://www.omg.org/spec/BPMN/20100524/MODEL');
    expect(Object.keys(DeclaredNamespaces.KNOWN)).toEqual(['camunda', 'operaton', 'zeebe', 'modeler', 'bioc', 'color', 'xsi']);
  });

  it('finds the prefix a file gave a namespace, and none for a namespace it did not declare', async () => {
    const { namespaces } = await Fixtures.read('model/c8-vendor.bpmn');

    expect(namespaces.prefixFor('http://camunda.org/schema/zeebe/1.0')).toBe('zeebe');
    expect(namespaces.prefixFor('http://camunda.org/schema/1.0/bpmn')).toBeUndefined();
  });

  it('declares a known prefix on the definitions with its namespace, and keeps a declaration the file already has', async () => {
    const { namespaces, tree } = await Fixtures.read('model/c8-vendor.bpmn');
    tree.definitions.attrs['xmlns:modeler'] = 'urn:the-files-own';

    namespaces.declare('camunda');
    namespaces.declare('modeler');

    expect(tree.definitions.attrs['xmlns:camunda']).toBe('http://camunda.org/schema/1.0/bpmn');
    expect(tree.definitions.attrs['xmlns:modeler']).toBe('urn:the-files-own');
  });

  it('declares an unknown prefix when given its namespace', async () => {
    const { namespaces, tree } = await Fixtures.read('model/events.bpmn');

    namespaces.declare('acme', 'urn:acme');

    expect(tree.definitions.attrs['xmlns:acme']).toBe('urn:acme');
  });

  it('refuses an unknown prefix without a namespace with E_UNKNOWN_NAMESPACE and lists the known ones', async () => {
    const { namespaces } = await Fixtures.read('model/events.bpmn');

    expect(() => namespaces.declare('acme')).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_NAMESPACE', message: 'Unknown namespace prefix "acme"', details: expect.objectContaining({ hint: expect.stringContaining('Known prefixes: camunda, operaton, zeebe, modeler, bioc, color, xsi') }) }));
  });

  it('resolves a prefix to the namespace the file declared, else to the known one, else to nothing', async () => {
    const { namespaces, tree } = await Fixtures.read('model/c8-vendor.bpmn');
    tree.definitions.attrs['xmlns:camunda'] = 'urn:the-files-own';

    expect([namespaces.uriOf('camunda'), namespaces.uriOf('operaton'), namespaces.uriOf('zeebe'), namespaces.uriOf('acme')]).toEqual(['urn:the-files-own', 'http://operaton.org/schema/1.0/bpmn', 'http://camunda.org/schema/zeebe/1.0', undefined]);
  });
});
