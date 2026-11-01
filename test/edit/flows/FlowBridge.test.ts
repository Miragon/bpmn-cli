import { describe, expect, it } from 'vitest';
import { FlowBridge } from '../../../src/edit/flows/FlowBridge.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';

async function open(command?: 'remove' | 'move') {
  const document = await Fixtures.readForWrite('edit/flows-bridge.bpmn');
  const changes = new ChangeSet();
  const bridge = new FlowBridge(new EditSession(document), changes, command);
  const element = (id: string) => document.tree.require(id);
  const exists = (id: string) => document.tree.has(id);
  return { bridge, changes, document, element, exists };
}

const codes = (changes: ChangeSet) => changes.warnings.map(({ code }) => code);
const targetOf = (flow: BpmnElement) => flow.get<BpmnElement>('targetRef').id;
const expressionOf = (flow: BpmnElement) => flow.get<BpmnElement | undefined>('conditionExpression')?.get('body');

describe('FlowBridge', () => {
  describe('bridgeNode', () => {
    it('joins the neighbours of a task, and the flow in takes over the name and condition of the flow out', async () => {
      const { bridge, changes, element, exists } = await open();

      bridge.bridgeNode(element('t_plain'), true);

      expect(exists('f_plainOut')).toBe(false);
      expect(targetOf(element('f_aPlain'))).toBe('t_afterPlain');
      expect(element('f_aPlain').name).toBe('done');
      expect(expressionOf(element('f_aPlain'))).toBe('${x}');
      expect(changes.changed).toEqual([expect.objectContaining({ id: 'f_aPlain', detail: 'gw_a -> t_afterPlain (bridged t_plain)' })]);
      expect(changes.removed.map(({ id }) => id)).toEqual(['f_plainOut']);
      expect(changes.notes).toEqual(['bridged: gw_a -> t_afterPlain']);
    });

    it('warns of the label and condition the flow in cannot take over', async () => {
      const { bridge, changes, element } = await open();

      bridge.bridgeNode(element('t_named'), true);

      expect(element('f_aNamed').name).toBe('in');
      expect(expressionOf(element('f_aNamed'))).toBe('${in}');
      expect(codes(changes)).toEqual(['W_LABEL_DROPPED', 'W_CONDITION_DROPPED']);
    });

    it('drops a condition rather than put it on a default flow, and says why', async () => {
      const { bridge, changes, element } = await open();

      bridge.bridgeNode(element('t_defaulted'), true);

      expect(expressionOf(element('f_aDefault'))).toBeUndefined();
      expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_CONDITION_DROPPED', related: ['f_aDefault'] })]);
    });

    it('carries the note line of the flow that goes onto the flow that stays', async () => {
      const { bridge, changes, element } = await open();

      bridge.bridgeNode(element('t_noted'), true);

      expect(element('association_out').get('targetRef')).toBe(element('f_noteIn'));
      expect(changes.changed.map(({ id }) => id)).toContain('association_out');
    });

    it('drops the flows of a node left without a bridge', async () => {
      const { bridge, changes, element, exists } = await open();

      bridge.bridgeNode(element('t_plain'), false);

      expect(exists('f_aPlain')).toBe(false);
      expect(exists('f_plainOut')).toBe(false);
      expect(changes.removed.map(({ id }) => id)).toEqual(['f_aPlain', 'f_plainOut']);
    });

    it('drops the flows of a node with two ways in, even with a bridge asked for', async () => {
      const { bridge, element, exists } = await open();

      bridge.bridgeNode(element('t_two'), true);

      expect(['f_twoIn1', 'f_twoIn2', 'f_twoOut'].filter(exists)).toEqual([]);
    });

    it('does not loop a gateway back onto itself, and says so', async () => {
      const { bridge, changes, element, exists } = await open();

      bridge.bridgeNode(element('t_mid'), true);

      expect(exists('f_backOut')).toBe(false);
      expect(exists('f_backIn')).toBe(false);
      expect(changes.notes).toEqual(['not bridged: gw_back is both predecessor and successor of t_mid and cannot loop back to itself']);
    });

    it('lets a task loop back to itself over the node between', async () => {
      const { bridge, element } = await open();

      bridge.bridgeNode(element('t_mid2'), true);

      expect(element('f_loopOut').get('targetRef')).toBe(element('t_loop'));
    });

    it('just drops the flow of a task that loops to itself', async () => {
      const { bridge, changes, element, exists } = await open();

      bridge.bridgeNode(element('t_self'), true);

      expect(exists('f_self')).toBe(false);
      expect(changes.removed.map(({ id }) => id)).toEqual(['f_self']);
      expect(changes.notes).toEqual([]);
    });

    it('refuses a bridge that would put a task behind an event-based gateway', async () => {
      const { bridge, element } = await open();

      expect(() => bridge.bridgeNode(element('catch_msg'), true)).toThrow(expect.objectContaining({ code: 'E_INVALID_BRIDGE', message: expect.stringContaining('Bridging catch_msg would connect the event-based gateway gw_wait to t_afterMsg'), details: expect.objectContaining({ related: ['gw_wait', 't_afterMsg'] }) }));
    });

    it('names a move in that refusal, and tells how to take the node out', async () => {
      const { bridge, element } = await open('move');

      expect(() => bridge.bridgeNode(element('catch_msg'), true)).toThrow(expect.objectContaining({ message: expect.stringContaining('Moving catch_msg'), details: expect.objectContaining({ hint: expect.stringContaining('A move always bridges its old place') }) }));
    });

    it('allows that bridge when the successor goes in the same remove', async () => {
      const { bridge, element } = await open();

      bridge.bridgeNode(element('catch_msg'), true, new Set(['catch_msg', 't_afterMsg']));

      expect(element('f_toMsg').get('targetRef')).toBe(element('t_afterMsg'));
    });

    it('allows a catch event to follow the gateway in place of the one that goes', async () => {
      const { bridge, element } = await open();

      bridge.bridgeNode(element('catch_timer'), true);

      expect(element('f_toTimer').get('targetRef')).toBe(element('catch_next'));
    });

    it('keeps a single incoming flow on a target of an event-based gateway', async () => {
      const { bridge, element } = await open();

      expect(() => bridge.bridgeNode(element('catch_sig'), true)).toThrow(expect.objectContaining({ code: 'E_INVALID_BRIDGE' }));
    });
  });

  describe('bridgeGroup', () => {
    it('joins what stands before and behind a moved chain and carries the condition over', async () => {
      const { bridge, changes, element, exists } = await open('move');

      bridge.bridgeGroup([element('t_group1'), element('t_group2')]);

      expect(exists('f_groupOut')).toBe(false);
      expect(targetOf(element('f_groupIn'))).toBe('t_groupAfter');
      expect(element('f_groupIn').name).toBe('onward');
      expect(element('f_groupIn').get<BpmnElement>('conditionExpression').parent).toBe(element('f_groupIn'));
      expect(changes.changed[0]).toEqual(expect.objectContaining({ detail: 't_groupBefore -> t_groupAfter (bridged t_group1, t_group2)' }));
    });

    it('keeps the id of the flow that left the group for the move to reuse', async () => {
      const { bridge, document, element } = await open('move');

      bridge.bridgeGroup([element('t_group1'), element('t_group2')]);

      expect(document.tree.has('f_groupOut')).toBe(false);
      expect(document.ids.registry.has('f_groupOut')).toBe(true);
    });

    it('leaves a group with more ways in or out unbridged', async () => {
      const { bridge, changes, element } = await open('move');

      bridge.bridgeGroup([element('t_left'), element('t_right')]);

      expect(changes.isEmpty).toBe(true);
    });

    it('leaves a gateway that would loop onto itself unbridged', async () => {
      const { bridge, changes, element } = await open('move');

      bridge.bridgeGroup([element('t_mid')]);

      expect(changes.isEmpty).toBe(true);
    });

    it('leaves a group whose neighbours sit in different scopes unbridged', async () => {
      const { bridge, changes, element } = await open('move');

      bridge.bridgeGroup([element('s_sub'), element('s_start')]);

      expect(changes.isEmpty).toBe(true);
    });

    it('refuses a group whose old place would put a task behind an event-based gateway, and names all of it', async () => {
      const { bridge, element } = await open('move');

      expect(() => bridge.bridgeGroup([element('catch_msg')])).toThrow(expect.objectContaining({ code: 'E_INVALID_BRIDGE', message: expect.stringContaining('Moving catch_msg would connect') }));
    });
  });
});
