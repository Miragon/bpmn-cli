import { describe, expect, it } from 'vitest';
import { ElementContainment } from '../../../src/edit/containers/ElementContainment.js';
import type { BpmnElement } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

const ARTIFACTS = 'edit/containers-artifacts.bpmn';

describe('ElementContainment', () => {
  it('tells data references from other elements', async () => {
    const document = await Fixtures.readForWrite(ARTIFACTS);

    expect(new ElementContainment(document.tree.require('ref_note')).isDataReference()).toBe(true);
    expect(new ElementContainment(document.tree.require('ref_archive')).isDataReference()).toBe(true);
    expect(new ElementContainment(document.tree.require('write')).isDataReference()).toBe(false);
  });

  it('finds the nearest element that can hold an artifact, and none above the roots', async () => {
    const document = await Fixtures.readForWrite(ARTIFACTS);

    expect(new ElementContainment(document.tree.require('inner_one')).artifactContainer()?.id).toBe('sub_inner');
    expect(new ElementContainment(document.tree.require('write')).artifactContainer()?.id).toBe('Process_main');
    expect(new ElementContainment(document.tree.definitions).artifactContainer()).toBeUndefined();
  });

  it('sees through the children of an extension element it has no type for', async () => {
    const document = await Fixtures.readForWrite(ARTIFACTS);
    const process = document.tree.require('Process_main');
    const extensions = process.get<BpmnElement>('extensionElements');
    const outer = extensions.list('values')[0]!;
    const inner = outer.list('$children')[0]!;

    expect(new ElementContainment(outer).contains(inner)).toBe(true);
    expect(new ElementContainment(inner).isAttachedTo(document.tree.definitions)).toBe(true);
    expect(new ElementContainment(inner).contains(outer)).toBe(false);
  });

  it('knows an element a removal took out of its parent is no longer attached', async () => {
    const document = await Fixtures.readForWrite(ARTIFACTS);
    const task = document.tree.require('notes_task');

    expect(new ElementContainment(task).isAttachedTo(document.tree.definitions)).toBe(true);
    new ElementContainment(task).detach();

    expect(new ElementContainment(task).isAttachedTo(document.tree.definitions)).toBe(false);
    expect(new ElementContainment(document.tree.build('bpmn:Task')).isAttachedTo(document.tree.definitions)).toBe(false);
  });

  it('puts a replacement where the element stood in its list', async () => {
    const document = await Fixtures.readForWrite(ARTIFACTS);
    const process = document.tree.require('Process_main');
    const position = process.list('flowElements').indexOf(document.tree.require('read'));
    const replacement = document.tree.create('bpmn:UserTask', { id: 'read_again' });

    const parent = new ElementContainment(document.tree.require('read')).detach(replacement);

    expect(parent).toBe(process);
    expect(process.list('flowElements')[position]).toBe(replacement);
    expect(replacement.parent).toBe(process);
  });

  it('replaces a single child in its property and clears it without a replacement', async () => {
    const document = await Fixtures.readForWrite(ARTIFACTS);
    const process = document.tree.require('Process_main');
    const extensions = process.get<BpmnElement>('extensionElements');
    const replacement = document.tree.build('bpmn:ExtensionElements');

    new ElementContainment(extensions).detach(replacement);
    expect(process.get<BpmnElement>('extensionElements')).toBe(replacement);

    new ElementContainment(replacement).detach();
    expect(process.get<BpmnElement>('extensionElements')).toBeUndefined();
  });

  it('answers undefined for an element without a parent and the parent for one its list lost', async () => {
    const document = await Fixtures.readForWrite(ARTIFACTS);
    const task = document.tree.require('notes_task');
    const parent = task.parent!;
    parent.remove('flowElements', task);

    expect(new ElementContainment(document.tree.build('bpmn:Task')).detach()).toBeUndefined();
    expect(new ElementContainment(task).detach()).toBe(parent);
  });

  it('lists the references to a target, one by one, in single and many properties', async () => {
    const document = await Fixtures.readForWrite(ARTIFACTS);
    const check = document.tree.require('read');

    const references = new ElementContainment(document.tree.definitions).referencesToAny(new Set([check]));

    expect(references.map(({ holder, prop, isMany }) => [holder.id, prop, isMany])).toEqual(expect.arrayContaining([['flow_writeToRead', 'targetRef', false], ['association_note', 'targetRef', false]]));
  });

  it('finds the nearest element with an id above one without', async () => {
    const document = await Fixtures.readForWrite(ARTIFACTS);
    const process = document.tree.require('Process_main');

    expect(new ElementContainment(process.get<BpmnElement>('extensionElements')).nearestWithId()).toBe(process);
    expect(new ElementContainment(document.tree.build('bpmn:ExtensionElements')).nearestWithId()).toBeUndefined();
  });
});
