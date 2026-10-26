import type { El } from '../../../model/utils/moddle.js';
import type { RuleRun } from '../RuleRun.js';
import { TimerValue } from '../TimerValue.js';
import { attr, idOf, list, localName, nameOf, peek, TIMER_ELEMENTS, triggerName } from '../utils/element.js';
import { sh } from '../utils/hint.js';
import { blank, feelOf, isFeel, missing, nameAttr } from './utils/value.js';
import { C8Rules } from './C8Rules.js';
import type { C8TaskRules } from './C8TaskRules.js';

/** Events and their triggers: definitions, timers, subscriptions, errors, links, start events. */
export class C8EventRules extends C8Rules {
  constructor(
    run: RuleRun,
    p: string,
    private readonly tasks: C8TaskRules,
  ) {
    super(run, p);
  }

  private nonInterrupting(el: El): boolean {
    if (this.kit.is(el, 'bpmn:BoundaryEvent')) return peek<boolean>(el, 'cancelActivity') === false;
    if (this.kit.is(el, 'bpmn:StartEvent')) return peek<boolean>(el, 'isInterrupting') === false;
    return false;
  }

  checkBoundaryHost(el: El): void {
    const host = peek<El>(el, 'attachedToRef');
    if (host && peek<boolean>(host, 'isForCompensation') === true) {
      this.push('deploy', 'W_C8_DEPLOY_BOUNDARY_HOST', el, undefined, 'compensationHost', `Boundary event ${idOf(el)} is attached to the compensation handler ${idOf(host)}; Camunda 8 refuses boundary events on compensation handlers`, `Remove it: \`bpmn remove <file> ${idOf(el)}\` (or attach it to a normal activity: \`bpmn move <file> ${idOf(el)} --on <activityId>\`).`, [idOf(host)!]);
    }
  }

  private checkTimer(el: El, def: El): void {
    const id = idOf(el)!;
    const label = this.describe(el);
    const kinds = TIMER_ELEMENTS.filter((k) => peek<El>(def, k));
    if (kinds.length !== 1) {
      // two of them is a schema error the engine reports first
      if (!kinds.length) this.push('deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer', `Timer of ${label} has no date, cycle or duration; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} timer=PT1H\` (a duration; R/PT1H is a cycle, an ISO date-time with offset a date).`);
      return;
    }
    const kind = kinds[0]!;
    const value = (peek<string>(peek<El>(def, kind), 'body') ?? '').trim();
    const catchEvent = this.kit.is(el, 'bpmn:IntermediateCatchEvent');
    if (kind === 'timeCycle' && catchEvent) {
      this.push('deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer:cycle', `Timer catch event ${id} has a cycle; Camunda 8 allows only a duration or a date on intermediate timer catch events and refuses the file`, `\`bpmn set <file> ${id} timer=PT1H\` (a duration, or a date-time).`);
      return;
    }
    if (kind === 'timeCycle' && (this.kit.is(el, 'bpmn:BoundaryEvent') || (this.kit.is(el, 'bpmn:StartEvent') && this.kit.isEventSubProcess(el.$parent as El))) && !this.nonInterrupting(el)) {
      this.push('deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer:interruptingCycle', `${label} is an interrupting timer with a cycle; Camunda 8 refuses interrupting cycles`, `Make it non-interrupting (\`bpmn set <file> ${id} nonInterrupting=true\`) or use a duration (\`bpmn set <file> ${id} timer=PT1H\`).`);
    }
    if (isFeel(value) || value === '') {
      this.checkFeel(el, undefined, 'timer', `The ${kind} of ${label}`, value, `\`bpmn set <file> ${id} ${sh('timer==<FEEL expression>')}\` (check the FEEL syntax).`);
      if (value === '') this.push('deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer:value', `The ${kind} of ${label} is empty; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} timer=PT1H\`.`);
      return;
    }
    const timer = new TimerValue(value);
    const ok = kind === 'timeDuration' ? timer.isDuration() : kind === 'timeDate' ? timer.isDateTime() : timer.isCycle();
    // the right form, but no real date-time or a cron field out of its range
    const range = ok ? undefined : kind === 'timeDate' ? timer.dateTimeRangeProblem() : kind === 'timeCycle' ? timer.cycleRangeProblem() : undefined;
    if (range) {
      this.push('deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer:value', `The ${kind} "${value}" of ${label} is no valid ${kind === 'timeDate' || !/^\S+( +\S+){5}$/.test(value) ? 'date-time' : 'cron expression'}: ${range}; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} ${sh(`timer=${kind === 'timeDate' ? '2030-12-31T10:00:00Z' : 'R/PT1H'}`)}\` (with a value in range).`);
    } else if (!ok) {
      const expected = kind === 'timeDuration' ? 'an ISO 8601 duration (PT1H, P2D)' : kind === 'timeDate' ? 'an ISO 8601 date-time with offset (2030-12-31T10:00:00Z, ...+01:00)' : 'a repeating interval (R/PT1H, R5/2030-01-01T08:00:00Z/P1D) or a 6-field cron expression (0 0 9 * * MON)';
      this.push('deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer:value', `The ${kind} "${value}" of ${label} is not ${expected}; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} ${sh(`timer=${kind === 'timeDuration' ? 'PT1H' : kind === 'timeDate' ? '2030-12-31T10:00:00Z' : 'R/PT1H'}`)}\` (or a FEEL expression: ${sh('timer==<expression>')} with --timer-kind ${kind.replace('time', '').toLowerCase()}).`);
    }
  }

