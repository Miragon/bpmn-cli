import { describe, expect, it } from 'vitest';
import { MoveAnchors } from '../../../src/edit/containers/MoveAnchors.js';
import type { PlacementOptions } from '../../../src/edit/containers/NodePlacement.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

const ORDER = 'edit/order-check.bpmn';
const LANES = 'edit/containers-lanes.bpmn';
const ARTIFACTS = 'edit/containers-artifacts.bpmn';

async function setUp(path = ORDER) {
  const session = new EditSession(await Fixtures.readForWrite(path));
  return { session, anchors: new MoveAnchors(session), nodes: (...ids: string[]) => ids.map((id) => session.require(id)) };
}

async function chainRefusal(path: string, ids: string[], placement: PlacementOptions) {
  const { anchors, nodes } = await setUp(path);
  try {
    anchors.assertChainAnchor(nodes(...ids), placement);
  } catch (error) {
    return error as Error & { details: { element: string; hint: string } };
  }
  return undefined;
}

describe('MoveAnchors', () => {
  it.each<[PlacementOptions, string]>([
    [{ after: 'a', before: 'b' }, 'between a and b'],
    [{ after: 'a' }, 'after a'],
    [{ before: 'b' }, 'before b'],
    [{ flow: 'f' }, 'into flow f'],
    [{ on: 't' }, 'onto t'],
    [{ in: 'p' }, 'into p'],
    [{}, 'into the process'],
  ])('words the placement %j', (placement, words) => {
    expect(MoveAnchors.describePlacement(placement)).toBe(words);
  });

  it('refuses to place a node relative to itself, what it holds, or its boundary event', async () => {
    const { session } = await setUp(LANES);
    const refusal = (node: string, anchor: string) => () => MoveAnchors.assertNotInside(session.require(node), session.require(anchor));

    expect(refusal('check', 'check')).toThrow(expect.objectContaining({ code: 'E_INVALID_PLACEMENT', message: expect.stringContaining('the node itself or one of its children') }));
    expect(refusal('sub_handle', 'sub_task')).toThrow(expect.objectContaining({ code: 'E_INVALID_PLACEMENT' }));
    expect(refusal('check', 'timer_check')).toThrow(expect.objectContaining({ message: expect.stringContaining('one of its boundary events') }));
    expect(refusal('check', 'pack')).not.toThrow();
  });

  it('moves a boundary event only with --on', async () => {
    const { session } = await setUp(LANES);

    expect(() => MoveAnchors.assertNotBoundary(session.require('timer_check'))).toThrow(expect.objectContaining({ code: 'E_INVALID_PLACEMENT' }));
    expect(() => MoveAnchors.assertNotBoundary(session.require('check'))).not.toThrow();
  });

  it.each<[string, PlacementOptions]>([
    ['after', { after: 'sub_task' }],
    ['before', { before: 'sub_task' }],
    ['on', { on: 'sub_task' }],
  ])('refuses a first node anchored %s what it holds', async (_mode, placement) => {
    const { anchors, session } = await setUp(LANES);

    expect(() => anchors.assertFirstPlacement(session.require('sub_handle'), placement)).toThrow(expect.objectContaining({ code: 'E_INVALID_PLACEMENT' }));
  });

  it('refuses a node moved into a flow of its own, or into itself', async () => {
    const { anchors, session } = await setUp(LANES);

    expect(() => anchors.assertFirstPlacement(session.require('check'), { flow: 'flow_startToCheck' })).toThrow(expect.objectContaining({ code: 'E_INVALID_PLACEMENT' }));
    expect(() => anchors.assertFirstPlacement(session.require('sub_handle'), { in: 'sub_handle' })).toThrow(expect.objectContaining({ code: 'E_INVALID_PLACEMENT' }));
    expect(() => anchors.assertFirstPlacement(session.require('pack'), { flow: 'flow_startToCheck' })).not.toThrow();
  });

  it('takes a chain whose anchor stays outside it', async () => {
    expect(await chainRefusal(ORDER, ['ship', 'reject'], { after: 'check' })).toBeUndefined();
    expect(await chainRefusal(ORDER, ['ship', 'reject'], { flow: 'flow_checkToOk' })).toBeUndefined();
  });

  it('refuses a chain anchored after one of its later nodes and offers the other way round', async () => {
    const refusal = await chainRefusal(ORDER, ['check', 'gateway_ok'], { after: 'startEvent_orderReceived' });
    expect(refusal).toBeUndefined();

    const placedAfterItself = await chainRefusal(ORDER, ['gateway_ok', 'check'], { after: 'check' });

    expect(placedAfterItself?.message).toBe('check cannot anchor the move of gateway_ok, check: it is one of the moved nodes');
    expect(placedAfterItself?.details.hint).toContain('The chain would be placed after itself. gateway_ok is already after check. Pick an anchor outside the moved nodes, or put gateway_ok before check: `bpmn move <file> gateway_ok --before check`.');
  });

  it('points to moving the first node alone when it is not there yet', async () => {
    const refusal = await chainRefusal(ORDER, ['ship', 'check'], { after: 'check' });

    expect(refusal?.details.hint).toBe('The chain would be placed after itself. Pick an anchor outside the moved nodes, or move ship alone: `bpmn move <file> ship --after check`.');
  });

  it('refuses a chain placed before a node inside one of its later nodes', async () => {
    const refusal = await chainRefusal(LANES, ['pack', 'sub_handle'], { after: 'ship', before: 'sub_task' });

    expect(refusal?.message).toBe('sub_task cannot anchor the move of pack, sub_handle: it is inside sub_handle, one of the moved nodes');
    expect(refusal?.details.hint).toContain('The chain would be placed inside itself.');
    expect(refusal?.details.hint).toContain('--after ship --before sub_task');
  });

  it('refuses a chain anchored on the boundary event of a later node', async () => {
    const refusal = await chainRefusal(LANES, ['pack', 'check'], { after: 'timer_check' });

    expect(refusal?.message).toContain('it is a boundary event of check, one of the moved nodes');
  });

  it('names the flow when its source is one of the later nodes', async () => {
    const refusal = await chainRefusal(ORDER, ['ship', 'check'], { flow: 'flow_checkToOk' });

    expect(refusal?.message).toBe('flow_checkToOk cannot anchor the move of ship, check: its source check is one of the moved nodes');
    expect(refusal?.details.element).toBe('flow_checkToOk');
    expect(refusal?.details.hint).toContain('--flow flow_checkToOk');
  });

  it('holds no anchor against a node that is the anchor of "before" itself', async () => {
    expect(await chainRefusal(ORDER, ['check', 'gateway_ok'], { before: 'gateway_ok' })).toBeUndefined();
  });

  it('finds a node already after its anchor in place', async () => {
    const { anchors, nodes } = await setUp();

    expect(anchors.inPlace(nodes('check'), { after: 'startEvent_orderReceived' })).toBe(true);
    expect(anchors.inPlace(nodes('check', 'gateway_ok'), { after: 'startEvent_orderReceived' })).toBe(true);
    expect(anchors.inPlace(nodes('ship'), { after: 'startEvent_orderReceived' })).toBe(false);
  });

  it('never calls a node after a gateway in place, for a move there adds a branch', async () => {
    const { anchors, nodes } = await setUp();

    expect(anchors.inPlace(nodes('ship'), { after: 'gateway_ok' })).toBe(false);
  });

  it('finds a node already before its anchor in place, unless the anchor is a join', async () => {
    const { anchors, nodes } = await setUp();

    expect(anchors.inPlace(nodes('check'), { before: 'gateway_ok' })).toBe(true);
    expect(anchors.inPlace(nodes('reject'), { before: 'gateway_join' })).toBe(false);
  });

  it('finds a node between its two neighbours in place', async () => {
    const { anchors, nodes } = await setUp();

    expect(anchors.inPlace(nodes('check'), { after: 'startEvent_orderReceived', before: 'gateway_ok' })).toBe(true);
    expect(anchors.inPlace(nodes('check'), { after: 'startEvent_orderReceived', before: 'ship' })).toBe(false);
  });

  it('never calls a boundary event, a repeated node, a broken chain or a move by flow in place', async () => {
    const lanes = await setUp(LANES);
    const order = await setUp();

    expect(lanes.anchors.inPlace(lanes.nodes('timer_check'), { after: 'check' })).toBe(false);
    expect(order.anchors.inPlace(order.nodes('check', 'check'), { after: 'startEvent_orderReceived' })).toBe(false);
    expect(order.anchors.inPlace(order.nodes('gateway_ok', 'ship'), { after: 'check' })).toBe(false);
    expect(order.anchors.inPlace(order.nodes('check', 'ship'), { after: 'startEvent_orderReceived' })).toBe(false);
    expect(order.anchors.inPlace(order.nodes('check'), { flow: 'flow_receivedToCheck' })).toBe(false);
  });

  it('finds no way in or out of a node with several', async () => {
    const { anchors, nodes } = await setUp(ARTIFACTS);

    expect(anchors.inPlace(nodes('end_main'), { after: 'read' })).toBe(false);
    expect(anchors.inPlace(nodes('write'), { before: 'read' })).toBe(false);
  });
});
