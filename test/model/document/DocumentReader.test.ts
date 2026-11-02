import { describe, expect, it } from 'vitest';
import { DocumentReader } from '../../../src/model/document/DocumentReader.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DocumentReader', () => {
  it('reads a file into a tree whose registry holds BPMN and DI ids', async () => {
    const document = await new DocumentReader().read(Fixtures.text('model/events.bpmn'), 'events.bpmn');

    expect(document.tree.definitions.is('bpmn:Definitions')).toBe(true);
    expect(document.file).toBe('events.bpmn');
    expect(document.ids.registry.has('task_review')).toBe(true);
    expect(document.ids.registry.has('task_review_di')).toBe(true);
    expect(document.source?.text).toBe(Fixtures.text('model/events.bpmn'));
  });

  it('refuses what is no BPMN with E_PARSE, naming the file', async () => {
    await expect(new DocumentReader().read('<<<', 'broken.bpmn')).rejects.toMatchObject({ code: 'E_PARSE', category: 'io', details: expect.objectContaining({ file: 'broken.bpmn' }) });
  });

  it('completes the flow lists in memory and remembers what the file listed', async () => {
    const document = await Fixtures.read('models/roundtrip/listless.bpmn');
    const flow = document.tree.processes().flatMap((process) => document.flows.sequenceFlows(process))[0]!;

    expect(document.source?.mirror.listed.size).toBe(0);
    expect(document.flows.outgoing(flow.get('sourceRef'))).toContain(flow);
  });

  it('serialises the text as read only for a write', async () => {
    const read = await new DocumentReader().read(Fixtures.text('model/events.bpmn'));
    const forWrite = await new DocumentReader().readForWrite(Fixtures.text('model/events.bpmn'));

    expect(read.source?.asRead).toBeUndefined();
    expect(forWrite.source?.asRead).toContain('bpmn:definitions');
  });

  it('keeps the import warnings', async () => {
    const document = await Fixtures.read('model/lossy.bpmn');

    expect(document.importWarnings.length).toBeGreaterThan(0);
  });
});
