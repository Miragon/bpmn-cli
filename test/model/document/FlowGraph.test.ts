import { describe, expect, it } from 'vitest';
import { Fixtures } from '../../support/Fixtures.js';

describe('FlowGraph', () => {
  it('lists the sequence flows in and out of a node', async () => {
    const { tree, flows } = await Fixtures.read('model/events.bpmn');
    const gateway = tree.require('gateway_choice');

    expect(flows.incoming(gateway).map(({ id }) => id)).toEqual(['flow_choice']);
    expect(flows.outgoing(gateway).map(({ id }) => id)).toEqual(['flow_yes', 'flow_no']);
  });

  it('completes the flows of a file that never listed them', async () => {
    const { tree, flows } = await Fixtures.read('models/roundtrip/listless.bpmn');
    const flow = flows.sequenceFlows(tree.processes()[0]!)[0]!;

    expect(flows.outgoing(flow.get('sourceRef'))).toContain(flow);
    expect(tree.has(flow.id)).toBe(true);
  });

  it('lists the sequence flows of one scope', async () => {
    const { tree, flows } = await Fixtures.read('model/events.bpmn');

    expect(flows.sequenceFlows(tree.require('sub_adhoc'))).toEqual([]);
    expect(flows.sequenceFlows(tree.require('Process_events'))).toHaveLength(9);
  });

  it('finds participants and message flows of a collaboration, and the pool of a process', async () => {
    const { tree, flows } = await Fixtures.read('models/step1/two-pools.bpmn');
    const [first] = flows.participants();

    expect(flows.participants()).toHaveLength(2);
    expect(flows.participantOf(first!.get('processRef'))).toBe(first);
    expect(tree.collaboration()?.list('messageFlows')).toEqual(flows.messageFlows());
  });

  it('has no participants or message flows without a collaboration', async () => {
    const { flows } = await Fixtures.read('model/c7-vendor.bpmn');

    expect([flows.participants(), flows.messageFlows()]).toEqual([[], []]);
  });
});