  checkEvent(el: El): void {
    const id = idOf(el)!;
    const label = this.describe(el);
    const defs = list(el, 'eventDefinitions');
    const parent = el.$parent as El | undefined;
    if (defs.length > 1) {
      this.push('deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'definitions', `${label} has ${defs.length} event definitions (${defs.map(triggerName).join(', ')}); Camunda 8 allows one and refuses the file`, `Keep one: \`bpmn set <file> ${id} trigger=<${defs.map(triggerName).join('|')}>\` (keeps that definition, drops the others), and model each other trigger as its own event.`);
      return;
    }
    const def = defs[0];
    if (!def) {
      if (this.kit.is(el, 'bpmn:IntermediateCatchEvent') || this.kit.is(el, 'bpmn:BoundaryEvent')) {
        this.push('deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'none', `${label} has no event definition; Camunda 8 refuses ${this.kit.is(el, 'bpmn:BoundaryEvent') ? 'boundary' : 'intermediate catch'} events without a trigger`, `Give it one: \`bpmn set <file> ${id} trigger=timer timer=PT1H\` (or message, signal, ...).`);
      }
      if (this.kit.is(el, 'bpmn:StartEvent') && this.kit.isEventSubProcess(parent)) {
        this.push('deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'eventSubStart', `Start event ${id} of event sub-process ${idOf(parent)} has no trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file`, `\`bpmn set <file> ${id} trigger=message message=<MessageName>\` (or timer, error, signal, escalation, conditional).`);
      }
      return;
    }
    const trigger = triggerName(def);
    // definition kinds a position does not support
    if (this.kit.is(def, 'bpmn:CancelEventDefinition')) {
      this.push('deploy', 'W_C8_DEPLOY_UNSUPPORTED', el, undefined, 'cancel', `${label} is a cancel event; Camunda 8 does not support cancel events (nor transactions) and refuses the file`, `\`bpmn set <file> ${id} trigger=${this.kit.is(el, 'bpmn:BoundaryEvent') ? 'error' : 'none'}\`${this.kit.is(el, 'bpmn:BoundaryEvent') ? ' (an error boundary event)' : ''}.`);
      return;
    }
    if (this.kit.is(el, 'bpmn:StartEvent') && parent && this.kit.is(parent, 'bpmn:SubProcess') && !this.kit.isEventSubProcess(parent) && !this.kit.is(parent, 'bpmn:AdHocSubProcess')) {
      this.push('deploy', 'W_C8_DEPLOY_START_EVENT', el, undefined, 'subStartType', `Start event ${id} of sub-process ${idOf(parent)} has a ${trigger} trigger; Camunda 8 allows only a none start event in an embedded sub-process and refuses the file`, `\`bpmn set <file> ${id} trigger=none\` (an event sub-process takes triggered starts: \`bpmn add <file> eventSubProcess:${trigger} ... --in ${idOf(parent)}\`).`);
      return;
    }
    if (this.kit.is(el, 'bpmn:StartEvent') && this.kit.isEventSubProcess(parent) && this.kit.is(def, 'bpmn:CompensateEventDefinition')) {
      this.push('deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'eventSubStart', `Start event ${id} of event sub-process ${idOf(parent)} has a compensation trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file`, `\`bpmn set <file> ${id} trigger=<message|timer|error|signal|escalation|conditional>\`.`);
      return;
    }
    // definitions the engine needs an id on (8.9 fails on them otherwise)
    const needsId = this.kit.is(def, 'bpmn:ConditionalEventDefinition') || this.kit.is(def, 'bpmn:CompensateEventDefinition') || (this.kit.is(def, 'bpmn:LinkEventDefinition') && this.kit.is(el, 'bpmn:CatchEvent'));
    if (needsId && !idOf(def)) {
      this.push('deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'definitionId', `The ${trigger} event definition of ${label} has no id; Camunda 8.9 refuses the file (an internal error: "Cannot invoke String.getBytes ... value is null")`, `\`bpmn set <file> ${id} definition.id=${localName(def.$type)}_${id.replace(/^[A-Za-z]+_/, '')}\` (Camunda Modeler gives every event definition an id).`);
    }
    if (this.kit.is(def, 'bpmn:MessageEventDefinition')) {
      if (this.kit.is(el, 'bpmn:ThrowEvent')) this.tasks.checkMessageThrow(el, def);
      else this.checkMessageCatch(el);
    } else if (this.kit.is(def, 'bpmn:TimerEventDefinition')) {
      this.checkTimer(el, def);
    } else if (this.kit.is(def, 'bpmn:SignalEventDefinition')) {
      const sig = peek<El>(def, 'signalRef');
      if (!sig) this.push('deploy', 'W_C8_DEPLOY_SIGNAL', el, undefined, 'signalRef', `${label} has no signal; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} signal=<SignalName>\`.`);
      else if (!nameAttr(sig)) this.push('deploy', 'W_C8_DEPLOY_SIGNAL', el, undefined, 'signalName', `Signal ${idOf(sig)} of ${label} has no name; Camunda 8 refuses the file`, `\`bpmn set <file> ${idOf(sig)} name=<SignalName>\`.`, [idOf(sig)!]);
      else if (this.kit.is(el, 'bpmn:StartEvent') && isFeel(nameOf(sig))) this.push('deploy', 'W_C8_DEPLOY_SIGNAL', el, undefined, 'signalName', `Start event ${id} catches the signal "${nameOf(sig)}", a FEEL expression; Camunda 8 needs a static signal name on start events and refuses the file`, `\`bpmn set <file> ${idOf(sig)} name=<SignalName>\`.`, [idOf(sig)!]);
    } else if (this.kit.is(def, 'bpmn:ErrorEventDefinition')) {
      const err = peek<El>(def, 'errorRef');
      const code = peek<string>(err, 'errorCode');
      if (this.kit.is(el, 'bpmn:ThrowEvent')) {
        if (!err) this.push('deploy', 'W_C8_DEPLOY_ERROR', el, undefined, 'errorRef', `${label} throws no error (no errorRef); Camunda 8 refuses the file`, `\`bpmn set <file> ${id} error=<ErrorName> errorCode=<CODE>\`.`);
        else if (missing(code)) this.push('deploy', 'W_C8_DEPLOY_ERROR', el, undefined, 'errorCode', `Error ${idOf(err)} thrown by ${label} has no errorCode; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} errorCode=<CODE>\`.`, [idOf(err)!]);
      } else {
        if (isFeel(code)) this.push('deploy', 'W_C8_DEPLOY_ERROR', el, undefined, 'errorCode', `${label} catches the error code "${code}", an expression; Camunda 8 needs a static code on catching error events and refuses the file`, `\`bpmn set <file> ${id} errorCode=<CODE>\` (or no code: it catches every error).`, err ? [idOf(err)!] : []);
        if (this.nonInterrupting(el)) this.push('deploy', 'W_C8_DEPLOY_ERROR', el, undefined, 'nonInterrupting', `${label} is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)`, `\`bpmn set <file> ${id} nonInterrupting=false\`.`);
      }
    } else if (this.kit.is(def, 'bpmn:EscalationEventDefinition')) {
      if (this.kit.is(el, 'bpmn:ThrowEvent')) {
        const esc = peek<El>(def, 'escalationRef');
        if (!esc) this.push('deploy', 'W_C8_DEPLOY_ESCALATION', el, undefined, 'escalationRef', `${label} throws no escalation (no escalationRef); Camunda 8 refuses the file`, `\`bpmn set <file> ${id} escalation=<Name> escalationCode=<CODE>\`.`);
        else if (missing(peek<string>(esc, 'escalationCode'))) this.push('deploy', 'W_C8_DEPLOY_ESCALATION', el, undefined, 'escalationCode', `Escalation ${idOf(esc)} thrown by ${label} has no escalationCode; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} escalationCode=<CODE>\`.`, [idOf(esc)!]);
      } else if (this.kit.is(el, 'bpmn:BoundaryEvent')) {
        const host = peek<El>(el, 'attachedToRef');
        if (host && !this.kit.is(host, 'bpmn:SubProcess') && !this.kit.is(host, 'bpmn:CallActivity')) {
          this.push('deploy', 'W_C8_DEPLOY_ESCALATION', el, undefined, 'escalationHost', `Escalation boundary event ${id} is attached to ${this.describe(host)}; Camunda 8 allows it only on sub-processes and call activities and refuses the file`, `Attach it elsewhere (\`bpmn move <file> ${id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${id}\`.`, [idOf(host)!]);
        }
      }
    } else if (this.kit.is(def, 'bpmn:CompensateEventDefinition')) {
      if (this.kit.is(el, 'bpmn:ThrowEvent')) this.checkCompensationRef(el, def);
      if (this.kit.is(el, 'bpmn:BoundaryEvent')) this.checkCompensationBoundary(el);
    } else if (this.kit.is(def, 'bpmn:ConditionalEventDefinition')) {
      const body = peek<string>(peek<El>(def, 'condition'), 'body');
      this.checkFeel(el, undefined, 'condition', `The condition of conditional event ${id}`, body, `\`bpmn set <file> ${id} ${sh(`when==${feelOf((body ?? '').trim().slice(1))}`)}\` (check the FEEL syntax).`);
      if (peek<El>(def, 'condition') && !isFeel(body)) {
        this.push('deploy', 'W_C8_DEPLOY_EXPRESSION', el, undefined, 'condition', `The condition "${(body ?? '').trim()}" of conditional event ${id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, `\`bpmn set <file> ${id} ${sh(`when==${feelOf(body ?? '')}`)}\` (check the FEEL syntax).`);
      }
    }
  }

  checkMessageCatch(el: El): void {
    const id = idOf(el)!;
    const label = this.describe(el);
    const msg = this.messageOf(el);
    if (!msg) {
      this.push('deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'messageRef', `${label} has no message; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} message=<MessageName>\` (creates the bpmn:Message), then give it a correlation key: \`bpmn ext add <file> <messageId> ${this.z('subscription')} correlationKey==<expression>\`.`);
      return;
    }
    const mid = idOf(msg)!;
    const name = nameAttr(msg);
    if (!name) {
      this.push('deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'messageName', `Message ${mid} of ${label} has no name; Camunda 8 refuses the file`, `\`bpmn set <file> ${mid} name=<MessageName>\`.`, [mid]);
      return;
    }
    const processStart = this.kit.is(el, 'bpmn:StartEvent') && this.kit.is(el.$parent as El, 'bpmn:Process');
    if (processStart) {
      if (isFeel(name)) this.push('deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'messageName', `Start event ${id} catches the message "${name}", a FEEL expression; Camunda 8 needs a static message name on process start events and refuses the file`, `\`bpmn set <file> ${mid} name=<MessageName>\`.`, [mid]);
      return;
    }
    const subs = this.zeebe(msg, 'subscription');
    // two of them: W_C8_DEPLOY_DUPLICATE_EXTENSION on the message
    if (subs.length > 1) return;
    if (!subs.length) {
      this.push('deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, `subscription:${mid}`, `Message ${mid} ("${name}") of ${label} has no ${this.z('subscription')}: Camunda 8 needs one with the correlation key that matches a message to an instance and refuses the file`, `\`bpmn ext add <file> ${mid} ${this.z('subscription')} correlationKey==<expression>\` (e.g. correlationKey==orderId).`, [mid]);
      return;
    }
    const key = attr(subs[0], 'correlationKey');
    if (blank(key)) this.push('deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, `correlationKey:${mid}`, `The ${this.z('subscription')} of message ${mid} ("${name}") has no correlationKey; Camunda 8 refuses the file`, this.fixHint(msg, undefined, subs[0]!, { correlationKey: '=<expression>' }), [mid]);
    else if (!isFeel(key)) this.push('deploy', 'W_C8_DEPLOY_EXPRESSION', el, undefined, `correlationKey:${mid}`, `The correlationKey "${key}" of message ${mid} is a static value; Camunda 8 needs a FEEL expression (=${key!.trim()}) and refuses the file`, this.fixHint(msg, undefined, subs[0]!, { correlationKey: `=${key!.trim()}` }), [mid]);
  }

  /** A compensation throw event's activityRef must name an activity of its own scope. */
  private checkCompensationRef(el: El, def: El): void {
    const ref = peek<El>(def, 'activityRef');
    if (!ref) return;
    const scope = this.doc.scopeOf(el);
    if (this.doc.scopeOf(ref) === scope) return;
    this.push('deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'activityRef', `Compensation event ${idOf(el)} names ${idOf(ref)}, which is not in its own scope ${idOf(scope)}; Camunda 8 refuses the file`, `\`bpmn set <file> ${idOf(el)} definition.activityRef=<activityId>\` (an activity of ${idOf(scope)}), or \`definition.activityRef=\` to compensate the whole scope.`, [idOf(ref)!]);
  }

  /** A compensation boundary event needs an association to its handler and no outgoing flow. */
  private checkCompensationBoundary(el: El): void {
    const id = idOf(el)!;
    const scope = this.doc.scopeOf(el);
    const associated = list(scope, 'artifacts').some((a) => this.kit.is(a, 'bpmn:Association') && peek<El>(a, 'sourceRef') === el);
    const out = this.outgoing.get(el) ?? [];
    if (!associated || out.length) {
      this.push('deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'compensationBoundary', `Compensation boundary event ${id} ${!associated ? 'has no association to a compensation handler' : 'has an outgoing sequence flow'}; Camunda 8 refuses the file`, !associated ? `Connect it to its handler (an activity with isForCompensation=true): \`bpmn connect <file> ${id} <handlerId>\`.` : `Remove the flow (\`bpmn remove <file> ${idOf(out[0])} --no-bridge\`) and connect the handler instead: \`bpmn connect <file> ${id} <handlerId>\`.`);
    }
  }

  checkStartEvents(scope: El): void {
    const id = idOf(scope)!;
    const starts = this.doc.flowNodes(scope).filter((n) => this.kit.is(n, 'bpmn:StartEvent'));
    if (this.kit.is(scope, 'bpmn:Process')) {
      if (!starts.length) {
        this.push('deploy', 'W_C8_DEPLOY_START_EVENT', scope, undefined, 'noStart', `Process ${id} has no start event; Camunda 8 refuses the file`, `\`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${id}).`);
        return;
      }
      const none = starts.filter((s) => !list(s, 'eventDefinitions').length);
      for (const extra of none.slice(1)) {
        this.push('deploy', 'W_C8_DEPLOY_START_EVENT', extra, undefined, 'noneStart', `Process ${id} has ${none.length} none start events (${none.map(idOf).join(', ')}); Camunda 8 allows one and refuses the file`, `Remove ${idOf(extra)} (\`bpmn remove <file> ${idOf(extra)}\`) or give it a trigger: \`bpmn set <file> ${idOf(extra)} trigger=message message=<MessageName>\`.`, [idOf(none[0])!]);
      }
      return;
    }
    if (this.kit.is(scope, 'bpmn:AdHocSubProcess') || this.kit.is(scope, 'bpmn:Transaction')) return;
    const event = this.kit.isEventSubProcess(scope);
    if (starts.length !== 1) {
      this.push('deploy', 'W_C8_DEPLOY_START_EVENT', scope, undefined, 'startCount', `${event ? 'Event sub-process' : 'Sub-process'} ${id} has ${starts.length ? `${starts.length} start events` : 'no start event'}; Camunda 8 needs exactly one and refuses the file`, starts.length ? `Keep one: \`bpmn remove <file> ${idOf(starts[1])}\`.` : event ? `\`bpmn add <file> startEvent:message "<Name>" --in ${id} --message <MessageName>\` (or timer, error, signal, escalation, conditional).` : `\`bpmn add <file> startEvent "<Name>" --in ${id}\`, then connect it to the first node.`);
    }
  }

  /**
   * Message names caught twice in one scope, signal names on two starts / one activity's
   * boundaries, error codes twice in one scope.
   */
  checkSubscriptionScopes(scope: El): void {
    const nodes = this.doc.flowNodes(scope);
    const literal = (n: string | undefined): n is string => !!n && !isFeel(n);
    const defOf = (el: El, type: string): El | undefined => {
      const defs = list(el, 'eventDefinitions');
      return defs.length === 1 && this.kit.is(defs[0], type) ? defs[0] : undefined;
    };
    const report = (els: El[], kind: 'message' | 'signal', name: string, where: string, code: string, subjectPrefix: string): void => {
      const [first, ...rest] = els;
      for (const el of rest) {
        this.push('deploy', code, el, undefined, `${subjectPrefix}:${name}`, `${this.describe(el)} waits for the ${kind} "${name}" like ${this.describe(first!)} ${where}; Camunda 8 refuses one ${kind} name twice there`, `Use another ${kind}: \`bpmn set <file> ${idOf(el)} ${kind}=<Other${kind === 'message' ? 'Message' : 'Signal'}>\`${kind === 'message' ? ` (and a ${this.z('subscription')} on it)` : ''}.`, [idOf(first!)!]);
      }
    };
    const group = (els: El[], kind: 'message' | 'signal', where: string, code: string, subjectPrefix: string): void => {
      const byName = new Map<string, El[]>();
      for (const el of els) {
        const def = defOf(el, kind === 'message' ? 'bpmn:MessageEventDefinition' : 'bpmn:SignalEventDefinition');
        const name = kind === 'message' ? nameOf(this.kit.is(el, 'bpmn:ReceiveTask') ? peek<El>(el, 'messageRef') : peek<El>(def, 'messageRef')) : nameOf(peek<El>(def, 'signalRef'));
        if (!literal(name)) continue;
        byName.set(name, [...(byName.get(name) ?? []), el]);
      }
      for (const [name, list_] of byName) if (list_.length > 1) report(list_, kind, name, where, code, subjectPrefix);
    };
    // boundary events of one activity (with the activity itself when it is a receive task)
    for (const act of nodes.filter((n) => this.kit.is(n, 'bpmn:Activity'))) {
      const boundaries = nodes.filter((n) => this.kit.is(n, 'bpmn:BoundaryEvent') && peek<El>(n, 'attachedToRef') === act);
      if (!boundaries.length) continue;
      group([...(this.kit.is(act, 'bpmn:ReceiveTask') ? [act] : []), ...boundaries], 'message', `on ${idOf(act)}`, 'W_C8_DEPLOY_MESSAGE', `boundaryMessage:${idOf(act)}`);
      group(boundaries, 'signal', `on ${idOf(act)}`, 'W_C8_DEPLOY_SIGNAL', `boundarySignal:${idOf(act)}`);
      this.checkErrorCodes(boundaries, `the boundary events of ${idOf(act)}`);
    }
    // branches of an event-based gateway
    for (const gw of nodes.filter((n) => this.kit.is(n, 'bpmn:EventBasedGateway'))) {
      const targets = (this.outgoing.get(gw) ?? []).map((f) => peek<El>(f, 'targetRef')).filter((t): t is El => !!t && this.kit.is(t, 'bpmn:IntermediateCatchEvent'));
      group(targets, 'message', `after event-based gateway ${idOf(gw)}`, 'W_C8_DEPLOY_MESSAGE', `gatewayMessage:${idOf(gw)}`);
    }
    // start events of the event sub-processes of this scope
    const eventSubStarts = nodes.filter((n) => this.kit.isEventSubProcess(n)).flatMap((sp) => this.doc.flowNodes(sp).filter((n) => this.kit.is(n, 'bpmn:StartEvent')));
    group(eventSubStarts, 'message', `in the event sub-processes of ${idOf(scope)}`, 'W_C8_DEPLOY_MESSAGE', `eventSubMessage:${idOf(scope)}`);
    this.checkErrorCodes(eventSubStarts, `the event sub-processes of ${idOf(scope)}`);
    // process start events
    if (this.kit.is(scope, 'bpmn:Process')) {
      const starts = nodes.filter((n) => this.kit.is(n, 'bpmn:StartEvent'));
      group(starts, 'message', `in process ${idOf(scope)}`, 'W_C8_DEPLOY_MESSAGE', 'startMessage');
      group(starts, 'signal', `in process ${idOf(scope)}`, 'W_C8_DEPLOY_SIGNAL', 'startSignal');
    }
  }

  /** Two error catch events with one code (or two without code) in one scope. */
  private checkErrorCodes(events: El[], where: string): void {
    const seen = new Map<string, El>();
    for (const el of events) {
      const defs = list(el, 'eventDefinitions');
      if (defs.length !== 1 || !this.kit.is(defs[0], 'bpmn:ErrorEventDefinition')) continue;
      const code = peek<string>(peek<El>(defs[0], 'errorRef'), 'errorCode');
      const key = blank(code) ? '' : code!;
      const first = seen.get(key);
      if (first) {
        this.push('deploy', 'W_C8_DEPLOY_ERROR', el, undefined, `errorCode:${key}`, key ? `${this.describe(el)} catches the error code "${key}" like ${this.describe(first)} (${where}); Camunda 8 refuses one code twice in a scope` : `${this.describe(el)} and ${this.describe(first)} both catch every error (no error code) (${where}); Camunda 8 allows one catch-all per scope`, `Catch another error: \`bpmn set <file> ${idOf(el)} error=<OtherError> errorCode=<OTHER_CODE>\` (the events share no bpmn:Error then), or remove one of them.`, [idOf(first)!]);
      } else {
        seen.set(key, el);
      }
    }
  }

  /**
   * Link events: a throw needs a catch of its name in its own (sub-)process; catch names are
   * unique in a process.
   */
  checkLinks(proc: El): void {
    const catches = new Map<string, El[]>();
    const walkScope = (scope: El): void => {
      const nodes = this.doc.flowNodes(scope);
      const linkName = (n: El): string | undefined => {
        const defs = list(n, 'eventDefinitions');
        return defs.length === 1 && this.kit.is(defs[0], 'bpmn:LinkEventDefinition') ? peek<string>(defs[0], 'name') : undefined;
      };
      const here = new Set(nodes.filter((n) => this.kit.is(n, 'bpmn:IntermediateCatchEvent')).map(linkName).filter((n): n is string => n !== undefined));
      for (const n of nodes) {
        if (this.kit.is(n, 'bpmn:SubProcess')) walkScope(n);
        const name = linkName(n);
        if (name === undefined) continue;
        if (this.kit.is(n, 'bpmn:IntermediateCatchEvent')) catches.set(name, [...(catches.get(name) ?? []), n]);
        else if (this.kit.is(n, 'bpmn:IntermediateThrowEvent') && !here.has(name)) {
          this.push('deploy', 'W_C8_DEPLOY_LINK', n, undefined, `link:${name}`, `Link throw event ${idOf(n)} goes to "${name}", but ${idOf(scope)} has no link catch event of that name; Camunda 8 refuses the file`, `\`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${idOf(scope)} --link ${sh(name)}\`, then continue from it (or rename the link: \`bpmn set <file> ${idOf(n)} link=<Name>\`).`);
        }
      }
    };
    walkScope(proc);
    for (const [name, els] of catches) {
      for (const el of els.slice(1)) {
        this.push('deploy', 'W_C8_DEPLOY_LINK', el, undefined, `linkCatch:${name}`, `Link catch events ${idOf(els[0])} and ${idOf(el)} share the name "${name}" in process ${idOf(proc)}; Camunda 8 refuses the file`, `\`bpmn set <file> ${idOf(el)} link=<OtherName>\` (and its throw events).`, [idOf(els[0])!]);
      }
    }
  }

  /**
   * The names of the messages and signals the file's elements use: Camunda 8 parses one starting
   * with = as FEEL at deploy.
   */
  checkFeelNames(): void {
    const used = new Set<El>();
    for (const el of this.kit.walk(this.doc.definitions, { bpmnOnly: true })) {
      if (!this.kit.is(el, 'bpmn:FlowNode')) continue;
      const msg = this.messageOf(el);
      if (msg) used.add(msg);
      for (const def of list(el, 'eventDefinitions')) {
        const sig = this.kit.is(def, 'bpmn:SignalEventDefinition') ? peek<El>(def, 'signalRef') : undefined;
        if (sig) used.add(sig);
      }
    }
    for (const ref of used) {
      const id = idOf(ref);
      if (!id) continue;
      const what = this.kit.is(ref, 'bpmn:Signal') ? 'signal' : 'message';
      this.checkFeel(ref, undefined, 'name', `The name of ${what} ${id}`, nameAttr(ref), `\`bpmn set <file> ${id} ${sh('name==<FEEL expression>')}\` (check the FEEL syntax), or a static name.`);
    }
  }
}
