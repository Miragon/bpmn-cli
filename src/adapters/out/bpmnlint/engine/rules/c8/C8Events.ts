import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRules.js';
import { ElementKinds } from '../ElementKinds.js';

import { EngineScope } from '../EngineScope.js';
import { LinkEvents } from '../LinkEvents.js';
import { Shell } from '../Shell.js';
import { Values } from '../Values.js';
import { C8EventDefinitions } from './C8EventDefinitions.js';
import { FlowIndex } from './FlowIndex.js';
import { TimerValue } from './TimerValue.js';

const TIMER_KINDS = ['timeDate', 'timeCycle', 'timeDuration'] as const;
type TimerKind = (typeof TIMER_KINDS)[number];
const TIMER_EXAMPLE: Record<TimerKind, string> = { timeDuration: 'PT1H', timeDate: '2030-12-31T10:00:00Z', timeCycle: 'R/PT1H' };
const TIMER_EXPECTED: Record<TimerKind, string> = {
  timeDuration: 'an ISO 8601 duration (PT1H, P2D)',
  timeDate: 'an ISO 8601 date-time with offset (2030-12-31T10:00:00Z, ...+01:00)',
  timeCycle: 'a repeating interval (R/PT1H, R5/2030-01-01T08:00:00Z/P1D) or a 6-field cron expression (0 0 9 * * MON)',
};
const TIMER_CHECKS: Record<TimerKind, { valid: (timer: TimerValue) => boolean; range: (timer: TimerValue) => string | undefined }> = {
  timeDuration: { valid: (timer) => timer.isDuration(), range: () => undefined },
  timeDate: { valid: (timer) => timer.isDateTime(), range: (timer) => timer.dateTimeRangeProblem() },
  timeCycle: { valid: (timer) => timer.isCycle(), range: (timer) => timer.cycleRangeProblem() },
};
const GATEWAY_TRIGGERS = ['bpmn:MessageEventDefinition', 'bpmn:TimerEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:ConditionalEventDefinition'];

/**
 * Reports the events, gateways and sub-processes Camunda 8 refuses to deploy. In the whole file: a
 * boundary event on a compensation handler, a conditional definition without condition, a link
 * definition without name where camunda-compat does not look. In what the engine runs: several
 * definitions on one event, none on an event sub-process start, a definition without the id the
 * engine needs, a compensation naming an activity of another scope or a compensation boundary
 * event not wired to its handler, a link throw without its catch, start and end events in an
 * ad-hoc sub-process, an event-based gateway with fewer than two branches (as the engine counts
 * them) or a target other than a message, timer, signal or conditional catch event, a triggered
 * start of an embedded sub-process and several starts of a sub-process. In executable processes, a
 * static timer value Camunda 8.9 does not parse (camunda-compat's value reports are dropped).
 */
class C8Events extends C8Rule {
  private readonly flows = new FlowIndex();

  protected visit(node: ModdleElement): void {
    if (is(node, 'bpmn:BoundaryEvent')) this.checkBoundaryHost(node);
    if (is(node, 'bpmn:ConditionalEventDefinition')) this.checkCondition(node);
    const runs = EngineScope.C8.contains(node);
    if (is(node, 'bpmn:Event') && runs) this.checkEvent(node);
    if (is(node, 'bpmn:LinkEventDefinition')) this.checkLinkName(node);
    if (is(node, 'bpmn:Process') && runs) this.checkLinkThrows(node);
    if (is(node, 'bpmn:AdHocSubProcess') && runs) this.checkAdHocContent(node);
    if (is(node, 'bpmn:EventBasedGateway') && runs) this.checkGateway(node);
    if (runs && C8EventDefinitions.isEmbeddedSubProcessStart(node)) this.checkStartTrigger(node);
    if (runs && is(node, 'bpmn:SubProcess') && !is(node, 'bpmn:AdHocSubProcess')) this.checkStartCount(node);
    if (is(node, 'bpmn:Event') && EngineScope.inExecutableProcess(node)) (node.get('eventDefinitions') as ModdleElement[]).forEach((definition, index) => this.checkTimer(node, definition, index));
  }

