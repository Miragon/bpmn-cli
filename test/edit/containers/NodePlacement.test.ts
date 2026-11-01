import { describe, expect, it } from 'vitest';
import { NodePlacement, type PlacementOptions } from '../../../src/edit/containers/NodePlacement.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

const ORDER = 'edit/order-check.bpmn';
const ARTIFACTS = 'edit/containers-artifacts.bpmn';

async function place(placement: PlacementOptions, type = 'bpmn:Task', path = ORDER) {
  const session = new EditSession(await Fixtures.readForWrite(path));
  const node = session.document.tree.create(type, { id: 'node_new' });
  const changes = new ChangeSet();
  const entryFlow = new NodePlacement(session, placement).place(node, changes);
  return { session, node, changes, entryFlow, flows: session.document.flows };
}

describe('NodePlacement', () => {
  it.each<[PlacementOptions, string]>([
    [{ after: 'a', before: 'b' }, 'between'],
    [{ after: 'a' }, 'after'],
    [{ before: 'b' }, 'before'],
    [{ flow: 'f' }, 'flow'],
    [{ on: 't' }, 'on'],
    [{ in: 'p' }, 'in'],
    [{}, 'none'],
  ])('reads %j as one placement mode', (placement, mode) => {
    expect(NodePlacement.modeOf(placement)).toBe(mode);
  });

  it.each<[PlacementOptions, string]>([
    [{ after: 'inner_one' }, 'sub_inner'],
    [{ after: 'inner_one', before: 'inner_two' }, 'sub_inner'],
    [{ before: 'inner_two' }, 'sub_inner'],
    [{ on: 'inner_one' }, 'sub_inner'],
    [{ flow: 'flow_writeToRead' }, 'Process_main'],
    [{ in: 'sub_notes' }, 'sub_notes'],
  ])('finds the scope of %j in its anchor', async (placement, scope) => {
    const session = new EditSession(await Fixtures.readForWrite(ARTIFACTS));

    expect(new NodePlacement(session, placement).scope().id).toBe(scope);
  });

  it('takes the only process without a placement and refuses a guess among several', async () => {
    const order = new EditSession(await Fixtures.readForWrite(ORDER));
    const several = new EditSession(await Fixtures.readForWrite(ARTIFACTS));

    expect(new NodePlacement(order, {}).scope().id).toBe('Process_orderCheck');
    expect(() => new NodePlacement(several, {}).scope()).toThrow(expect.objectContaining({ code: 'E_AMBIGUOUS_SCOPE' }));
  });

  it('refuses an anchor of the wrong kind', async () => {
    const session = new EditSession(await Fixtures.readForWrite(ORDER));

    expect(() => new NodePlacement(session, { after: 'flow_checkToOk' }).scope()).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND' }));
    expect(() => new NodePlacement(session, { flow: 'check' }).scope()).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND' }));
  });

  it('declares a node in its scope without any flow', async () => {
    const { node, entryFlow, flows } = await place({ in: 'Process_orderCheck' });

    expect(node.parent?.id).toBe('Process_orderCheck');
    expect(entryFlow).toBeUndefined();
    expect(flows.incoming(node)).toEqual([]);
  });

  it('splices a node into the only flow after its anchor', async () => {
    const { node, changes, entryFlow, flows } = await place({ after: 'check' });

    expect(entryFlow?.get<BpmnElement>('sourceRef').id).toBe('check');
    expect(entryFlow?.get<BpmnElement>('targetRef')).toBe(node);
    expect(flows.outgoing(node).map((flow) => flow.get<BpmnElement>('targetRef').id)).toEqual(['gateway_ok']);
    expect(changes.changed[0]?.detail).toContain('check -> node_new (was -> gateway_ok)');
    expect(changes.notes).toEqual(['inserted between check and gateway_ok']);
  });

  it('writes the flow options on the flow into the spliced node', async () => {
    const { entryFlow } = await place({ after: 'check', flowName: 'checked' });

    expect(entryFlow?.name).toBe('checked');
  });

  it('branches a new node off a gateway', async () => {
    const { node, changes, entryFlow } = await place({ after: 'gateway_ok', flowName: 'maybe' });

    expect(entryFlow?.get<BpmnElement>('sourceRef').id).toBe('gateway_ok');
    expect(entryFlow?.get<BpmnElement>('targetRef')).toBe(node);
    expect(entryFlow?.name).toBe('maybe');
    expect(changes.created.map(({ kind }) => kind)).toContain('sequenceFlow');
    expect(changes.notes).toEqual(['appended after gateway_ok']);
  });

  it('appends a node after the last node of a path', async () => {
    const { entryFlow, changes } = await place({ after: 'send_order' }, 'bpmn:Task', 'edit/two-pools.bpmn');

    expect(entryFlow?.get<BpmnElement>('sourceRef').id).toBe('send_order');
    expect(changes.notes).toEqual(['appended after send_order']);
  });

  it('refuses to guess among the flows after a node with two', async () => {
    await expect(place({ after: 'write' }, 'bpmn:Task', ARTIFACTS)).rejects.toMatchObject({ code: 'E_HAS_SUCCESSOR', details: { element: 'write', candidates: ['flow_writeToRead', 'flow_writeToCall'] } });
  });

  it('prepends a node before a task without a way in', async () => {
    const { node, entryFlow, changes, flows } = await place({ before: 'notes_task', flowName: 'first' }, 'bpmn:Task', ARTIFACTS);

    expect(entryFlow).toBeUndefined();
    expect(flows.outgoing(node)[0]?.name).toBe('first');
    expect(changes.notes[0]).toBe('prepended before notes_task');
    expect(changes.notes[1]).toContain('--flow-name applied to');
    expect(changes.notes[1]).toContain('notes_task had no incoming flow');
  });

  it('prepends a node before a join gateway instead of guessing a path', async () => {
    const { node, changes, flows } = await place({ before: 'gateway_join', flowName: 'third' });

    expect(flows.outgoing(node)[0]?.get<BpmnElement>('targetRef').id).toBe('gateway_join');
    expect(changes.notes[1]).toContain('gateway_join is a join gateway');
  });

  it('prepends without a note on options when none were given', async () => {
    const { changes } = await place({ before: 'gateway_join' });

    expect(changes.notes).toEqual(['prepended before gateway_join']);
  });

  it('refuses to guess among the flows into a task with two', async () => {
    await expect(place({ before: 'twin_target' }, 'bpmn:Task', ARTIFACTS)).rejects.toMatchObject({ code: 'E_HAS_PREDECESSOR', details: { element: 'twin_target', candidates: ['flow_twinOne', 'flow_twinTwo'] } });
  });

  it('splices before a node with one way in', async () => {
    const { entryFlow, changes } = await place({ before: 'ship' });

    expect(entryFlow?.get<BpmnElement>('sourceRef').id).toBe('gateway_ok');
    expect(changes.notes).toEqual(['inserted between gateway_ok and ship']);
  });

  it('splices between two nodes and into a flow it is told', async () => {
    expect((await place({ after: 'check', before: 'gateway_ok' })).entryFlow?.get<BpmnElement>('sourceRef').id).toBe('check');
    expect((await place({ flow: 'flow_okToReject' })).entryFlow?.get<BpmnElement>('sourceRef').id).toBe('gateway_ok');
  });

  it('refuses a splice between nodes without a flow, or with two', async () => {
    await expect(place({ after: 'ship', before: 'reject' })).rejects.toMatchObject({ code: 'E_NO_FLOW', details: { element: 'ship', related: ['reject'] } });
    await expect(place({ after: 'twin_source', before: 'twin_target' }, 'bpmn:Task', ARTIFACTS)).rejects.toMatchObject({ code: 'E_AMBIGUOUS_FLOW', details: { candidates: ['flow_twinOne', 'flow_twinTwo'] } });
  });

  it('refuses a node that cannot pass a flow on, or take one in, in the middle of a flow', async () => {
    await expect(place({ flow: 'flow_okToShip' }, 'bpmn:EndEvent')).rejects.toMatchObject({ code: 'E_INVALID_PLACEMENT', message: expect.stringContaining('cannot have outgoing sequence flows') });
    await expect(place({ flow: 'flow_okToShip' }, 'bpmn:StartEvent')).rejects.toMatchObject({ code: 'E_INVALID_PLACEMENT', message: expect.stringContaining('cannot have incoming sequence flows') });
  });

  it('attaches a boundary event after the ones the host has', async () => {
    const { node, changes } = await place({ on: 'write' }, 'bpmn:BoundaryEvent', ARTIFACTS);
    const elements = node.parent!.list('flowElements').map(({ id }) => id);

    expect(node.get<BpmnElement>('attachedToRef').id).toBe('write');
    expect(elements.indexOf('node_new')).toBe(elements.indexOf('compensate_write') + 1);
    expect(changes.notes).toEqual(['attached to write']);
  });

  it('attaches the first boundary event of a host right behind it', async () => {
    const { node } = await place({ on: 'ship' }, 'bpmn:BoundaryEvent');
    const elements = node.parent!.list('flowElements').map(({ id }) => id);

    expect(elements.indexOf('node_new')).toBe(elements.indexOf('ship') + 1);
  });

  it('refuses to attach anything but a boundary event', async () => {
    await expect(place({ on: 'ship' })).rejects.toMatchObject({ code: 'E_INVALID_PLACEMENT', message: expect.stringContaining('--on attaches boundary events only') });
  });

  it('refuses a boundary event placed in the flow', async () => {
    await expect(place({ after: 'check' }, 'bpmn:BoundaryEvent')).rejects.toMatchObject({ code: 'E_INVALID_PLACEMENT', message: 'Boundary events must be placed with --on <activityId>' });
  });

  it('refuses a boundary event on a compensation handler', async () => {
    await expect(place({ on: 'undo_write' }, 'bpmn:BoundaryEvent', ARTIFACTS)).rejects.toMatchObject({ code: 'E_INVALID_HOST', details: { related: ['undo_write'] } });
  });

  it('refuses a boundary event on an event sub-process', async () => {
    await expect(place({ on: 'sub_onError' }, 'bpmn:BoundaryEvent', ARTIFACTS)).rejects.toMatchObject({ code: 'E_INVALID_HOST', message: expect.stringContaining('is an event sub-process') });
  });

  it('connects the new node to the target it names', async () => {
    const { node, changes, flows } = await place({ in: 'Process_main', to: 'read' }, 'bpmn:Task', ARTIFACTS);

    expect(flows.outgoing(node)[0]?.get<BpmnElement>('targetRef').id).toBe('read');
    expect(changes.warnings[0]).toMatchObject({ code: 'W_IMPLICIT_JOIN', element: 'read' });
  });

  it('does not warn when the target of "to" is a gateway or had no way in', async () => {
    expect((await place({ after: 'check', to: 'gateway_join' })).changes.warnings).toEqual([]);
    expect((await place({ in: 'Process_main', to: 'twin_source' }, 'bpmn:Task', ARTIFACTS)).changes.warnings).toEqual([]);
  });
});
