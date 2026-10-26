import type { El } from '../../../document/utils/moddle.js';
import type { RuleRun } from '../RuleRun.js';
import { idOf, list, nameOf, peek, TIMER_ELEMENTS, triggerName } from '../../utils/element.js';
import { sh } from '../../utils/hint.js';
import { nonEmpty } from '../../utils/value.js';
import type { C7ImplementationRules } from './C7ImplementationRules.js';
import { C7Rules } from './C7Rules.js';

const VARIABLE_EVENTS = ['create', 'update', 'delete'];

/** Events and their triggers: event definitions, messages and signals, links, start events. */
export class C7EventRules extends C7Rules {
  constructor(
    run: RuleRun,
    prefix: string,
    private readonly implementation: C7ImplementationRules,
  ) {
    super(run, prefix);
  }

  /**
   * An event with several event definitions: the engines act on one of them and ignore the others
   * (a message + timer catch event creates only the timer job). It deploys.
   */
  private checkMultipleDefinitions(el: El): void {
    const defs = list(el, 'eventDefinitions');
    if (defs.length < 2) return;
    const id = idOf(el)!;
    const kinds = defs.map(triggerName);
    const acting = this.actingDefinition(el);
    const what = acting
      ? `the engines act on the ${triggerName(acting)} only and ignore the ${kinds.filter((_kind, index) => defs[index] !== acting).join(' and ')}`
      : 'the engines act on one of them only and ignore the others';
    const keep = acting ? triggerName(acting) : '<trigger>';
    this.push('runtime', 'W_C7_MULTIPLE_EVENT_DEFINITIONS', el, undefined, 'definitions', `${this.describe(el, undefined)} has ${defs.length} event definitions (${kinds.join(', ')}); ${what}`, `Keep one: \`bpmn set <file> ${id} trigger=${keep}\` (keeps that definition, drops the others), and model each other trigger as its own event (behind an event-based gateway, or another boundary / start event). One definition is edited with \`bpmn set <file> ${id} 'definition[<n>].<key>=<value>'\`.`);
  }

  /** Checks an event; of several definitions only the one the engines act on is checked, as they parse only that one. */
  checkEvent(el: El): void {
    this.checkCompensationHost(el);
    this.checkMultipleDefinitions(el);
    for (const def of this.actedOn(el)) this.checkDefinition(el, def);
  }

  private checkCompensationHost(el: El): void {
    const host = this.kit.is(el, 'bpmn:BoundaryEvent') ? peek<El>(el, 'attachedToRef') : undefined;
    if (!host || peek<boolean>(host, 'isForCompensation') !== true) return;
    const id = idOf(el)!;
    this.push('deploy', 'W_C7_DEPLOY_BOUNDARY_HOST', el, undefined, 'compensationHost', `Boundary event ${id} is attached to the compensation handler ${idOf(host)}; the engines refuse boundary events on compensation handlers`, `Remove it: \`bpmn remove <file> ${id}\` (or attach it to a normal activity: \`bpmn move <file> ${id} --on <activityId>\`).`, [idOf(host)!]);
  }

  private checkDefinition(el: El, def: El): void {
    if (this.kit.is(def, 'bpmn:MessageEventDefinition')) this.checkMessageDefinition(el, def);
    else if (this.kit.is(def, 'bpmn:SignalEventDefinition')) this.checkSignalDefinition(el, def);
    else if (this.kit.is(def, 'bpmn:ErrorEventDefinition') && this.kit.is(el, 'bpmn:EndEvent')) this.checkErrorDefinition(el, def);
    else if (this.kit.is(def, 'bpmn:EscalationEventDefinition')) this.checkEscalationDefinition(el, def);
    else if (this.kit.is(def, 'bpmn:CompensateEventDefinition') && this.isThrowing(el)) this.checkCompensationRef(el, def);
    else if (this.kit.is(def, 'bpmn:TimerEventDefinition')) this.checkTimerDefinition(el, def);
    else if (this.kit.is(def, 'bpmn:ConditionalEventDefinition')) this.checkConditionalDefinition(el, def);
  }

  private isCatching(el: El): boolean {
    return this.kit.is(el, 'bpmn:StartEvent') || this.kit.is(el, 'bpmn:IntermediateCatchEvent') || this.kit.is(el, 'bpmn:BoundaryEvent');
  }

  private isThrowing(el: El): boolean {
    return this.kit.is(el, 'bpmn:IntermediateThrowEvent') || this.kit.is(el, 'bpmn:EndEvent');
  }

