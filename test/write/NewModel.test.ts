import { describe, expect, it } from 'vitest';
import { NewModel } from '../../src/write/NewModel.js';

describe('NewModel', () => {
  it('writes one executable process with an empty plane', async () => {
    const xml = await new NewModel({ id: 'Process_order', name: 'Order' }).xml();

    expect(xml).toContain('<bpmn:process id="Process_order" name="Order" isExecutable="true" />');
    expect(xml).toContain('<bpmndi:BPMNPlane id="BPMNPlane_Process_order" bpmnElement="Process_order" />');
  });

  it('declares the engine of a target', async () => {
    expect(await new NewModel({ target: 'camunda8' }).xml()).toContain('modeler:executionPlatform="Camunda Cloud"');
  });

  it('makes a business draft of the target none: not executable', async () => {
    expect(await new NewModel({ target: 'none' }).xml()).toContain('isExecutable="false"');
  });

  it('refuses a process id that is no XML name', async () => {
    await expect(new NewModel({ id: '1 process' }).xml()).rejects.toMatchObject({ code: 'E_INVALID_ID' });
  });
});
