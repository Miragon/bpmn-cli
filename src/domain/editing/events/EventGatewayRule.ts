import type { EditSession } from '../../document/EditSession.js';
import type { ChangeSet } from '../../document/ChangeSet.js';
import { EVENT_GATEWAY_TRIGGERS, triggerOf } from '../../document/Kinds.js';
import { is, type El, idOf } from '../../document/utils/moddle.js';
import { labelOf } from '../../document/utils/elements.js';

/**
 * Which targets an event-based gateway may lead to. Camunda 7 files follow the engines
 * (Camunda 7, CIB seven and Operaton reject the deployment otherwise): only message, timer,
 * signal or conditional catch events, no other incoming flow, no two waits for one name.
 * Other files follow BPMN 2.0 (10.6.6): receive tasks too, but not mixed with message events.
 */
export class EventGatewayRule {
  constructor(private readonly edit: EditSession) {}

  get rule(): 'engines' | 'bpmn' {
    return this.edit.platform() === 'c7' ? 'engines' : 'bpmn';
  }

  /** `leaving` are the flows that disappear with the change (e.g. the flow a bridge replaces). */
  targetProblem(gateway: El, target: El, leaving: El[] = []): string | undefined {
    return this.rule === 'engines' ? this.engineTargetProblem(gateway, target, leaving) : this.bpmnTargetProblem(gateway, target, leaving);
  }

  /**
   * An explicit edge is the agent's call and only warned about (a bridge is refused).
   * Camunda 7 files are left to the platform profile, which reports the engines' rule.
   */
  warnFlow(flow: El, changes: ChangeSet): void {
    const gateway = flow.get<El | undefined>('sourceRef');
    const target = flow.get<El | undefined>('targetRef');
    if (!gateway || !target || !is(gateway, 'bpmn:EventBasedGateway') || this.rule === 'engines') return;
    const problem = this.bpmnTargetProblem(gateway, target, [flow]);
    if (!problem) return;
    changes.warn({
      code: 'W_EVENT_GATEWAY_TARGET',
      message: `Event-based gateway ${idOf(gateway)} now leads to ${idOf(target)} (${idOf(flow)}): ${problem}`,
      element: idOf(gateway),
      related: [idOf(target), idOf(flow)],
      hint: `Put a catch event in front of ${idOf(target)}: \`bpmn add <file> intermediateCatchEvent:timer "<Name>" --flow ${idOf(flow)} --timer PT1H\` (or :message --message <Name>), or remove the flow (\`bpmn remove <file> ${idOf(flow)}\`).`,
    });
  }

  private otherIncoming(target: El, leaving: El[], what: string): string | undefined {
    const others = this.edit.doc.incoming(target).filter((flow) => !leaving.includes(flow));
    if (!others.length) return undefined;
    return `${labelOf(target)} already has the incoming flow ${others.map(idOf).join(', ')}; ${what} after an event-based gateway can have no other incoming flow`;
  }

  private engineTargetProblem(gateway: El, target: El, leaving: El[]): string | undefined {
    if (!is(target, 'bpmn:IntermediateCatchEvent')) {
      return `${labelOf(target)} is not an intermediate catch event; an event-based gateway can only lead to message, timer, signal or conditional catch events`;
    }
    const trigger = triggerOf(target) ?? 'none';
    if (!EVENT_GATEWAY_TRIGGERS.includes(trigger)) {
      return `${labelOf(target)} is a ${trigger === 'none' ? 'plain' : trigger} catch event; an event-based gateway can only wait for a message, timer, signal or condition`;
    }
    const incoming = this.otherIncoming(target, leaving, 'a catch event');
    if (incoming) return incoming;
    const mine = EventGatewayRule.subscriptionOf(target);
    if (mine) {
      for (const flow of this.edit.doc.outgoing(gateway)) {
        if (leaving.includes(flow)) continue;
        const flowTarget = flow.get<El | undefined>('targetRef');
        if (!flowTarget || flowTarget === target) continue;
        const theirs = EventGatewayRule.subscriptionOf(flowTarget);
        if (theirs && theirs.kind === mine.kind && theirs.name === mine.name) {
          return `${idOf(flowTarget)} on another branch of ${idOf(gateway)} already waits for the ${mine.kind} "${mine.name}"; the engines allow one subscription per ${mine.kind} name and gateway`;
        }
      }
    }
    return undefined;
  }

  private bpmnTargetProblem(gateway: El, target: El, leaving: El[]): string | undefined {
    const receive = is(target, 'bpmn:ReceiveTask');
    if (!receive && !is(target, 'bpmn:IntermediateCatchEvent')) {
      return `${labelOf(target)} is neither an intermediate catch event nor a receive task; BPMN 2.0 lets an event-based gateway lead only to message, timer, signal or conditional catch events and receive tasks`;
    }
    if (!receive) {
      const defs = target.get<El[] | undefined>('eventDefinitions') ?? [];
      const allowed = ['bpmn:MessageEventDefinition', 'bpmn:TimerEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:ConditionalEventDefinition'];
      if (!defs.length || defs.some((definition) => !allowed.some((allowedType) => is(definition, allowedType)))) {
        const trigger = triggerOf(target) ?? 'none';
        return `${labelOf(target)} is a ${trigger === 'none' ? 'plain' : trigger} catch event; after an event-based gateway BPMN 2.0 allows message, timer, signal and conditional catch events only`;
      }
    }
    const incoming = this.otherIncoming(target, leaving, receive ? 'a receive task' : 'a catch event');
    if (incoming) return incoming;
    if (receive && this.edit.doc.boundaryEventsOf(target).length) {
      return `${labelOf(target)} has boundary events (${this.edit.doc.boundaryEventsOf(target).map(idOf).join(', ')}); BPMN 2.0 does not allow them on a receive task after an event-based gateway`;
    }
    if (receive || EventGatewayRule.waitsForMessage(target)) {
      for (const flow of this.edit.doc.outgoing(gateway)) {
        if (leaving.includes(flow)) continue;
        const flowTarget = flow.get<El | undefined>('targetRef');
        if (!flowTarget || flowTarget === target) continue;
        if (receive ? EventGatewayRule.waitsForMessage(flowTarget) : is(flowTarget, 'bpmn:ReceiveTask')) {
          return `${idOf(flowTarget)} on another branch of ${idOf(gateway)} is a ${receive ? 'message catch event' : 'receive task'}; BPMN 2.0 does not mix receive tasks and message catch events behind one event-based gateway`;
        }
      }
    }
    return undefined;
  }

  /** The engines subscribe by message / signal name. */
  private static subscriptionOf(event: El): { kind: 'message' | 'signal'; name: string } | undefined {
    const trigger = triggerOf(event);
    if (trigger !== 'message' && trigger !== 'signal') return undefined;
    const def = (event.get<El[] | undefined>('eventDefinitions') ?? [])[0];
    const ref = def?.get<El | undefined>(trigger === 'message' ? 'messageRef' : 'signalRef');
    if (!ref) return undefined;
    return { kind: trigger, name: ref.get<string | undefined>('name') ?? idOf(ref) };
  }

  private static waitsForMessage(el: El): boolean {
    return is(el, 'bpmn:IntermediateCatchEvent') && (el.get<El[] | undefined>('eventDefinitions') ?? []).some((definition) => is(definition, 'bpmn:MessageEventDefinition'));
  }
}
