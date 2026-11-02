import { describe, expect, it } from 'vitest';
import { Fixtures } from '../../support/Fixtures.js';

describe('BpmnDocument', () => {
  it('reaches its reads in one step', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(document.scopes.scopeOf(document.tree.require('task_review'))?.id).toBe('Process_events');
    expect(document.flows.outgoing(document.tree.require('task_review'))).toHaveLength(1);
    expect(document.namespaces.prefixFor('http://www.omg.org/spec/BPMN/20100524/DI')).toBe('bpmndi');
    expect(document.flowRules.canStart(document.tree.require('task_review'))).toBe(true);
  });

  it('answers the platform from the file', async () => {
    expect((await Fixtures.read('model/c8-vendor.bpmn')).platform()).toBe('c8');
    expect((await Fixtures.read('model/c7-vendor.bpmn')).platform()).toBe('c7');
    expect((await Fixtures.read('model/events.bpmn')).platform()).toBe('none');
  });

  it('gives a new Camunda 7 process the default history time, once', async () => {
    const document = await Fixtures.read('model/c7-vendor.bpmn');
    const process = document.tree.build('bpmn:Process', { id: 'Process_new' });

    document.initProcess(process);
    process.attrs['camunda:historyTimeToLive'] = '5';
    document.initProcess(process);

    expect(process.attrs['camunda:historyTimeToLive']).toBe('5');
    expect(document.tree.processes()[0]!.attrs['camunda:historyTimeToLive']).toBe('30');
  });

  it('uses the operaton prefix in an Operaton-only file', async () => {
    const document = await Fixtures.read('model/operaton.bpmn');
    const process = document.tree.build('bpmn:Process', { id: 'Process_new' });

    document.initProcess(process);

    expect(process.attrs['operaton:historyTimeToLive']).toBe('180');
  });

  it('declares the namespace for the history time when the file lacks it', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const process = document.tree.build('bpmn:Process', { id: 'Process_new' });

    document.initProcess(process, 'c7');

    expect(document.tree.definitions.attrs['xmlns:camunda']).toBe('http://camunda.org/schema/1.0/bpmn');
    expect(process.attrs['camunda:historyTimeToLive']).toBe('180');
  });

  it('leaves a process alone outside Camunda 7', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');
    const process = document.tree.build('bpmn:Process', { id: 'Process_new' });

    document.initProcess(process);

    expect(Object.keys(process.attrs)).toEqual([]);
  });

  it('follows conventions it is given, else the defaults', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const first = document.idStyle;

    expect(first.declared).toBe(false);
    document.conventions = { prefixes: { 'bpmn:Task': 'T_' } };
    expect(document.idStyle.declared).toBe(true);
    expect(document.idStyle).toBe(document.idStyle);
    document.conventions = document.conventions;
    expect(document.ids.allocate({ key: 'task', name: 'Check' }).id).toBe('T_check');
  });

  it('keeps a decision link out of the reported import warnings of a file without an engine', async () => {
    const document = await Fixtures.read('edit/properties-decisions-bare.bpmn');

    expect(document.importWarnings).not.toEqual([]);
    expect(document.reportedImportWarnings).toEqual([]);
  });

  it('reports a decision link in a file for an engine, which refuses it', async () => {
    const document = await Fixtures.read('edit/properties-decisions.bpmn');

    expect(document.reportedImportWarnings).toEqual(document.importWarnings);
  });

  it('refuses to write a lossy import back unless forced', async () => {
    const document = await Fixtures.read('model/lossy.bpmn');

    expect(document.lossyImportWarnings.length).toBeGreaterThan(0);
    expect(() => document.assertLossless()).toThrow(expect.objectContaining({ code: 'E_IMPORT_LOSSY', category: 'io' }));
    expect(() => document.assertLossless({ force: true })).not.toThrow();
  });

  it('takes a clean import as lossless', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(() => document.assertLossless()).not.toThrow();
  });
});
