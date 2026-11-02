import { describe, expect, it } from 'vitest';
import type { BpmnElement } from '../../../src/model/document/BpmnElement.js';
import { DocumentNamespaces } from '../../../src/model/vendor/DocumentNamespaces.js';
import { Fixtures } from '../../support/Fixtures.js';

const ZEEBE = 'http://camunda.org/schema/zeebe/1.0';
const MODELER = 'http://camunda.org/schema/modeler/1.0';

describe('DocumentNamespaces', () => {
  it('finds the prefix of a declared namespace and whether a namespace is declared at all', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');

    const namespaces = new DocumentNamespaces(document.tree.definitions);

    expect([namespaces.prefixOf(ZEEBE), namespaces.declares(ZEEBE)]).toEqual(['zeebe', true]);
    expect([namespaces.prefixOf('http://camunda.org/schema/1.0/bpmn'), namespaces.declares('http://camunda.org/schema/1.0/bpmn')]).toEqual([undefined, false]);
  });

  it('resolves the namespace of a prefixed name, but not of a plain name, an xmlns declaration or an unknown prefix', async () => {
    const namespaces = new DocumentNamespaces((await Fixtures.read('model/c8-vendor.bpmn')).tree.definitions);

    expect(namespaces.uriOfName('zeebe:taskDefinition')).toBe(ZEEBE);
    expect(namespaces.uriOfName('camunda:assignee')).toBe('http://camunda.org/schema/1.0/bpmn');
    expect([namespaces.uriOfName('isExecutable'), namespaces.uriOfName('xmlns:zeebe'), namespaces.uriOfName('acme:thing'), namespaces.uriOfName(':thing')]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('resolves the namespace of an extension element from its descriptor, and of a BPMN element from its type', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');
    const task = document.tree.require('task_worker');
    const namespaces = new DocumentNamespaces(document.tree.definitions);

    expect(namespaces.uriOfElement(task.get<BpmnElement>('extensionElements').list('values')[0]!)).toBe(ZEEBE);
    expect(namespaces.uriOfElement(task)).toBe('http://www.omg.org/spec/BPMN/20100524/MODEL');
  });

  it('counts how often each namespace is used by attributes and extension elements', async () => {
    const c8 = new DocumentNamespaces((await Fixtures.read('model/c8-vendor.bpmn')).tree.definitions);
    const c7 = new DocumentNamespaces((await Fixtures.read('model/c7-vendor.bpmn')).tree.definitions);

    expect(c8.usage()).toEqual(new Map([[MODELER, 2], [ZEEBE, 4]]));
    expect(c7.usage().get('http://camunda.org/schema/1.0/bpmn')).toBe(6);
  });

  it('reads the execution platform the modeler wrote, and none from a file without one', async () => {
    const declared = new DocumentNamespaces((await Fixtures.read('model/c8-vendor.bpmn')).tree.definitions);
    const undeclared = new DocumentNamespaces((await Fixtures.read('model/events.bpmn')).tree.definitions);

    expect([declared.executionPlatform(), undeclared.executionPlatform()]).toEqual(['Camunda Cloud', undefined]);
  });

  it('ignores an executionPlatform attribute of a namespace that is not the modeler', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    document.tree.definitions.attrs['xmlns:acme'] = 'urn:acme';
    document.tree.definitions.attrs['acme:executionPlatform'] = 'Camunda Cloud';

    expect(new DocumentNamespaces(document.tree.definitions).executionPlatform()).toBeUndefined();
  });
});