  private checkBoundaryHost(event: ModdleElement): void {
    const host = event.get('attachedToRef');
    if (host?.get('isForCompensation') !== true) return;
    this.report('c8-boundary-host', event, `Boundary event ${event.id} is attached to the compensation handler ${host.id}; Camunda 8 refuses boundary events on compensation handlers`, { path: ['attachedToRef'], type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED, attachedToRef: host, hint: `Remove it: \`bpmn remove <file> ${event.id}\` (or attach it to a normal activity: \`bpmn move <file> ${event.id} --on <activityId>\`).` });
  }

  private checkEvent(event: ModdleElement): void {
    const definitions = event.get('eventDefinitions') ?? [];
    if (definitions.length > 1) {
      const triggers = definitions.map(ElementKinds.trigger);
      this.report('c8-event-definition', event, `${ElementKinds.describe(event)} has ${definitions.length} event definitions (${triggers.join(', ')}); Camunda 8 allows one and refuses the file`, { path: ['eventDefinitions'], type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, hint: `Keep one: \`bpmn set <file> ${event.id} trigger=<${triggers.join('|')}>\` (keeps that definition, drops the others), and model each other trigger as its own event.` });
      return;
    }
    if (!definitions.length) {
      if (is(event, 'bpmn:StartEvent') && EngineScope.isEventSubProcess(event.$parent)) this.report('c8-event-definition', event, `Start event ${event.id} of event sub-process ${event.$parent.id} has no trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file`, { path: ['eventDefinitions'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'eventDefinitions', hint: `\`bpmn set <file> ${event.id} trigger=message message=<MessageName>\` (or timer, error, signal, escalation, conditional).` });
      return;
    }
    const definition = C8EventDefinitions.definitionOf(event);
    if (!definition) return;
    this.checkDefinitionId(event, definition);
    if (is(definition, 'bpmn:CompensateEventDefinition') && is(event, 'bpmn:ThrowEvent')) this.checkActivityRef(event, definition);
    if (is(definition, 'bpmn:CompensateEventDefinition') && is(event, 'bpmn:BoundaryEvent')) this.checkCompensationBoundary(event);
  }

  private checkDefinitionId(event: ModdleElement, definition: ModdleElement): void {
    const needsId = isAny(definition, ['bpmn:ConditionalEventDefinition', 'bpmn:CompensateEventDefinition']) || (is(definition, 'bpmn:LinkEventDefinition') && is(event, 'bpmn:CatchEvent'));
    if (!needsId || definition.id) return;
    this.report('c8-event-definition', event, `The ${ElementKinds.trigger(definition)} event definition of ${ElementKinds.describe(event)} has no id; Camunda 8.9 refuses the file (an internal error: "Cannot invoke String.getBytes ... value is null")`, { path: ['eventDefinitions', 0, 'id'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: definition, requiredProperty: 'id', hint: `\`bpmn set <file> ${event.id} definition.id=${String(definition.$type).replace(/^[^:]*:/, '')}_${String(event.id).replace(/^[A-Za-z]+_/, '')}\` (Camunda Modeler gives every event definition an id).` });
  }

  /** A compensation throw event's activityRef must name an activity of its own scope. */
  private checkActivityRef(event: ModdleElement, definition: ModdleElement): void {
    const activity = definition.get('activityRef');
    const scope = EngineScope.scopeOf(event);
    if (!activity || EngineScope.scopeOf(activity) === scope) return;
    this.report('c8-event-definition', event, `Compensation event ${event.id} names ${activity.id}, which is not in its own scope ${scope?.id}; Camunda 8 refuses the file`, { path: ['eventDefinitions', 0, 'activityRef'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: definition, property: 'activityRef', activityRef: activity, hint: `\`bpmn set <file> ${event.id} definition.activityRef=<activityId>\` (an activity of ${scope?.id}), or \`definition.activityRef=\` to compensate the whole scope.` });
  }

  /** A compensation boundary event needs an association to its handler and no outgoing flow. */
  private checkCompensationBoundary(event: ModdleElement): void {
    const associated = (EngineScope.scopeOf(event)?.get('artifacts') ?? []).some((artifact: ModdleElement) => is(artifact, 'bpmn:Association') && artifact.get('sourceRef') === event);
    if (!associated) {
      this.report('c8-event-definition', event, `Compensation boundary event ${event.id} has no association to a compensation handler; Camunda 8 refuses the file`, { path: null, type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED, requiredType: 'bpmn:Association', hint: `Connect it to its handler (an activity with isForCompensation=true): \`bpmn connect <file> ${event.id} <handlerId>\`.` });
      return;
    }
    const [outgoing] = this.flows.outgoing(event);
    if (outgoing) this.report('c8-event-definition', event, `Compensation boundary event ${event.id} has an outgoing sequence flow; Camunda 8 refuses the file`, { path: ['outgoing'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'outgoing', hint: `Remove the flow (\`bpmn remove <file> ${outgoing.id} --no-bridge\`) and connect the handler instead: \`bpmn connect <file> ${event.id} <handlerId>\`.` });
  }

  /** The BPMN schema requires a condition in every conditional event definition of the file. */
  private checkCondition(definition: ModdleElement): void {
    if (definition.get('condition')) return;
    const { owner, path } = C8EventDefinitions.definitionOwner(definition);
    this.report('c8-event-definition', owner, `The conditional event definition of ${owner === definition ? definition.$type : ElementKinds.describe(owner)} has no condition element, which the BPMN schema requires; Camunda 8 refuses the file`, { path: [...path, 'condition'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: definition, requiredProperty: 'condition', hint: owner.id ? `\`bpmn set <file> ${owner.id} 'when== <expression>'\`.` : 'Fix it in the XML.' });
  }

  /**
   * The BPMN schema requires a name on every link event definition of the file, and Camunda 8
   * refuses an empty one. camunda-compat checks the first definition of an intermediate event in an
   * executable process; this checks the others.
   */
  private checkLinkName(definition: ModdleElement): void {
    const name = definition.get('name');
    const event = definition.$parent;
    const checkedByCompat = isAny(event, ['bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent']) && event.get('eventDefinitions')[0] === definition && EngineScope.inExecutableProcess(event);
    if (!Values.isMissing(name) || checkedByCompat) return;
    const { owner, path } = C8EventDefinitions.definitionOwner(definition);
    this.report('c8-link-event', owner, `The link event definition of ${owner === definition ? definition.$type : ElementKinds.describe(owner)} has ${name === '' ? 'an empty name' : 'no name, which the BPMN schema requires'}; Camunda 8 refuses the file`, { path: [...path, 'name'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: definition, requiredProperty: 'name', hint: owner.id ? `\`bpmn set <file> ${owner.id} link=<Name>\` (the throw and the catch event of a pair share the name).` : 'Fix it in the XML.' });
  }

  private checkLinkThrows(process: ModdleElement): void {
    const links = new LinkEvents(process, (node) => C8EventDefinitions.onlyDefinition(node, 'bpmn:LinkEventDefinition')?.get('name'));
    for (const { el, name, scope } of links.unmatchedThrows()) this.report('c8-link-event', el, `Link throw event ${el.id} goes to "${name}", but ${scope.id} has no link catch event of that name; Camunda 8 refuses the file`, { path: ['eventDefinitions', 0, 'name'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: el.get('eventDefinitions')[0], property: 'name', hint: `\`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${scope.id} --link ${Shell.quote(name)}\`, then continue from it (or rename the link: \`bpmn set <file> ${el.id} link=<Name>\`).` });
  }

  /** The report goes on the ad-hoc sub-process, with the path to the event to remove. */
  private checkAdHocContent(subProcess: ModdleElement): void {
    (subProcess.get('flowElements') as ModdleElement[]).forEach((child, index) => {
      if (isAny(child, ['bpmn:StartEvent', 'bpmn:EndEvent'])) this.report('c8-ad-hoc-sub-process', subProcess, `Ad-hoc sub-process ${subProcess.id} contains the ${is(child, 'bpmn:StartEvent') ? 'start' : 'end'} event ${child.id}; Camunda 8 refuses start and end events in ad-hoc sub-processes`, { path: ['flowElements', index], type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED, node: child, hint: `\`bpmn remove <file> ${child.id}\`.` });
    });
  }

  /** The engine counts the branches by the gateway's `<bpmn:outgoing>` entries; a receive task after it is camunda-compat's `event-based-gateway-target`. */
  private checkGateway(gateway: ModdleElement): void {
    const flows = this.flows.outgoing(gateway);
    const listed = (gateway.get('outgoing') ?? []).filter((flow: ModdleElement) => flow.get('sourceRef') === gateway);
    const branchCount = (message: string, hint: string) => this.report('c8-event-gateway', gateway, message, { path: ['outgoing'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'outgoing', hint });
    if (flows.length < 2) branchCount(`Event-based gateway ${gateway.id} has ${flows.length} outgoing flow${flows.length === 1 ? '' : 's'}; Camunda 8 needs at least two and refuses the file`, `Add a branch: \`bpmn add <file> intermediateCatchEvent:timer "<Timeout>" --after ${gateway.id} --timer PT1H\`.`);
    else if (listed.length < 2) branchCount(`Event-based gateway ${gateway.id} has ${flows.length} outgoing flows, but the file lists ${listed.length} of them as its <bpmn:outgoing> entries; Camunda 8 counts the listed ones and refuses the file`, `Add the missing <bpmn:outgoing>${flows.filter((flow) => !listed.includes(flow)).map((flow) => flow.id).join('</bpmn:outgoing>, <bpmn:outgoing>')}</bpmn:outgoing> entries to ${gateway.id} in the XML (Camunda Modeler writes them; this file leaves the lists out, and \`bpmn\` keeps a file's style).`);
    for (const flow of flows) {
      const target = flow.get('targetRef');
      if (!target || is(target, 'bpmn:ReceiveTask') || (is(target, 'bpmn:IntermediateCatchEvent') && GATEWAY_TRIGGERS.some((type) => C8EventDefinitions.onlyDefinition(target, type)))) continue;
      this.report('c8-event-gateway', gateway, `Event-based gateway ${gateway.id} leads to ${ElementKinds.describe(target)}; Camunda 8 allows only message, timer, signal and conditional intermediate catch events after it and refuses the file`, { path: null, type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED, target, flow, hint: `Put a catch event in between: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${flow.id} --message <MessageName>\` (or retype ${target.id}).` });
    }
  }

  private checkStartTrigger(start: ModdleElement): void {
    const definitions = start.get('eventDefinitions');
    const [definition] = definitions;
    if (definitions.length !== 1 || is(definition, 'bpmn:CancelEventDefinition')) return;
    this.report('c8-start-event', start, `Start event ${start.id} of sub-process ${start.$parent.id} has a ${ElementKinds.trigger(definition)} trigger; Camunda 8 allows only a none start event in an embedded sub-process and refuses the file`, { path: ['eventDefinitions', 0], type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED, eventDefinition: definition, hint: `\`bpmn set <file> ${start.id} trigger=none\` (an event sub-process takes triggered starts: \`bpmn add <file> eventSubProcess:${ElementKinds.trigger(definition)} ... --in ${start.$parent.id}\`).` });
  }

  /** A sub-process without a start event is bpmnlint's `start-event-required`. */
  private checkStartCount(subProcess: ModdleElement): void {
    const starts = (subProcess.get('flowElements') ?? []).filter((element: ModdleElement) => is(element, 'bpmn:StartEvent'));
    if (starts.length < 2) return;
    this.report('c8-start-event', subProcess, `${EngineScope.isEventSubProcess(subProcess) ? 'Event sub-process' : 'Sub-process'} ${subProcess.id} has ${starts.length} start events; Camunda 8 needs exactly one and refuses the file`, { path: ['flowElements'], type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, hint: `Keep one: \`bpmn remove <file> ${starts[1].id}\`.` });
  }

  /** Camunda 8.9 parses Java's Period and Duration split at an upper-case T, date-times with offset, repeating intervals and Spring's 6-field cron, each within its range. */
  private checkTimer(event: ModdleElement, definition: ModdleElement, index: number): void {
    const kinds = is(definition, 'bpmn:TimerEventDefinition') ? TIMER_KINDS.filter((timerKind) => definition.get(timerKind)) : [];
    const [kind] = kinds;
    if (kinds.length !== 1 || !kind) return;
    const value = String(definition.get(kind).get('body') ?? '').trim();
    const problem = value.startsWith('=') ? undefined : this.timerProblem(event, kind, value);
    if (problem) this.report('c8-timer-value', event, `The ${kind}${value === '' ? '' : ` "${value}"`} of ${ElementKinds.describe(event)} ${problem.text}; Camunda 8 refuses the file`, { path: ['eventDefinitions', index, kind], type: ERROR_TYPES.EXPRESSION_VALUE_NOT_ALLOWED, node: definition.get(kind), property: 'body', hint: problem.hint });
  }

  /** What is wrong with a static timer value, and the `bpmn set` that fixes it. */
  private timerProblem(event: ModdleElement, kind: TimerKind, value: string): { text: string; hint: string } | undefined {
    if (value === '') return { text: 'is empty', hint: `\`bpmn set <file> ${event.id} timer=PT1H\`.` };
    const timer = new TimerValue(value);
    if (TIMER_CHECKS[kind].valid(timer)) return undefined;
    const range = TIMER_CHECKS[kind].range(timer);
    if (range) return { text: `is no valid ${kind === 'timeDate' || !/^\S+( +\S+){5}$/.test(value) ? 'date-time' : 'cron expression'}: ${range}`, hint: `\`bpmn set <file> ${event.id} ${Shell.quote(`timer=${kind === 'timeDate' ? TIMER_EXAMPLE.timeDate : TIMER_EXAMPLE.timeCycle}`)}\` (with a value in range).` };
    return { text: `is not ${TIMER_EXPECTED[kind]}`, hint: `\`bpmn set <file> ${event.id} ${Shell.quote(`timer=${TIMER_EXAMPLE[kind]}`)}\` (or a FEEL expression: ${Shell.quote('timer==<expression>')} with --timer-kind ${kind.replace('time', '').toLowerCase()}).` };
  }
}

export default defineRule(
  {
    ruleName: 'c8-events',
    kind: 'engine-specific',
    targetEngine: 'c8',
    findings: {
      'c8-boundary-host': ['W_C8_DEPLOY_BOUNDARY_HOST', 'deploy'],
      'c8-event-definition': ['W_C8_DEPLOY_EVENT_DEFINITION', 'deploy'],
      'c8-link-event': ['W_C8_DEPLOY_LINK', 'deploy'],
      'c8-ad-hoc-sub-process': ['W_C8_DEPLOY_AD_HOC_SUBPROCESS', 'deploy'],
      'c8-event-gateway': ['W_C8_DEPLOY_EVENT_GATEWAY', 'deploy'],
      'c8-start-event': ['W_C8_DEPLOY_START_EVENT', 'deploy'],
      'c8-timer-value': ['W_C8_DEPLOY_TIMER', 'deploy'],
    },
  },
  C8Events,
);
