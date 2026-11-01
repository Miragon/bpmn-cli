import { type BpmnElement, BpmnError, type ChangeSet, ElementLabels, Kinds, Triggers } from '../../model/index.js';
import { RootElements } from '../events/RootElements.js';
import type { EditSession } from '../session/EditSession.js';

export interface MessageFlowRequest {
  id?: string | undefined;
  name?: string | undefined;
  message?: string | undefined;
}

export class MessageFlows {
  constructor(private readonly edit: EditSession) {}

  private static describe(element: BpmnElement): string {
    return `${element.id} (${Kinds.label(element)})`;
  }

  private static eventRefusal(event: BpmnElement, role: 'source' | 'target'): { why: string; hint: string } | undefined {
    const trigger = Triggers.of(event);
    if (trigger !== 'none' && trigger !== 'message') {
      return { why: `a ${trigger} event cannot ${role === 'source' ? 'send' : 'receive'} messages`, hint: 'Use a message or untyped event.' };
    }
    if (role === 'source' && !event.is('bpmn:ThrowEvent')) {
      return { why: 'catching events cannot send messages', hint: 'Use a throw event, end event or send task as source.' };
    }
    if (role === 'target' && !event.is('bpmn:CatchEvent')) {
      return { why: 'throwing events cannot receive messages', hint: 'Use a catch event, start event or receive task as target.' };
    }
    return undefined;
  }

  private static refusalOf(element: BpmnElement, role: 'source' | 'target'): { why: string; hint: string } | undefined {
    if (!element.is('bpmn:InteractionNode')) {
      return { why: 'not an interaction node', hint: 'Message flows connect participants, tasks, events and sub-processes; not gateways or data.' };
    }
    if (Kinds.isEventSubProcess(element)) {
      return { why: 'event sub-processes cannot send or receive messages', hint: 'Target a message start event inside it instead.' };
    }
    return element.is('bpmn:Event') ? MessageFlows.eventRefusal(element, role) : undefined;
  }

  private static assertEndpoint(element: BpmnElement, role: 'source' | 'target'): void {
    const refusal = MessageFlows.refusalOf(element, role);
    if (refusal) {
      throw BpmnError.model('E_INVALID_ENDPOINT', `${MessageFlows.describe(element)} cannot be the ${role} of a message flow: ${refusal.why}`, { element: element.id, hint: refusal.hint });
    }
  }

  create(source: BpmnElement, target: BpmnElement, request: MessageFlowRequest, changes: ChangeSet): BpmnElement {
    const { document } = this.edit;
    const collaboration = this.requireCollaboration(source, target);
    MessageFlows.assertEndpoint(source, 'source');
    MessageFlows.assertEndpoint(target, 'target');
    this.assertDifferentPools(source, target);
    const id = this.edit.allocator.explicitOr(request.id, ElementLabels.flowRequest('bpmn:MessageFlow', source, target));
    const message = request.message ? new RootElements(this.edit).ensure('bpmn:Message', request.message) : undefined;
    if (message?.created) {
      const name = message.el.get<string | undefined>('name');
      changes.create({ id: message.el.id, kind: 'message', ...(name ? { name } : {}), detail: 'root element' });
    }
    const named = request.name ? { name: request.name } : {};
    const flow = document.tree.create('bpmn:MessageFlow', { id, ...named, sourceRef: source, targetRef: target, ...(message ? { messageRef: message.el } : {}) });
    collaboration.add('messageFlows', flow);
    changes.create({ id, kind: 'messageFlow', ...named, detail: `${source.id} -> ${target.id}` });
    document.tree.invalidate();
    return flow;
  }

  private requireCollaboration(source: BpmnElement, target: BpmnElement): BpmnElement {
    const collaboration = this.edit.document.tree.collaboration();
    if (!collaboration) {
      throw BpmnError.model('E_NO_COLLABORATION', 'Message flows need pools; the file has no collaboration', {
        element: source.id,
        related: [target.id],
        hint: 'Add participants first: `add participant "<name>"` wraps the existing process, a second one gets its own process.',
      });
    }
    return collaboration;
  }

  private participantFor(element: BpmnElement): BpmnElement | undefined {
    if (element.is('bpmn:Participant')) {
      return element;
    }
    const process = this.edit.document.scopes.processOf(element);
    return process ? this.edit.document.flows.participantOf(process) : undefined;
  }

  private requireParticipant(element: BpmnElement): BpmnElement {
    const participant = this.participantFor(element);
    if (!participant) {
      throw BpmnError.model('E_NO_PARTICIPANT', `${MessageFlows.describe(element)} is not inside a participant; message flows only connect pools`, {
        element: element.id,
        hint: 'Bind its process to a participant with `add participant "<name>" --process <processId>`.',
      });
    }
    return participant;
  }

  private assertDifferentPools(source: BpmnElement, target: BpmnElement): void {
    const pool = this.requireParticipant(source);
    if (pool === this.requireParticipant(target)) {
      throw BpmnError.model('E_SAME_POOL', `${source.id} and ${target.id} are in the same pool ${pool.id}; message flows connect different pools`, {
        element: source.id,
        related: [target.id],
        hint: 'Use a sequence flow inside a pool.',
      });
    }
  }
}
