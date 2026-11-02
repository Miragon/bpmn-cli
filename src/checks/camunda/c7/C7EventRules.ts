import { type BpmnElement, Kinds } from '../../../model/index.js';
import type { C7ImplementationRules } from './C7ImplementationRules.js';
import { C7Rules } from './C7Rules.js';
import { CamundaRules } from '../rules/CamundaRules.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C7EventRules extends C7Rules {
  private static readonly VARIABLE_EVENTS = ['create', 'update', 'delete'];

  constructor(
    context: RuleContext,
    private readonly implementation: C7ImplementationRules,
  ) {
    super(context);
  }

  check(element: BpmnElement, reporter: RuleReporter): void {
    if (reporter.executable && element.is('bpmn:Event')) {
      this.checkEvent(element, reporter);
    }
    if (reporter.executable && element.is('bpmn:ReceiveTask')) {
      this.checkReceiveTask(element, reporter);
    }
  }

  private checkMultipleDefinitions(el: BpmnElement, reporter: RuleReporter): void {
    const defs = el.list('eventDefinitions');
    if (defs.length < 2) {
      return;
    }
    const kinds = defs.map((definition) => this.triggerName(definition));
    const acting = this.actingDefinition(el);
    const what = acting
      ? `the engines act on the ${this.triggerName(acting)} only and ignore the ${kinds.filter((_kind, index) => defs[index] !== acting).join(' and ')}`
      : 'the engines act on one of them only and ignore the others';
    const keep = acting ? this.triggerName(acting) : '<trigger>';
    reporter.runtime({ code: 'W_C7_MULTIPLE_EVENT_DEFINITIONS', element: el, subject: 'definitions', message: `${this.describe(el, undefined)} has ${defs.length} event definitions (${kinds.join(', ')}); ${what}`, hint: `Keep one: \`bpmn set <file> ${el.id} trigger=${keep}\` (keeps that definition, drops the others), and model each other trigger as its own event (behind an event-based gateway, or another boundary / start event). One definition is edited with \`bpmn set <file> ${el.id} 'definition[<n>].<key>=<value>'\`.` });
  }

  checkEvent(el: BpmnElement, reporter: RuleReporter): void {
    C7EventRules.checkCompensationHost(el, reporter);
    this.checkMultipleDefinitions(el, reporter);
    for (const def of this.actedOn(el)) {
      this.checkDefinition(el, def, reporter);
    }
  }

  private static checkCompensationHost(el: BpmnElement, reporter: RuleReporter): void {
    const host = el.is('bpmn:BoundaryEvent') ? el.peek<BpmnElement>('attachedToRef') : undefined;
    if (!host || host.peek<boolean>('isForCompensation') !== true) {
      return;
    }
    reporter.deploy({ code: 'W_C7_DEPLOY_BOUNDARY_HOST', element: el, subject: 'compensationHost', message: `Boundary event ${el.id} is attached to the compensation handler ${host.id}; the engines refuse boundary events on compensation handlers`, hint: `Remove it: \`bpmn remove <file> ${el.id}\` (or attach it to a normal activity: \`bpmn move <file> ${el.id} --on <activityId>\`).`, related: [host.id], fix: { op: 'remove', ids: [el.id] } });
  }

  private checkDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    if (def.is('bpmn:MessageEventDefinition')) {
      this.checkMessageDefinition(el, def, reporter);
    } else if (def.is('bpmn:SignalEventDefinition')) {
      this.checkSignalDefinition(el, def, reporter);
    } else if (def.is('bpmn:ErrorEventDefinition') && el.is('bpmn:EndEvent')) {
      this.checkErrorDefinition(el, def, reporter);
    } else if (def.is('bpmn:EscalationEventDefinition')) {
      this.checkEscalationDefinition(el, def, reporter);
    } else if (def.is('bpmn:CompensateEventDefinition') && C7EventRules.isThrowing(el)) {
      this.checkCompensationRef(el, def, reporter);
    } else if (def.is('bpmn:TimerEventDefinition')) {
      this.checkTimerDefinition(el, def, reporter);
    } else if (def.is('bpmn:ConditionalEventDefinition')) {
      this.checkConditionalDefinition(el, def, reporter);
    }
  }

  private static isCatching(el: BpmnElement): boolean {
    return el.is('bpmn:StartEvent') || el.is('bpmn:IntermediateCatchEvent') || el.is('bpmn:BoundaryEvent');
  }

  private static isThrowing(el: BpmnElement): boolean {
    return el.is('bpmn:IntermediateThrowEvent') || el.is('bpmn:EndEvent');
  }

  private checkMessageDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    if (C7EventRules.isThrowing(el)) {
      this.implementation.checkImplementation(def, el, this.describe(el, undefined), reporter, { event: el });
      return;
    }
    if (!C7EventRules.isCatching(el)) {
      return;
    }
    const label = this.describe(el, undefined);
    const msg = def.peek<BpmnElement>('messageRef');
    if (!msg) {
      reporter.deploy({ code: 'W_C7_DEPLOY_MESSAGE', element: el, subject: 'messageRef', message: `${label} has no message; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} message=<MessageName>\` (creates the bpmn:Message).` });
    } else if (!this.nameOf(msg)) {
      reporter.deploy({ code: 'W_C7_DEPLOY_MESSAGE', element: el, subject: 'messageName', message: `Message ${msg.id} of ${label} has no name; the engines refuse the file`, hint: `\`bpmn set <file> ${msg.id} name=<MessageName>\`.`, related: [msg.id] });
    }
  }

  private checkSignalDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el, undefined);
    const sig = def.peek<BpmnElement>('signalRef');
    if (!sig) {
      reporter.deploy({ code: 'W_C7_DEPLOY_SIGNAL', element: el, subject: 'signalRef', message: `${label} has no signal; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} signal=<SignalName>\`.` });
    } else if (!this.nameOf(sig)) {
      reporter.deploy({ code: 'W_C7_DEPLOY_SIGNAL', element: el, subject: 'signalName', message: `Signal ${sig.id} of ${label} has no name; the engines refuse the file`, hint: `\`bpmn set <file> ${sig.id} name=<SignalName>\`.`, related: [sig.id] });
    }
  }

  private checkErrorDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el, undefined);
    const err = def.peek<BpmnElement>('errorRef');
    if (!err) {
      reporter.deploy({ code: 'W_C7_DEPLOY_ERROR', element: el, subject: 'errorRef', message: `${label} throws no error (no errorRef); the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} error=<ErrorName> errorCode=<CODE>\`.` });
    } else if (!this.nonEmpty(err.peek<string>('errorCode'))) {
      reporter.deploy({ code: 'W_C7_DEPLOY_ERROR', element: el, subject: 'errorCode', message: `Error ${err.id} thrown by ${label} has no errorCode; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} errorCode=<CODE>\`.`, related: [err.id] });
    }
  }

  private checkEscalationDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    if (el.is('bpmn:BoundaryEvent')) {
      this.checkEscalationHost(el, reporter);
    } else if (C7EventRules.isThrowing(el)) {
      this.checkThrownEscalation(el, def, reporter);
    }
  }

  private checkThrownEscalation(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el, undefined);
    const esc = def.peek<BpmnElement>('escalationRef');
    if (esc && !this.nonEmpty(esc.peek<string>('escalationCode'))) {
      reporter.deploy({ code: 'W_C7_DEPLOY_ESCALATION', element: el, subject: 'escalationCode', message: `Escalation ${esc.id} thrown by ${label} has no escalationCode; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} escalationCode=<CODE>\`.`, related: [esc.id] });
    } else if (!esc) {
      reporter.deploy({ code: 'W_C7_DEPLOY_ESCALATION', element: el, subject: 'escalationRef', message: `${label} throws no escalation (no escalationRef); the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} escalation=<Name> escalationCode=<CODE>\`.` });
    }
  }

  private checkEscalationHost(el: BpmnElement, reporter: RuleReporter): void {
    const host = el.peek<BpmnElement>('attachedToRef');
    if (!host || ['bpmn:SubProcess', 'bpmn:CallActivity', 'bpmn:UserTask'].some((type) => host.is(type))) {
      return;
    }
    reporter.deploy({ code: 'W_C7_DEPLOY_ESCALATION', element: el, subject: 'escalationHost', message: `Escalation boundary event ${el.id} is attached to ${this.describe(host, undefined)}; the engines allow it only on sub-processes, call activities and user tasks and refuse the file`, hint: `Attach it elsewhere (\`bpmn move <file> ${el.id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${el.id}\`.`, related: [host.id] });
  }

  private checkTimerDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    if (CamundaRules.TIMER_ELEMENTS.some((timerKind) => def.peek<BpmnElement>(timerKind))) {
      return;
    }
    reporter.deploy({ code: 'W_C7_DEPLOY_EVENT_DEFINITION', element: el, subject: 'timer', message: `Timer of ${this.describe(el, undefined)} has no date, cycle or duration; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} timer=PT1H\` (or R/PT1H, or a date).` });
  }

  private checkConditionalDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const cond = def.peek<BpmnElement>('condition');
    if (cond && this.emptyCondition(cond)) {
      reporter.runtime({ code: 'W_C7_EMPTY_CONDITION', element: el, subject: 'emptyCondition', message: `Conditional event ${el.id} has an empty condition (no expression and no ${this.prefix}:resource): it deploys, but evaluating it fails when the process runs`, hint: `\`bpmn set <file> ${el.id} ${ShellWords.quote('when=${expression}')}\` (or a script: \`bpmn set <file> ${el.id} condition.${this.prefix}:resource=deployment://<script>.groovy condition.language=groovy\`).` });
    }
    this.checkVariableEvents(el, def, reporter);
  }

  private checkVariableEvents(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const events = this.c7(def, 'variableEvents');
    if (events === undefined) {
      return;
    }
    const bad = events.split(',').map((eventName) => eventName.trim()).filter((eventName) => eventName && !C7EventRules.VARIABLE_EVENTS.includes(eventName));
    if (!bad.length) {
      return;
    }
    reporter.runtime({ code: 'W_C7_BAD_VALUE', element: def, owner: el, subject: 'attr:variableEvents', message: `${this.prefix}:variableEvents="${events}" of ${this.describe(el, undefined)} lists ${bad.join(', ')}; only ${C7EventRules.VARIABLE_EVENTS.join(', ')} trigger the condition`, hint: `\`bpmn set <file> ${el.id} ${ShellWords.quote(`${this.addressOf(def, el)?.prefix ?? 'definition.'}${this.prefix}:variableEvents=create, update`)}\`.` });
  }

  private checkCompensationRef(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const ref = def.peek<BpmnElement>('activityRef');
    const scope = this.document.scopes.scopeOf(el);
    if (!ref || !scope) {
      return;
    }
    const allowed: Array<BpmnElement | undefined> = [scope];
    if (Kinds.isEventSubProcess(scope)) {
      allowed.push(this.document.scopes.scopeOf(scope));
    }
    if (ref.is('bpmn:FlowNode') && allowed.includes(this.document.scopes.scopeOf(ref))) {
      return;
    }
    const sid = scope.id ?? '<scopeId>';
    const candidates = this.document.scopes
      .flowNodes(scope)
      .filter((node) => node.is('bpmn:Activity') && !Kinds.isEventSubProcess(node))
      .map(({ id: nodeId }) => nodeId)
      .slice(0, 5);
    const what = ref.is('bpmn:FlowNode') ? `${this.describe(ref, undefined)}, which is not in ${sid}` : `${ref.id}, which is not a flow node`;
    const key = `${this.addressOf(def, el)?.prefix ?? 'definition.'}activityRef`;
    reporter.deploy({ code: 'W_C7_DEPLOY_EVENT_DEFINITION', element: el, subject: 'activityRef', message: `Compensation event ${el.id} names activityRef ${what}; the engines compensate only activities of the throw event's own (sub-)process and refuse the file`, hint: `\`bpmn set <file> ${el.id} ${ShellWords.quote(`${key}=<activityId>`)}\`${candidates.length ? ` (in ${sid}: ${candidates.join(', ')})` : ''}, or compensate the whole scope: \`bpmn set <file> ${el.id} ${ShellWords.quote(`${key}=`)}\`.`, related: ref.id ? [ref.id] : [] });
  }

  private checkReceiveTask(el: BpmnElement, reporter: RuleReporter): void {
    const msg = el.peek<BpmnElement>('messageRef');
    if (msg && !this.nameOf(msg)) {
      reporter.deploy({ code: 'W_C7_DEPLOY_MESSAGE', element: el, subject: 'messageName', message: `Message ${msg.id} of receive task ${el.id} has no name; the engines refuse the file`, hint: `\`bpmn set <file> ${msg.id} name=<MessageName>\`.`, related: [msg.id] });
    }
  }
}
