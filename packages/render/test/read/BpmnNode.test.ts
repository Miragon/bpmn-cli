import { describe, expect, it } from 'vitest';
import { BpmnNode } from '../../src/read/BpmnNode.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('BpmnNode', () => {
  const gallery = 'models/render/gallery.bpmn';

  it('wraps no value that is not an object', () => {
    expect(BpmnNode.of(undefined)).toBeUndefined();
    expect(BpmnNode.of('Task_A')).toBeUndefined();
  });

  it('tells a user task from a gateway and knows its id, type and parent', async () => {
    const { element } = await CorpusModel.shape(gallery, 'Activity_UserTask');
    expect(element.is('bpmn:Activity')).toBe(true);
    expect(element.is('bpmn:Gateway')).toBe(false);
    expect([element.id, element.type, element.parent?.id]).toEqual(['Activity_UserTask', 'bpmn:UserTask', 'Process_RenderGallery']);
  });

  it('never counts an object without moddle methods as a kind', () => {
    expect(BpmnNode.of({ $type: 'bpmn:Task' })?.is('bpmn:Task')).toBe(false);
    expect(BpmnNode.of({ $type: 'bpmn:Task' })?.attribute('name')).toBeUndefined();
  });

  it('follows a reference to the flow a gateway takes by default', async () => {
    const { element } = await CorpusModel.shape(gallery, 'Gateway_WhichPath');
    const flow = element.ref('default');
    expect(flow?.id).toBe('Flow_WhichPathToRejected');
    expect(flow?.sameAs(element.ref('default'))).toBe(true);
    expect(flow?.sameAs(element)).toBe(false);
  });

  it('reads a list a task does not have as empty, without creating it', async () => {
    const { element } = await CorpusModel.shape(gallery, 'Activity_UserTask');
    expect(element.list('eventDefinitions')).toEqual([]);
    expect(element.value('eventDefinitions')).toBeUndefined();
  });

  it('reads a colour attribute of a foreign namespace', async () => {
    const { di } = await CorpusModel.shape(gallery, 'Gateway_WhichPath');
    expect(di.attribute('bioc:stroke')).toBe('#0d4372');
  });

  it('walks the tree and leaves out what it is told to skip', async () => {
    const { element } = await CorpusModel.shape(gallery, 'Activity_ExpandedSubProcess');
    const ids = [...element.tree((node) => node.is('bpmn:SequenceFlow'))].map((node) => node.id);
    expect(ids).toContain('Activity_InnerTask');
    expect(ids.some((id) => id?.startsWith('Flow_'))).toBe(false);
  });

  it('visits an element once, even when two parents hold it', async () => {
    const { element } = await CorpusModel.shape(gallery, 'Activity_ExpandedSubProcess');
    const twice = BpmnNode.of({ $type: 'x', $descriptor: { properties: [{ name: 'a' }, { name: 'b' }] }, a: element.value('flowElements'), b: element.value('flowElements') }) as BpmnNode;
    const ids = [...twice.tree(() => false)].map((node) => node.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
