import { is, isAny } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRules.js';
import { ElementKinds } from '../ElementKinds.js';

import { EngineScope } from '../EngineScope.js';
import { FirstOfKey } from '../FirstOfKey.js';
import { LinkEvents } from '../LinkEvents.js';
import { SetCommand } from '../SetCommand.js';
import { Shell } from '../Shell.js';
import { C7EventDefinitions } from './C7EventDefinitions.js';

const TIMER_ELEMENTS = ['timeDate', 'timeCycle', 'timeDuration'];
const ESCALATION_HOSTS = ['bpmn:SubProcess', 'bpmn:CallActivity', 'bpmn:UserTask'];

/** The reference each kind of event definition needs where the engines read it, and how to set it. */
const REFERENCES: Array<{ finding: string; kind: string; events: string[]; missing: string; set: string; after?: string }> = [
  { finding: 'c7-message', kind: 'Message', events: ['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'], missing: 'has no message', set: 'message=<MessageName>', after: ' (creates the bpmn:Message)' },
  { finding: 'c7-signal', kind: 'Signal', events: ['bpmn:Event'], missing: 'has no signal', set: 'signal=<SignalName>' },
  { finding: 'c7-error', kind: 'Error', events: ['bpmn:EndEvent'], missing: 'throws no error (no errorRef)', set: 'error=<ErrorName> errorCode=<CODE>' },
  { finding: 'c7-escalation', kind: 'Escalation', events: ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'], missing: 'throws no escalation (no escalationRef)', set: 'escalation=<Name> escalationCode=<CODE>' },
];

/**
 * Reports the events Camunda 7 refuses or runs other than modeled. The BPMN schema checks hold for
 * every event definition in the file: a conditional one needs a condition, a timer at most one time
 * element, a link a name. In what the engines run: messages, signals, errors and escalations need
 * their reference with a name or code, message and signal subscriptions a unique name per scope
 * and root signals a unique name, a timer a value, a compensation throw an activity of its own
 * scope, link catch names are unique and a reached throw finds its catch, an escalation boundary
 * event sits on a sub-process, call activity or user task, no boundary event on a compensation
 * handler; an event with several definitions acts on one only.
 */
class C7Events extends C7Rule {
  protected visit(node: ModdleElement): void {
    if (is(node, 'bpmn:Definitions')) this.checkSignalNames(node);
    if (is(node, 'bpmn:Event')) this.checkEvent(node);
    else if (is(node, 'bpmn:EventDefinition') && !(node.$parent && is(node.$parent, 'bpmn:Event'))) this.checkDefinitions([node]);
    if (is(node, 'bpmn:ReceiveTask') && node.messageRef && !node.messageRef.name && EngineScope.C7.contains(node)) this.reportUnnamed(node, node.messageRef, `Message ${node.messageRef.id} of receive task ${node.id}`, ['messageRef']);
    if (is(node, 'bpmn:Process') && EngineScope.C7.contains(node)) {
      this.checkSubscriptions(node);
      this.checkLinks(node);
    }
  }

  private checkEvent(event: ModdleElement): void {
    const runs = EngineScope.C7.contains(event);
    const definitions = new C7EventDefinitions(event);
    if (runs) {
      this.checkBoundaryHost(event);
      for (const definition of definitions.actedOn()) {
        if (is(definition, 'bpmn:TimerEventDefinition') && !TIMER_ELEMENTS.some((timeElement) => definition[timeElement])) this.report('c7-event-definition', event, `Timer of ${ElementKinds.describe(event)} has no date, cycle or duration; the engines refuse the file`, { path: definitions.pathTo(definition), type: ERROR_TYPES.PROPERTY_REQUIRED, node: definition, requiredProperty: TIMER_ELEMENTS, hint: `\`bpmn set <file> ${event.id} timer=PT1H\` (or R/PT1H, or a date).` });
        if (is(definition, 'bpmn:CompensateEventDefinition') && isAny(event, ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'])) this.checkCompensation(event, definition, definitions);
      }
    }
    this.checkDefinitions(definitions.all());
    if (!runs) return;
    this.checkMultipleDefinitions(event, definitions);
    for (const reference of REFERENCES) if (isAny(event, reference.events)) for (const definition of definitions.actedOn()) if (is(definition, `bpmn:${reference.kind}EventDefinition`)) this.checkReference(event, definition, definitions, reference);
    if (is(event, 'bpmn:BoundaryEvent') && definitions.ofType('bpmn:EscalationEventDefinition')) this.checkEscalationHost(event);
  }

  /** The BPMN schema checks of event definitions, also of one the engines ignore or do not run. */
  private checkDefinitions(definitions: ModdleElement[]): void {
    for (const definition of definitions) {
      if (is(definition, 'bpmn:ConditionalEventDefinition') && !definition.condition) this.reportSchema('c7-event-definition', definition, `${this.subjectName(definition, 'Conditional event')} has no condition element, which the BPMN schema requires; the engines refuse the file`, { path: this.subjectPath(definition, 'condition'), type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'condition', hint: this.subjectHint(definition, Shell.quote('when=${expression}')) });
      const timeElements = TIMER_ELEMENTS.filter((timeElement) => definition[timeElement]);
      if (is(definition, 'bpmn:TimerEventDefinition') && timeElements.length > 1) this.reportSchema('c7-event-definition', definition, `${this.subjectName(definition, 'Timer event')} has ${timeElements.join(' and ')}; the BPMN schema allows only one of timeDate, timeCycle and timeDuration, and the engines refuse the file`, { path: this.subjectPath(definition), type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, hint: this.subjectHint(definition, 'timer=<value>', 'R/PT1H is a cycle, PT1H a duration, else a date; the other elements go') });
    }
    for (const definition of definitions) {
      if (is(definition, 'bpmn:LinkEventDefinition') && (definition.name === undefined || definition.name === null)) this.reportSchema('c7-link-event', definition, `${this.subjectName(definition, 'Link event')} has no link name, which the BPMN schema requires; the engines refuse the file`, { path: this.subjectPath(definition, 'name'), type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'name', hint: this.subjectHint(definition, 'link=<Name>', 'the throw and the catch event of a pair share the name') });
    }
  }

  private reportSchema(finding: string, definition: ModdleElement, message: string, data: { path: (string | number)[]; type: string; hint: string; [detail: string]: unknown }): void {
    this.report(finding, this.eventOf(definition) ?? definition, message, { ...data, node: definition });
  }

  /** The event with an id that holds `definition`: a report about the definition goes on it. */
  private eventOf(definition: ModdleElement): ModdleElement | undefined {
    const parent = definition.$parent;
    return parent && is(parent, 'bpmn:Event') && parent.id ? parent : undefined;
  }

  /** `Conditional event X`, among several definitions `The conditional definition of <event>`, without an event the definition itself. */
  private subjectName(definition: ModdleElement, single: string): string {
    const event = this.eventOf(definition);
    if (!event) return `${definition.$type}${definition.id ? ` ${definition.id}` : ''}`;
    return new C7EventDefinitions(event).all().length > 1 ? `The ${ElementKinds.trigger(definition)} definition of ${ElementKinds.describe(event)}` : `${single} ${event.id}`;
  }

  private subjectPath(definition: ModdleElement, ...rest: string[]): (string | number)[] {
    const event = this.eventOf(definition);
    return event ? new C7EventDefinitions(event).pathTo(definition, ...rest) : rest;
  }

  /** The fix `bpmn set <file> <event> <command>` (with `keeps` in brackets), or among several definitions how to drop this one when the engines act on another one. */
  private subjectHint(definition: ModdleElement, command: string, keeps = ''): string {
    const event = this.eventOf(definition);
    if (!event) return 'Fix it in the XML.';
    const definitions = new C7EventDefinitions(event);
    if (definitions.all().length < 2) return `\`bpmn set <file> ${event.id} ${command}\`${keeps ? ` (${keeps})` : ''}.`;
    const only = `\`bpmn set <file> ${event.id} ${command}\` (keeps only the ${ElementKinds.trigger(definition)} definition)`;
    const acting = definitions.acting();
    if (!acting || acting === definition) return `${only}.`;
    const trigger = ElementKinds.trigger(acting);
    return `The engines act on the ${trigger} definition and ignore this one, but they validate it too: drop it with \`bpmn set <file> ${event.id} trigger=${trigger}\` (keeps only the ${trigger}), or ${only}.`;
  }

  private checkReference(event: ModdleElement, definition: ModdleElement, definitions: C7EventDefinitions, { finding, kind, missing, set, after = '' }: (typeof REFERENCES)[number]): void {
    const label = ElementKinds.describe(event);
    const reference = `${kind.toLowerCase()}Ref`;
    const referenced = definition.get(reference);
    const path = definitions.pathTo(definition, reference);
    if (!referenced) {
      this.report(finding, event, `${label} ${missing}; the engines refuse the file`, { path, type: ERROR_TYPES.PROPERTY_REQUIRED, node: definition, requiredProperty: reference, hint: `\`bpmn set <file> ${event.id} ${set}\`${after}.` });
    } else if (kind === 'Message' || kind === 'Signal') {
      if (!referenced.name) this.reportUnnamed(event, referenced, `${kind} ${referenced.id} of ${label}`, path, finding);
    } else if (!String(referenced.get(`${kind.toLowerCase()}Code`) ?? '').trim()) {
      const code = `${kind.toLowerCase()}Code`;
      this.report(finding, event, `${kind} ${referenced.id} thrown by ${label} has no ${code}; the engines refuse the file`, { path: [...path, code], type: ERROR_TYPES.PROPERTY_REQUIRED, node: referenced, requiredProperty: code, hint: `\`bpmn set <file> ${event.id} ${code}=<CODE>\`.` });
    }
  }

  private reportUnnamed(owner: ModdleElement, referenced: ModdleElement, subject: string, path: (string | number)[], finding = 'c7-message'): void {
    this.report(finding, owner, `${subject} has no name; the engines refuse the file`, { path: [...path, 'name'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: referenced, requiredProperty: 'name', hint: `\`bpmn set <file> ${referenced.id} name=<${referenced.$type.slice('bpmn:'.length)}Name>\`.` });
  }

  private checkBoundaryHost(event: ModdleElement): void {
    const host = is(event, 'bpmn:BoundaryEvent') ? event.get('attachedToRef') : undefined;
    if (host?.get('isForCompensation') !== true) return;
    this.report('c7-boundary-host', event, `Boundary event ${event.id} is attached to the compensation handler ${host.id}; the engines refuse boundary events on compensation handlers`, { path: ['attachedToRef'], type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED, attachedToRef: host, hint: `Remove it: \`bpmn remove <file> ${event.id}\` (or attach it to a normal activity: \`bpmn move <file> ${event.id} --on <activityId>\`).` });
  }

  private checkEscalationHost(event: ModdleElement): void {
    const host = event.attachedToRef;
    if (!host || isAny(host, ESCALATION_HOSTS)) return;
    this.report('c7-escalation', event, `Escalation boundary event ${event.id} is attached to ${ElementKinds.describe(host)}; the engines allow it only on sub-processes, call activities and user tasks and refuse the file`, { path: ['attachedToRef'], type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED, attachedToRef: host, hint: `Attach it elsewhere (\`bpmn move <file> ${event.id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${event.id}\`.` });
  }

  /** An event with several definitions: the engines act on one and ignore the others. It deploys. */
  private checkMultipleDefinitions(event: ModdleElement, definitions: C7EventDefinitions): void {
    const all = definitions.all();
    if (all.length < 2) return;
    const acting = definitions.acting();
    const ignored = all.filter((definition) => definition !== acting).map((definition) => ElementKinds.trigger(definition));
    const consequence = acting ? `the engines act on the ${ElementKinds.trigger(acting)} only and ignore the ${ignored.join(' and ')}` : 'the engines act on one of them only and ignore the others';
    this.report('c7-multiple-event-definitions', event, `${ElementKinds.describe(event)} has ${all.length} event definitions (${all.map((definition) => ElementKinds.trigger(definition)).join(', ')}); ${consequence}`, { path: ['eventDefinitions'], type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, kept: acting, hint: `Keep one: \`bpmn set <file> ${event.id} trigger=${acting ? ElementKinds.trigger(acting) : '<trigger>'}\` (keeps that definition, drops the others), and model each other trigger as its own event (behind an event-based gateway, or another boundary / start event). One definition is edited with \`bpmn set <file> ${event.id} 'definition[<n>].<key>=<value>'\`.` });
  }

  /** The activities a compensation throw event may name: those of its own (sub-)process, for an event sub-process also those of its parent scope. */
  private checkCompensation(event: ModdleElement, definition: ModdleElement, definitions: C7EventDefinitions): void {
    const activity = definition.activityRef;
    const scope = EngineScope.scopeOf(event);
    if (!activity || !scope) return;
    const allowed = EngineScope.isEventSubProcess(scope) ? [scope, EngineScope.scopeOf(scope)] : [scope];
    const isFlowNode = is(activity, 'bpmn:FlowNode');
    if (isFlowNode && allowed.includes(EngineScope.scopeOf(activity))) return;
    const scopeId = scope.id ?? '<scopeId>';
    const named = isFlowNode ? `${ElementKinds.describe(activity)}, which is not in ${scopeId}` : `${activity.id}, which is not a flow node`;
    const key = `${SetCommand.forDefinition(event, definitions.all().indexOf(definition)).slot}activityRef`;
    const candidates = (scope.flowElements ?? []).filter((element: ModdleElement) => is(element, 'bpmn:Activity') && !EngineScope.isEventSubProcess(element) && element.id).map((element: ModdleElement) => element.id).slice(0, 5);
    const listed = candidates.length ? ` (in ${scopeId}: ${candidates.join(', ')})` : '';
    this.report('c7-event-definition', event, `Compensation event ${event.id} names activityRef ${named}; the engines compensate only activities of the throw event's own (sub-)process and refuse the file`, { path: definitions.pathTo(definition, 'activityRef'), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: definition, property: 'activityRef', activityRef: activity, hint: `\`bpmn set <file> ${event.id} ${Shell.quote(`${key}=<activityId>`)}\`${listed}, or compensate the whole scope: \`bpmn set <file> ${event.id} ${Shell.quote(`${key}=`)}\`.` });
  }

  /**
   * Message and signal subscriptions with one name in one engine scope: the start events of a
   * process; the event sub-process starts of a scope with the boundary events on it; the boundary
   * events of one activity with its own receive-task message (multi-instance: separate scopes).
   */
  private checkSubscriptions(scope: ModdleElement, firsts = new FirstOfKey<ModdleElement>()): void {
    for (const node of scope.flowElements ?? []) {
      if (is(node, 'bpmn:ReceiveTask')) this.checkSubscription(firsts, node, 'message', `scope:${node.id}`, node.messageRef?.name, ['messageRef']);
      const subscriptionScope = this.subscriptionScope(node);
      const definitions = new C7EventDefinitions(node);
      for (const kind of subscriptionScope ? ['message', 'signal'] : []) {
        const definition = definitions.ofType(`bpmn:${kind.charAt(0).toUpperCase()}${kind.slice(1)}EventDefinition`);
        if (definition) this.checkSubscription(firsts, node, kind, subscriptionScope!, definition.get(`${kind}Ref`)?.name, definitions.pathTo(definition, `${kind}Ref`));
      }
      if (is(node, 'bpmn:SubProcess') && !is(node, 'bpmn:AdHocSubProcess')) this.checkSubscriptions(node, firsts);
    }
  }

  private checkSubscription(firsts: FirstOfKey<ModdleElement>, el: ModdleElement, kind: string, scope: string, name: string | undefined, path: (string | number)[]): void {
    const first = name ? firsts.repeats(`${kind}\u0000${scope}\u0000${name}`, el) : undefined;
    if (!first) return;
    this.report(`c7-${kind}`, el, `${ElementKinds.describe(el)} waits for ${kind} "${name}" like ${first.id} in the same scope; the engines refuse two ${kind} subscriptions with one name`, { path, type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, duplicatedProperty: 'name', duplicatedPropertyValue: name, first, hint: `Use another ${kind}: \`bpmn set <file> ${el.id} ${kind}=<OtherName>\`.` });
  }

  private subscriptionScope(node: ModdleElement): string | undefined {
    if (is(node, 'bpmn:StartEvent')) {
      if (is(node.$parent, 'bpmn:Process')) return `start:${node.$parent.id}`;
      return EngineScope.isEventSubProcess(node.$parent) ? `scope:${EngineScope.scopeOf(node.$parent)?.id}` : undefined;
    }
    if (!is(node, 'bpmn:BoundaryEvent') || !node.attachedToRef) return undefined;
    const loop = node.attachedToRef.loopCharacteristics;
    return `${loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics') ? 'body' : 'scope'}:${node.attachedToRef.id}`;
  }

  /** The engines refuse duplicate root signal names, even of an unused signal, once a process runs. */
  private checkSignalNames(definitions: ModdleElement): void {
    const roots: ModdleElement[] = definitions.rootElements ?? [];
    if (!roots.some((root) => is(root, 'bpmn:Process') && root.isExecutable === true)) return;
    const firsts = new FirstOfKey<ModdleElement>();
    for (const signal of roots.filter((root) => is(root, 'bpmn:Signal') && root.name)) {
      const first = firsts.repeats(signal.name, signal);
      if (first) this.report('c7-signal', signal, `Signals ${first.id} and ${signal.id} are both named "${signal.name}"; the engines refuse duplicate signal names`, { path: ['name'], type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, duplicatedProperty: 'name', duplicatedPropertyValue: signal.name, first, hint: `\`bpmn set <file> ${signal.id} name=<OtherName>\` (or point its events at ${first.id} and remove it).` });
    }
  }

  /** Link catch names are unique in a process (sub-processes included); a throw a flow reaches needs a catch of its name in its own (sub-)process. */
  private checkLinks(process: ModdleElement): void {
    const links = new LinkEvents(process, (node) => (EngineScope.C7.contains(node) ? (new C7EventDefinitions(node).ofType('bpmn:LinkEventDefinition')?.name ?? undefined) : undefined));
    for (const { first, el, name } of links.duplicateCatches()) this.report('c7-link-event', el, `Link catch events ${first.id} and ${el.id} are both named "${name}"; the engines refuse two link catch events with one name in a process (sub-processes included)`, { path: this.linkNamePath(el), type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, duplicatedProperty: 'name', duplicatedPropertyValue: name, first, hint: `\`bpmn set <file> ${el.id} link=<OtherName>\` (and its throw events too).` });
    const targets = this.flowTargets(process);
    for (const { el, name, scope } of links.unmatchedThrows()) {
      if (!targets.has(el)) continue;
      const elsewhere = links.catchNamed(name);
      const scopeId = scope.id ?? '<scopeId>';
      const missing = elsewhere ? `the catch event of that name (${elsewhere.id}) is in another scope` : 'no link catch event has that name';
      this.report('c7-link-event', el, `Link throw event ${el.id} jumps to "${name}", but ${missing}; the engines resolve links within one (sub-)process (${scopeId}) and refuse the file`, { path: this.linkNamePath(el), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'name', ...(elsewhere ? { elsewhere } : {}), hint: `Add the catching side in ${scopeId}: \`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${scopeId} --link ${Shell.quote(name)}\` and continue from it, or point the throw at an existing catch: \`bpmn set <file> ${el.id} link=<Name>\`.` });
    }
  }

  private linkNamePath(event: ModdleElement): (string | number)[] {
    const definitions = new C7EventDefinitions(event);
    return definitions.pathTo(definitions.ofType('bpmn:LinkEventDefinition'), 'name');
  }

  /** The flow nodes a sequence flow of the process leads to. */
  private flowTargets(scope: ModdleElement, targets = new Set<ModdleElement>()): Set<ModdleElement> {
    for (const element of scope.flowElements ?? []) {
      if (is(element, 'bpmn:SequenceFlow') && element.targetRef) targets.add(element.targetRef);
      if (element.flowElements) this.flowTargets(element, targets);
    }
    return targets;
  }
}

export default defineRule(
  {
    ruleName: 'c7-events',
    kind: 'engine-specific',
    targetEngine: 'c7',
    findings: {
      'c7-boundary-host': ['W_C7_DEPLOY_BOUNDARY_HOST', 'deploy'],
      'c7-event-definition': ['W_C7_DEPLOY_EVENT_DEFINITION', 'deploy'],
      'c7-link-event': ['W_C7_DEPLOY_LINK', 'deploy'],
      'c7-multiple-event-definitions': ['W_C7_MULTIPLE_EVENT_DEFINITIONS', 'runtime'],
      'c7-message': ['W_C7_DEPLOY_MESSAGE', 'deploy'],
      'c7-signal': ['W_C7_DEPLOY_SIGNAL', 'deploy'],
      'c7-error': ['W_C7_DEPLOY_ERROR', 'deploy'],
      'c7-escalation': ['W_C7_DEPLOY_ESCALATION', 'deploy'],
    },
  },
  C7Events,
);
