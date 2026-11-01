import { describe, expect, it } from 'vitest';
import { DocumentWriter } from '../../../src/model/document/DocumentWriter.js';
import { NewDocument } from '../../../src/model/document/NewDocument.js';

describe('NewDocument', () => {
  it('makes a plain executable process with the tool defaults', () => {
    const { tree } = new NewDocument().create('new.bpmn');

    expect(tree.definitions.id).toBe('Definitions_1');
    expect(tree.processes().map(({ id }) => id)).toEqual(['Process_1']);
    expect(tree.processes()[0]!.get('isExecutable')).toBe(true);
    expect(tree.definitions.get('targetNamespace')).toBe('http://bpmn.io/schema/bpmn');
  });

  it('speaks like the name it is given', () => {
    const { tree } = new NewDocument({ processName: 'Order to cash' }).create();

    expect(tree.processes()[0]!.id).toBe('orderToCash');
    expect(tree.definitions.id).toBe('definitions_orderToCash');
    expect(tree.processes()[0]!.name).toBe('Order to cash');
  });

  it('takes an explicit process id, the definitions speaking like it', () => {
    const { tree } = new NewDocument({ processId: 'Process_shipping', executable: false }).create();

    expect(tree.definitions.id).toBe('definitions_shipping');
    expect(tree.processes()[0]!.get('isExecutable')).toBe(false);
  });

  it('follows declared conventions for the process', () => {
    const document = new NewDocument({ conventions: { prefixes: { 'bpmn:Process': 'process_' } } }).create();

    expect(document.tree.processes()[0]!.id).toMatch(/^process_/);
    expect(document.conventions?.prefixes['bpmn:Process']).toBe('process_');
  });

  it('declares Camunda 8 with its platform and no history time', async () => {
    const document = new NewDocument({ target: 'camunda8' }).create();
    const xml = await new DocumentWriter().plain(document);

    expect(document.platform()).toBe('c8');
    expect(xml).toContain('xmlns:zeebe=');
    expect(xml).toContain('modeler:executionPlatform="Camunda Cloud"');
    expect(xml).not.toContain('historyTimeToLive');
  });

  it('declares Camunda 7 with the history time of the Modeler', async () => {
    const document = new NewDocument({ target: 'camunda7' }).create();
    const xml = await new DocumentWriter().plain(document);

    expect(document.platform()).toBe('c7');
    expect(xml).toContain('modeler:executionPlatform="Camunda Platform"');
    expect(xml).toContain('camunda:historyTimeToLive="180"');
  });

  it('declares nothing for no engine', async () => {
    const xml = await new DocumentWriter().plain(new NewDocument({ target: 'none' }).create());

    expect(xml).not.toContain('modeler:');
  });

  it('refuses an unknown target and a process id that is no NCName', () => {
    expect(() => new NewDocument({ target: 'camunda9' as never }).create()).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
    expect(() => new NewDocument({ processId: '1 bad' }).create()).toThrow(expect.objectContaining({ code: 'E_INVALID_ID' }));
    expect(() => NewDocument.assertTarget(undefined)).not.toThrow();
  });
});
