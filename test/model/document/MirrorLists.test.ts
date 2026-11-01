import { describe, expect, it } from 'vitest';
import type { BpmnElement } from '../../../src/model/document/BpmnElement.js';
import { MirrorLists } from '../../../src/model/document/MirrorLists.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('MirrorLists', () => {
  it('leaves nothing to complete after a read, and keeps a file that listed its flows', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const mirror = new MirrorLists(tree.definitions);

    expect(mirror.complete()).toBe(0);
    expect(mirror.unkept(mirror.snapshot())).toEqual([]);
  });

  it('completes the lists a file left out', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const task = document.tree.require('task_send');
    const flow = document.tree.require('flow_yes');
    task.remove('incoming', flow);

    expect(new MirrorLists(document.tree.definitions).complete()).toBe(1);
    expect(task.list('incoming')).toEqual([flow]);
  });

  it('keeps out of the file what a file without lists never had', async () => {
    const document = await Fixtures.read('models/roundtrip/listless.bpmn');
    const mirror = new MirrorLists(document.tree.definitions);

    const unkept = mirror.unkept(document.source!.mirror);

    expect(unkept.length).toBeGreaterThan(0);
    expect(unkept.every(({ flow }) => flow.is('bpmn:SequenceFlow'))).toBe(true);
  });

  it('writes an entry of a new flow into a file that lists, but not of an untouched node without lists', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const { tree } = document;
    const mirror = new MirrorLists(tree.definitions);
    const flow = tree.build('bpmn:SequenceFlow', { id: 'flow_new', sourceRef: tree.require('task_send'), targetRef: tree.require('end_plain') });
    tree.require('Process_events').add('flowElements', flow);
    const snapshot = document.source!.mirror;

    mirror.complete();

    expect(mirror.unkept(snapshot)).toEqual([]);
  });

  it('drops an entry that a re-ended flow took along from a node that listed nothing', async () => {
    const document = await Fixtures.read('models/roundtrip/listless.bpmn');
    const flow = document.flows.allSequenceFlows()[0]!;
    const source = flow.get<BpmnElement>('sourceRef');
    const mirror = new MirrorLists(document.tree.definitions);

    const kept = mirror.unkept(document.source!.mirror).filter(({ node, direction }) => node === source && direction === 'outgoing');

    expect(kept.map((entry) => entry.flow)).toContain(flow);
  });

  it('hides entries while it reads, and puts them back where they were', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const gateway = document.tree.require('gateway_choice');
    const flow = document.tree.require('flow_yes');
    const mirror = new MirrorLists(document.tree.definitions);

    const seen = await mirror.without([{ node: gateway, direction: 'outgoing', flow }], async () => gateway.list('outgoing').map(({ id }) => id));

    expect(seen).toEqual(['flow_no']);
    expect(gateway.list('outgoing').map(({ id }) => id)).toEqual(['flow_yes', 'flow_no']);
  });

  it('skips an entry that is not there and restores after a failed read', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const gateway = document.tree.require('gateway_choice');
    const flow = document.tree.require('flow_yes');
    const stranger = document.tree.require('flow_send');
    const mirror = new MirrorLists(document.tree.definitions);
    const entries = [{ node: gateway, direction: 'outgoing' as const, flow }, { node: gateway, direction: 'outgoing' as const, flow: stranger }];

    await expect(mirror.without(entries, () => Promise.reject(new Error('failed')))).rejects.toThrow('failed');

    expect(gateway.list('outgoing')).toContain(flow);
    expect(gateway.list('outgoing')).not.toContain(stranger);
  });
});
