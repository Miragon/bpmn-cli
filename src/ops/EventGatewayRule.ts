/**
 * Which targets an event-based gateway may lead to, by the rule the file
 * follows (rule): Camunda 7 files follow the engines (Camunda 7, CIB seven and
 * Operaton each reject the deployment otherwise):
 *  - only an intermediateCatchEvent with a message, timer, signal or
 *    conditional trigger (not a receive task, task, end or throw event, plain
 *    or link catch event);
 *  - it has no other incoming sequence flow (also not a second one from the
 *    gateway);
 *  - no two branches wait for the same message name or signal name.
 *
 * Every other file follows BPMN 2.0 (10.6.6, Event-Based Gateway):
 *  - an intermediateCatchEvent whose triggers are message, timer, signal or
 *    conditional, or a receive task (without boundary events);
 *  - no other incoming sequence flow;
 *  - message catch events and receive tasks are not mixed behind one gateway.
 */
import type { Doc } from '../model/Doc.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { triggerOf } from '../model/utils/kinds.js';
import { is, type El, idOf } from '../model/utils/moddle.js';
import { labelOf } from './utils/elements.js';

/** Triggers an event-based gateway may wait for (an intermediate catch event with one of them). */
const EVENT_GATEWAY_TRIGGERS = ['message', 'timer', 'signal', 'conditional'];

export class EventGatewayRule {
  constructor(private readonly doc: Doc) {}

  /** Which rule the file follows: the Camunda 7 engines' (a Camunda 7 / CIB seven / Operaton file) or BPMN 2.0's. */
  get rule(): 'engines' | 'bpmn' {
    return this.doc.platform() === 'camunda7' ? 'engines' : 'bpmn';
  }

  /**
   * Why `target` cannot become the target of a new sequence flow from the
   * event-based gateway `gateway` (undefined = it can). `leaving` are flows
   * that disappear with the change (the flow into `target` that a bridge
   * replaces, the gateway's flow it re-points, a flow just created for
   * `target`).
   */
  targetProblem(gateway: El, target: El, leaving: El[] = []): string | undefined {
    return this.rule === 'engines' ? this.engineTargetProblem(gateway, target, leaving) : this.bpmnTargetProblem(gateway, target, leaving);
  }

  /**
   * W_EVENT_GATEWAY_TARGET for a sequence flow just created out of an
   * event-based gateway (connect, add) to a target BPMN 2.0 does not allow
   * there. Camunda 7 files are left to the platform profile, which reports the
   * engines' rule (W_C7_DEPLOY_EVENT_GATEWAY) on every write; an explicit edge is
   * the agent's call and only warned about, a bridge that would create it is
   * refused (E_INVALID_BRIDGE, ops/Bridge.ts).
   */
  warnFlow(flow: El, cs: ChangeSet): void {
    const gateway = flow.get<El | undefined>('sourceRef');
    const target = flow.get<El | undefined>('targetRef');
    if (!gateway || !target || !is(gateway, 'bpmn:EventBasedGateway') || this.rule === 'engines') return;
    const problem = this.bpmnTargetProblem(gateway, target, [flow]);
    if (!problem) return;
    cs.warn({
      code: 'W_EVENT_GATEWAY_TARGET',
      message: `Event-based gateway ${idOf(gateway)} now leads to ${idOf(target)} (${idOf(flow)}): ${problem}`,
      element: idOf(gateway),
      related: [idOf(target), idOf(flow)],
      hint: `Put a catch event in front of ${idOf(target)}: \`bpmn add <file> intermediateCatchEvent:timer "<Name>" --flow ${idOf(flow)} --timer PT1H\` (or :message --message <Name>), or remove the flow (\`bpmn remove <file> ${idOf(flow)}\`).`,
    });
  }

  /** The other incoming flows of an event-gateway target (a problem text), or undefined. */
  private otherIncoming(target: El, leaving: El[], what: string): string | undefined {
    const others = this.doc.incoming(target).filter((f) => !leaving.includes(f));
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
      for (const f of this.doc.outgoing(gateway)) {
        if (leaving.includes(f)) continue;
        const t = f.get<El | undefined>('targetRef');
        if (!t || t === target) continue;
        const theirs = EventGatewayRule.subscriptionOf(t);
        if (theirs && theirs.kind === mine.kind && theirs.name === mine.name) {
          return `${idOf(t)} on another branch of ${idOf(gateway)} already waits for the ${mine.kind} "${mine.name}"; the engines allow one subscription per ${mine.kind} name and gateway`;
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
      if (!defs.length || defs.some((d) => !allowed.some((t) => is(d, t)))) {
        const trigger = triggerOf(target) ?? 'none';
        return `${labelOf(target)} is a ${trigger === 'none' ? 'plain' : trigger} catch event; after an event-based gateway BPMN 2.0 allows message, timer, signal and conditional catch events only`;
      }
    }
    const incoming = this.otherIncoming(target, leaving, receive ? 'a receive task' : 'a catch event');
    if (incoming) return incoming;
    if (receive && this.doc.boundaryEventsOf(target).length) {
      return `${labelOf(target)} has boundary events (${this.doc.boundaryEventsOf(target).map(idOf).join(', ')}); BPMN 2.0 does not allow them on a receive task after an event-based gateway`;
    }
    if (receive || EventGatewayRule.waitsForMessage(target)) {
      for (const f of this.doc.outgoing(gateway)) {
        if (leaving.includes(f)) continue;
        const t = f.get<El | undefined>('targetRef');
        if (!t || t === target) continue;
        if (receive ? EventGatewayRule.waitsForMessage(t) : is(t, 'bpmn:ReceiveTask')) {
          return `${idOf(t)} on another branch of ${idOf(gateway)} is a ${receive ? 'message catch event' : 'receive task'}; BPMN 2.0 does not mix receive tasks and message catch events behind one event-based gateway`;
        }
      }
    }
    return undefined;
  }

  /** Name of the message / signal a catch event waits for (the engines subscribe by name), else undefined. */
  private static subscriptionOf(event: El): { kind: 'message' | 'signal'; name: string } | undefined {
    const trigger = triggerOf(event);
    if (trigger !== 'message' && trigger !== 'signal') return undefined;
    const def = (event.get<El[] | undefined>('eventDefinitions') ?? [])[0];
    const ref = def?.get<El | undefined>(trigger === 'message' ? 'messageRef' : 'signalRef');
    if (!ref) return undefined;
    return { kind: trigger, name: ref.get<string | undefined>('name') ?? idOf(ref) };
  }

  /** True for a catch event waiting for a message (any of its event definitions). */
  private static waitsForMessage(el: El): boolean {
    return is(el, 'bpmn:IntermediateCatchEvent') && (el.get<El[] | undefined>('eventDefinitions') ?? []).some((d) => is(d, 'bpmn:MessageEventDefinition'));
  }
}