  private checkMessageDefinition(el: El, def: El): void {
    if (this.isThrowing(el)) {
      this.implementation.checkImplementation(def, el, this.describe(el, undefined), { event: el });
      return;
    }
    if (!this.isCatching(el)) return;
    const id = idOf(el)!;
    const label = this.describe(el, undefined);
    const msg = peek<El>(def, 'messageRef');
    if (!msg) this.push('deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, 'messageRef', `${label} has no message; the engines refuse the file`, `\`bpmn set <file> ${id} message=<MessageName>\` (creates the bpmn:Message).`);
    else if (!nameOf(msg)) this.push('deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, 'messageName', `Message ${idOf(msg)} of ${label} has no name; the engines refuse the file`, `\`bpmn set <file> ${idOf(msg)} name=<MessageName>\`.`, [idOf(msg)!]);
  }

  private checkSignalDefinition(el: El, def: El): void {
    const id = idOf(el)!;
    const label = this.describe(el, undefined);
    const sig = peek<El>(def, 'signalRef');
    if (!sig) this.push('deploy', 'W_C7_DEPLOY_SIGNAL', el, undefined, 'signalRef', `${label} has no signal; the engines refuse the file`, `\`bpmn set <file> ${id} signal=<SignalName>\`.`);
    else if (!nameOf(sig)) this.push('deploy', 'W_C7_DEPLOY_SIGNAL', el, undefined, 'signalName', `Signal ${idOf(sig)} of ${label} has no name; the engines refuse the file`, `\`bpmn set <file> ${idOf(sig)} name=<SignalName>\`.`, [idOf(sig)!]);
  }

  private checkErrorDefinition(el: El, def: El): void {
    const id = idOf(el)!;
    const label = this.describe(el, undefined);
    const err = peek<El>(def, 'errorRef');
    if (!err) this.push('deploy', 'W_C7_DEPLOY_ERROR', el, undefined, 'errorRef', `${label} throws no error (no errorRef); the engines refuse the file`, `\`bpmn set <file> ${id} error=<ErrorName> errorCode=<CODE>\`.`);
    else if (!nonEmpty(peek<string>(err, 'errorCode'))) this.push('deploy', 'W_C7_DEPLOY_ERROR', el, undefined, 'errorCode', `Error ${idOf(err)} thrown by ${label} has no errorCode; the engines refuse the file`, `\`bpmn set <file> ${id} errorCode=<CODE>\`.`, [idOf(err)!]);
  }

  private checkEscalationDefinition(el: El, def: El): void {
    if (this.isThrowing(el)) this.checkThrownEscalation(el, def);
    else if (this.kit.is(el, 'bpmn:BoundaryEvent')) this.checkEscalationHost(el);
  }

  private checkThrownEscalation(el: El, def: El): void {
    const id = idOf(el)!;
    const label = this.describe(el, undefined);
    const esc = peek<El>(def, 'escalationRef');
    if (!esc) this.push('deploy', 'W_C7_DEPLOY_ESCALATION', el, undefined, 'escalationRef', `${label} throws no escalation (no escalationRef); the engines refuse the file`, `\`bpmn set <file> ${id} escalation=<Name> escalationCode=<CODE>\`.`);
    else if (!nonEmpty(peek<string>(esc, 'escalationCode'))) this.push('deploy', 'W_C7_DEPLOY_ESCALATION', el, undefined, 'escalationCode', `Escalation ${idOf(esc)} thrown by ${label} has no escalationCode; the engines refuse the file`, `\`bpmn set <file> ${id} escalationCode=<CODE>\`.`, [idOf(esc)!]);
  }

  private checkEscalationHost(el: El): void {
    const host = peek<El>(el, 'attachedToRef');
    if (!host || this.kit.is(host, 'bpmn:SubProcess') || this.kit.is(host, 'bpmn:CallActivity') || this.kit.is(host, 'bpmn:UserTask')) return;
    const id = idOf(el)!;
    this.push('deploy', 'W_C7_DEPLOY_ESCALATION', el, undefined, 'escalationHost', `Escalation boundary event ${id} is attached to ${this.describe(host, undefined)}; the engines allow it only on sub-processes, call activities and user tasks and refuse the file`, `Attach it elsewhere (\`bpmn move <file> ${id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${id}\`.`, [idOf(host)!]);
  }

  private checkTimerDefinition(el: El, def: El): void {
    if (TIMER_ELEMENTS.some((timerKind) => peek<El>(def, timerKind))) return;
    this.push('deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', el, undefined, 'timer', `Timer of ${this.describe(el, undefined)} has no date, cycle or duration; the engines refuse the file`, `\`bpmn set <file> ${idOf(el)} timer=PT1H\` (or R/PT1H, or a date).`);
  }

  /** Checks the condition of a conditional definition; a missing condition element is left to the schema error. */
  private checkConditionalDefinition(el: El, def: El): void {
    const id = idOf(el)!;
    const cond = peek<El>(def, 'condition');
    if (cond && this.emptyCondition(cond)) {
      this.push('runtime', 'W_C7_EMPTY_CONDITION', el, undefined, 'emptyCondition', `Conditional event ${id} has an empty condition (no expression and no ${this.prefix}:resource): it deploys, but evaluating it fails when the process runs`, `\`bpmn set <file> ${id} ${sh('when=${expression}')}\` (or a script: \`bpmn set <file> ${id} condition.${this.prefix}:resource=deployment://<script>.groovy condition.language=groovy\`).`);
    }
    this.checkVariableEvents(el, def);
  }

  private checkVariableEvents(el: El, def: El): void {
    const events = this.c7(def, 'variableEvents');
    if (events === undefined) return;
    const bad = events.split(',').map((eventName) => eventName.trim()).filter((eventName) => eventName && !VARIABLE_EVENTS.includes(eventName));
    if (!bad.length) return;
    this.push('runtime', 'W_C7_BAD_VALUE', def, el, 'attr:variableEvents', `${this.prefix}:variableEvents="${events}" of ${this.describe(el, undefined)} lists ${bad.join(', ')}; only ${VARIABLE_EVENTS.join(', ')} trigger the condition`, `\`bpmn set <file> ${idOf(el)} ${sh(`${this.addressOf(def, el)?.prefix ?? 'definition.'}${this.prefix}:variableEvents=create, update`)}\`.`);
  }

  /**
   * The activities a compensation throw event may name: those of its own (sub-)process, for an
   * event sub-process also those of its parent scope.
   */
  private checkCompensationRef(el: El, def: El): void {
    const ref = peek<El>(def, 'activityRef');
    if (!ref) return;
    const scope = this.doc.scopeOf(el);
    if (!scope) return;
    const allowed: Array<El | undefined> = [scope];
    if (this.kit.isEventSubProcess(scope)) allowed.push(this.doc.scopeOf(scope));
    if (this.kit.is(ref, 'bpmn:FlowNode') && allowed.includes(this.doc.scopeOf(ref))) return;
    const id = idOf(el)!;
    const sid = idOf(scope) ?? '<scopeId>';
    const candidates = this.doc
      .flowNodes(scope)
      .filter((node) => this.kit.is(node, 'bpmn:Activity') && !this.kit.isEventSubProcess(node))
      .map(idOf)
      .filter((candidateId): candidateId is string => !!candidateId)
      .slice(0, 5);
    const what = this.kit.is(ref, 'bpmn:FlowNode') ? `${this.describe(ref, undefined)}, which is not in ${sid}` : `${idOf(ref)}, which is not a flow node`;
    const key = `${this.addressOf(def, el)?.prefix ?? 'definition.'}activityRef`;
    this.push('deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', el, undefined, 'activityRef', `Compensation event ${id} names activityRef ${what}; the engines compensate only activities of the throw event's own (sub-)process and refuse the file`, `\`bpmn set <file> ${id} ${sh(`${key}=<activityId>`)}\`${candidates.length ? ` (in ${sid}: ${candidates.join(', ')})` : ''}, or compensate the whole scope: \`bpmn set <file> ${id} ${sh(`${key}=`)}\`.`, idOf(ref) ? [idOf(ref)!] : []);
  }

  checkReceiveTask(el: El): void {
    const msg = peek<El>(el, 'messageRef');
    if (msg && !nameOf(msg)) this.push('deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, 'messageName', `Message ${idOf(msg)} of receive task ${idOf(el)} has no name; the engines refuse the file`, `\`bpmn set <file> ${idOf(msg)} name=<MessageName>\`.`, [idOf(msg)!]);
  }

  /**
   * Every flow node of a scope and of its nested sub-processes, except the content of an ad-hoc
   * sub-process, which the engines skip.
   */
  private allFlowNodes(scope: El): El[] {
    const out: El[] = [];
    for (const node of this.doc.flowNodes(scope)) {
      out.push(node);
      if (this.kit.is(node, 'bpmn:SubProcess') && !this.kit.is(node, 'bpmn:AdHocSubProcess')) out.push(...this.allFlowNodes(node));
    }
    return out;
  }

  /**
   * Message and signal subscriptions that share a name in one engine scope: the start events of a
   * process; the event sub-process starts of a scope with the boundary events on it; the boundary
   * events of one activity with its own receive-task message (multi-instance: separate scopes).
   */
  checkSubscriptions(proc: El): void {
    const groups = new Map<string, El[]>();
    const add = (kind: 'message' | 'signal', scope: string, name: string | undefined, el: El): void => {
      if (!name) return;
      const key = `${kind}\u0000${scope}\u0000${name}`;
      groups.set(key, [...(groups.get(key) ?? []), el]);
    };
    for (const node of this.allFlowNodes(proc)) {
      let scope: string | undefined;
      if (this.kit.is(node, 'bpmn:StartEvent')) {
        const parent = this.doc.scopeOf(node);
        if (parent && this.kit.is(parent, 'bpmn:Process')) scope = `start:${idOf(parent)}`;
        else if (parent && this.kit.isEventSubProcess(parent)) scope = `scope:${idOf(this.doc.scopeOf(parent))}`;
      } else if (this.kit.is(node, 'bpmn:BoundaryEvent')) {
        const host = peek<El>(node, 'attachedToRef');
        if (host) scope = `${this.isMultiInstance(host) ? 'body' : 'scope'}:${idOf(host)}`;
      } else if (this.kit.is(node, 'bpmn:ReceiveTask')) {
        add('message', `scope:${idOf(node)}`, nameOf(peek<El>(node, 'messageRef')), node);
      }
      if (!scope) continue;
      add('message', scope, nameOf(peek<El>(this.definitionOf(node, 'bpmn:MessageEventDefinition'), 'messageRef')), node);
      add('signal', scope, nameOf(peek<El>(this.definitionOf(node, 'bpmn:SignalEventDefinition'), 'signalRef')), node);
    }
    for (const [key, els] of groups) {
      if (els.length < 2) continue;
      const [kind, , name] = key.split('\u0000') as ['message' | 'signal', string, string];
      const [first, ...rest] = els;
      for (const el of rest) {
        const code = kind === 'message' ? 'W_C7_DEPLOY_MESSAGE' : 'W_C7_DEPLOY_SIGNAL';
        this.push('deploy', code, el, undefined, kind === 'message' ? `dupMessage:${name}` : `dupSignalEvent:${name}`, `${this.describe(el, undefined)} waits for ${kind} "${name}" like ${idOf(first)} in the same scope; the engines refuse two ${kind} subscriptions with one name`, `Use another ${kind}: \`bpmn set <file> ${idOf(el)} ${kind}=<OtherName>\`.`, [idOf(first)!]);
      }
    }
  }

  /**
   * Link events: catch names are unique in the whole process (sub-processes included); a throw
   * event reached by a sequence flow needs a catch event of its name in the same (sub-)process.
   * A definition without name is skipped: that is a schema error.
   */
  checkLinks(proc: El): void {
    const firstCatch = new Map<string, El>();
    const catchesIn = new Map<El | undefined, Set<string>>();
    const throws: Array<{ el: El; name: string }> = [];
    for (const node of this.allFlowNodes(proc)) {
      const def = this.definitionOf(node, 'bpmn:LinkEventDefinition');
      if (!def) continue;
      const id = idOf(node)!;
      const name = peek<string>(def, 'name');
      if (name === undefined || name === null) continue;
      if (this.kit.is(node, 'bpmn:IntermediateCatchEvent')) {
        const first = firstCatch.get(name);
        if (first) {
          this.push('deploy', 'W_C7_DEPLOY_LINK', node, undefined, `link:dup:${name}`, `Link catch events ${idOf(first)} and ${id} are both named "${name}"; the engines refuse two link catch events with one name in a process (sub-processes included)`, `\`bpmn set <file> ${id} link=<OtherName>\` (and its throw events too).`, [idOf(first)!]);
        } else firstCatch.set(name, node);
        const scope = this.doc.scopeOf(node);
        catchesIn.set(scope, new Set([...(catchesIn.get(scope) ?? []), name]));
      } else if (this.kit.is(node, 'bpmn:IntermediateThrowEvent') && (this.incoming.get(node) ?? []).length) {
        throws.push({ el: node, name });
      }
    }
    for (const { el, name } of throws) {
      const scope = this.doc.scopeOf(el);
      if (catchesIn.get(scope)?.has(name)) continue;
      const id = idOf(el)!;
      const sid = idOf(scope) ?? '<scopeId>';
      const elsewhere = firstCatch.get(name);
      this.push('deploy', 'W_C7_DEPLOY_LINK', el, undefined, `link:target:${name}`, `Link throw event ${id} jumps to "${name}", but ${elsewhere ? `the catch event of that name (${idOf(elsewhere)}) is in another scope` : 'no link catch event has that name'}; the engines resolve links within one (sub-)process (${sid}) and refuse the file`, `Add the catching side in ${sid}: \`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${sid} --link ${sh(name)}\` and continue from it, or point the throw at an existing catch: \`bpmn set <file> ${id} link=<Name>\`.`, elsewhere ? [idOf(elsewhere)!] : []);
    }
  }

  /** Duplicate root signal names (the engines refuse the file even when one is unused). */
  checkSignalNames(): void {
    const seen = new Map<string, El>();
    for (const sig of this.doc.rootElementsOfType('bpmn:Signal')) {
      const name = nameOf(sig);
      if (!name) continue;
      const first = seen.get(name);
      if (first) this.push('deploy', 'W_C7_DEPLOY_SIGNAL', sig, undefined, `dupSignal:${name}`, `Signals ${idOf(first)} and ${idOf(sig)} are both named "${name}"; the engines refuse duplicate signal names`, `\`bpmn set <file> ${idOf(sig)} name=<OtherName>\` (or point its events at ${idOf(first)} and remove it).`, [idOf(first)!]);
      else seen.set(name, sig);
    }
  }

  /**
   * Start events of a process or sub-process: each needs one, also an empty one; a transaction
   * without one deploys and fails when reached (an event sub-process: E_EVENT_SUBPROCESS_NO_START).
   * A process allows one none or timer start event, a sub-process one start event at all.
   */
  checkStartEvents(scope: El): void {
    const id = idOf(scope) ?? '<scopeId>';
    const nodes = this.doc.flowNodes(scope);
    const starts = nodes.filter((node) => this.kit.is(node, 'bpmn:StartEvent'));
    const isProcess = this.kit.is(scope, 'bpmn:Process');
    const transaction = this.kit.is(scope, 'bpmn:Transaction');
    const kind = isProcess ? 'Process' : this.kit.isEventSubProcess(scope) ? 'Event sub-process' : transaction ? 'Transaction' : 'Sub-process';
    if (!starts.length) {
      if (this.kit.isEventSubProcess(scope)) return;
      const what = nodes.length ? 'has no start event' : 'is empty, without a start event';
      const add = nodes.length
        ? `Add one: \`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${id}, then connect it)`
        : `Add content: \`bpmn add <file> startEvent "<Name>" --in ${id}\` and continue from it`;
      const hint = `${add}${isProcess ? '' : `, or remove it: \`bpmn remove <file> ${id}\``}.`;
      if (transaction) {
        this.push('runtime', 'W_C7_TRANSACTION_NO_START', scope, undefined, 'start:none', `${kind} ${id} ${what}: it deploys, but every instance that reaches it fails ("No initial activity found for subprocess ${id}")`, hint);
      } else {
        this.push('deploy', 'W_C7_DEPLOY_START_EVENT', scope, undefined, 'start:none', `${kind} ${id} ${what}; the engines refuse the file (${isProcess ? 'process' : 'subProcess'} must define a startEvent element)`, hint);
      }
      return;
    }
    const limited = isProcess ? starts.filter((start) => this.actedOn(start).every((definition) => this.kit.is(definition, 'bpmn:TimerEventDefinition'))) : starts;
    const [first, ...rest] = limited;
    for (const extra of rest) {
      const sid = idOf(extra)!;
      const message = isProcess
        ? `Start event ${sid} is a second none or timer start event of process ${id} (with ${idOf(first)}); the engines allow only one and refuse the file`
        : `${kind} ${id} has ${limited.length} start events (${limited.map(idOf).join(', ')}); the engines allow only one in a sub-process and refuse the file`;
      this.push('deploy', 'W_C7_DEPLOY_START_EVENT', extra, undefined, 'start:multiple', message, this.extraStartHint(scope, first!, extra), [idOf(first)!]);
    }
  }

  /** The flow nodes reachable from `from` (without `from`, unless a loop leads back to it). */
  private reachableFrom(from: El): Set<El> {
    const seen = new Set<El>();
    const queue = [from];
    while (queue.length) {
      for (const flow of this.outgoing.get(queue.shift()!) ?? []) {
        const target = peek<El>(flow, 'targetRef');
        if (target && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    return seen;
  }

  /**
   * How to get rid of a second start event `extra` next to `first`, without running a node twice:
   * its flows into what `first` reaches go with it, a branch of its own moves to `first` unless it
   * runs into a node `first` reaches. A process may keep it with another trigger.
   * The hint names the nodes (no end events) a branch of its own runs into that `first` reaches as well.
   */
  private extraStartHint(scope: El, first: El, extra: El): string {
    const sid = idOf(extra)!;
    const fid = idOf(first)!;
    const reached = this.reachableFrom(first);
    const flows = this.outgoing.get(extra) ?? [];
    const own = flows.filter((flow) => {
      const target = peek<El>(flow, 'targetRef');
      return target && target !== first && !reached.has(target);
    });
    const into = flows.filter((flow) => !own.includes(flow));
    const meet = new Set<string>();
    for (const flow of own) {
      const target = peek<El>(flow, 'targetRef')!;
      for (const node of this.reachableFrom(target)) if (reached.has(node) && !this.kit.is(node, 'bpmn:EndEvent') && idOf(node)) meet.add(idOf(node)!);
    }
    const ids = (els: El[]): string => els.map(idOf).join(', ');
    const targets = (els: El[]): string => [...new Set(els.map((flow) => idOf(peek<El>(flow, 'targetRef'))).filter((targetId): targetId is string => !!targetId))].join(', ');
    const remove = `\`bpmn remove <file> ${sid}\``;
    const parts: string[] = [];
    if (!own.length) {
      parts.push(`Remove it: ${remove}${into.length ? ` (${fid} already leads to ${targets(into)}; ${ids(into)} go${into.length === 1 ? 'es' : ''} with it)` : ''}`);
    } else if (meet.size) {
      const names = [...meet].slice(0, 3).join(', ') + (meet.size > 3 ? ', ...' : '');
      parts.push(`Remove it: ${remove} (${targets(own)} is then no longer started; starting it from ${fid} instead would run ${names}, which ${fid} reaches too, once per branch)`);
    } else {
      const moves = own.map((flow) => `\`bpmn set <file> ${idOf(flow)} source=${fid}\``).join(', ');
      const notes = [(this.outgoing.get(first) ?? []).length ? `${fid} then starts both branches in parallel` : '', into.length ? `${ids(into)} into ${targets(into)}, which ${fid} already reaches, go${into.length === 1 ? 'es' : ''} with ${sid}` : ''].filter(Boolean);
      parts.push(`Start its branch from ${fid}: ${moves}, then ${remove}${notes.length ? ` (${notes.join('; ')})` : ''}`);
    }
    if (this.kit.is(scope, 'bpmn:Process')) parts.push(`give it another trigger, which keeps it as a second way into the process: \`bpmn set <file> ${sid} trigger=message message=<Name>\``);
    const again = this.kit.isEventSubProcess(scope) ? this.ownEventSubProcess(scope, extra) : '';
    return `${parts.join(', or ')}${again ? `; ${again}` : ''}.`;
  }

  /** `then keep its <trigger> trigger in an event sub-process of its own: ...` for `extra`. */
  private ownEventSubProcess(scope: El, extra: El): string {
    const def = this.actingDefinition(extra) ?? list(extra, 'eventDefinitions')[0];
    if (!def) return '';
    const trigger = triggerName(def);
    const ref = (prop: string): string => sh(nameOf(peek<El>(def, prop)) ?? '<Name>');
    const option: Record<string, string> = {
      message: `--message ${ref('messageRef')}`,
      signal: `--signal ${ref('signalRef')}`,
      error: `--error ${ref('errorRef')}`,
      escalation: `--escalation ${ref('escalationRef')}`,
      timer: '--timer <value>',
      conditional: `--when ${sh('${expression}')}`,
    };
    const opts = [option[trigger] ?? '', peek<boolean>(extra, 'isInterrupting') === false ? '--non-interrupting' : ''].filter(Boolean).join(' ');
    return `then keep its ${trigger} trigger in an event sub-process of its own: \`bpmn add <file> eventSubProcess:${trigger} "<Name>" --in ${idOf(this.doc.scopeOf(scope)) ?? '<parentId>'}${opts ? ` ${opts}` : ''}\``;
  }
}
