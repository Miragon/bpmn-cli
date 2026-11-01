import { type BpmnElement, type ChangeSet, ElementText, Triggers } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export class EventGatewayRule {
  constructor(private readonly edit: EditSession) {}

  get rule(): 'engines' | 'bpmn' {
    return this.edit.platform() === 'c7' ? 'engines' : 'bpmn';
  }

  targetProblem(gateway: BpmnElement, target: BpmnElement, leaving: BpmnElement[] = []): string | undefined {
    return this.rule === 'engines' ? this.engineTargetProblem(gateway, target, leaving) : this.bpmnTargetProblem(gateway, target, leaving);
  }

  warnFlow(flow: BpmnElement, changes: ChangeSet): void {
    const gateway = flow.get<BpmnElement | undefined>('sourceRef');
    const target = flow.get<BpmnElement | undefined>('targetRef');
    if (!gateway || !target || !gateway.is('bpmn:EventBasedGateway') || this.rule === 'engines') {
      return;
    }
    const problem = this.bpmnTargetProblem(gateway, target, [flow]);
    if (!problem) {
      return;
    }
    changes.warn({
      code: 'W_EVENT_GATEWAY_TARGET',
      message: `Event-based gateway ${gateway.id} now leads to ${target.id} (${flow.id}): ${problem}`,
      element: gateway.id,
      related: [target.id, flow.id],
      hint: `Put a catch event in front of ${target.id}: \`bpmn add <file> intermediateCatchEvent:timer "<Name>" --flow ${flow.id} timer=PT1H\` (or :message message=<Name>), or remove the flow (\`bpmn remove <file> ${flow.id}\`).`,
    });
  }

  private otherIncoming(target: BpmnElement, leaving: BpmnElement[], what: string): string | undefined {
    const others = this.edit.document.flows.incoming(target).filter((flow) => !leaving.includes(flow));
    if (!others.length) {
      return undefined;
    }
    return `${ElementText.labelOf(target)} already has the incoming flow ${others.map((element) => element.id).join(', ')}; ${what} after an event-based gateway can have no other incoming flow`;
  }

  private otherBranchTargets(gateway: BpmnElement, target: BpmnElement, leaving: BpmnElement[]): BpmnElement[] {
    const targets: BpmnElement[] = [];
    for (const flow of this.edit.document.flows.outgoing(gateway)) {
      const flowTarget = flow.get<BpmnElement | undefined>('targetRef');
      if (!leaving.includes(flow) && flowTarget && flowTarget !== target) {
        targets.push(flowTarget);
      }
    }
    return targets;
  }

  private engineTargetProblem(gateway: BpmnElement, target: BpmnElement, leaving: BpmnElement[]): string | undefined {
    if (!target.is('bpmn:IntermediateCatchEvent')) {
      return `${ElementText.labelOf(target)} is not an intermediate catch event; an event-based gateway can only lead to message, timer, signal or conditional catch events`;
    }
    const trigger = Triggers.of(target) ?? 'none';
    if (!Triggers.EVENT_GATEWAY_TRIGGERS.includes(trigger)) {
      return `${ElementText.labelOf(target)} is a ${trigger === 'none' ? 'plain' : trigger} catch event; an event-based gateway can only wait for a message, timer, signal or condition`;
    }
    return this.otherIncoming(target, leaving, 'a catch event') ?? this.duplicateSubscription(gateway, target, leaving);
  }

  private duplicateSubscription(gateway: BpmnElement, target: BpmnElement, leaving: BpmnElement[]): string | undefined {
    const mine = EventGatewayRule.subscriptionOf(target);
    if (!mine) {
      return undefined;
    }
    for (const flowTarget of this.otherBranchTargets(gateway, target, leaving)) {
      const theirs = EventGatewayRule.subscriptionOf(flowTarget);
      if (theirs && theirs.kind === mine.kind && theirs.name === mine.name) {
        return `${flowTarget.id} on another branch of ${gateway.id} already waits for the ${mine.kind} "${mine.name}"; the engines allow one subscription per ${mine.kind} name and gateway`;
      }
    }
    return undefined;
  }

  private bpmnTargetProblem(gateway: BpmnElement, target: BpmnElement, leaving: BpmnElement[]): string | undefined {
    const receive = target.is('bpmn:ReceiveTask');
    if (!receive && !target.is('bpmn:IntermediateCatchEvent')) {
      return `${ElementText.labelOf(target)} is neither an intermediate catch event nor a receive task; BPMN 2.0 lets an event-based gateway lead only to message, timer, signal or conditional catch events and receive tasks`;
    }
    const definitions = receive ? undefined : EventGatewayRule.catchDefinitionProblem(target);
    return definitions ?? this.otherIncoming(target, leaving, receive ? 'a receive task' : 'a catch event') ?? this.receiveBoundaryProblem(target, receive) ?? this.mixedWaitProblem(gateway, target, leaving, receive);
  }

  private static catchDefinitionProblem(target: BpmnElement): string | undefined {
    const defs = target.get<BpmnElement[] | undefined>('eventDefinitions') ?? [];
    const allowed = ['bpmn:MessageEventDefinition', 'bpmn:TimerEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:ConditionalEventDefinition'];
    if (defs.length && defs.every((definition) => allowed.some((allowedType) => definition.is(allowedType)))) {
      return undefined;
    }
    const trigger = Triggers.of(target) ?? 'none';
    return `${ElementText.labelOf(target)} is a ${trigger === 'none' ? 'plain' : trigger} catch event; after an event-based gateway BPMN 2.0 allows message, timer, signal and conditional catch events only`;
  }

  private receiveBoundaryProblem(target: BpmnElement, receive: boolean): string | undefined {
    if (!receive) {
      return undefined;
    }
    const boundaries = this.edit.document.scopes.boundaryEventsOf(target);
    if (!boundaries.length) {
      return undefined;
    }
    return `${ElementText.labelOf(target)} has boundary events (${boundaries.map((element) => element.id).join(', ')}); BPMN 2.0 does not allow them on a receive task after an event-based gateway`;
  }

  private mixedWaitProblem(gateway: BpmnElement, target: BpmnElement, leaving: BpmnElement[], receive: boolean): string | undefined {
    if (!receive && !EventGatewayRule.waitsForMessage(target)) {
      return undefined;
    }
    for (const flowTarget of this.otherBranchTargets(gateway, target, leaving)) {
      if (receive ? EventGatewayRule.waitsForMessage(flowTarget) : flowTarget.is('bpmn:ReceiveTask')) {
        return `${flowTarget.id} on another branch of ${gateway.id} is a ${receive ? 'message catch event' : 'receive task'}; BPMN 2.0 does not mix receive tasks and message catch events behind one event-based gateway`;
      }
    }
    return undefined;
  }

  private static subscriptionOf(event: BpmnElement): { kind: 'message' | 'signal'; name: string } | undefined {
    const trigger = Triggers.of(event);
    if (trigger !== 'message' && trigger !== 'signal') {
      return undefined;
    }
    const def = (event.get<BpmnElement[] | undefined>('eventDefinitions') ?? [])[0];
    const ref = def?.get<BpmnElement | undefined>(trigger === 'message' ? 'messageRef' : 'signalRef');
    if (!ref) {
      return undefined;
    }
    return { kind: trigger, name: ref.get<string | undefined>('name') ?? ref.id };
  }

  private static waitsForMessage(el: BpmnElement): boolean {
    return el.is('bpmn:IntermediateCatchEvent') && (el.get<BpmnElement[] | undefined>('eventDefinitions') ?? []).some((definition) => definition.is('bpmn:MessageEventDefinition'));
  }
}
