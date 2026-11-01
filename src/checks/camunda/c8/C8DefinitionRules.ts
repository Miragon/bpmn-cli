import { type BpmnElement } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import type { C8TaskRules } from './C8TaskRules.js';
import type { C8TimerRules } from './C8TimerRules.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C8DefinitionRules extends C8Rules {
  constructor(
    context: RuleContext,
    private readonly tasks: C8TaskRules,
    private readonly timers: C8TimerRules,
  ) {
    super(context);
  }

  check(element: BpmnElement, reporter: RuleReporter): void {
    if (element.is('bpmn:ReceiveTask')) {
      this.checkMessageCatch(element, reporter);
    }
  }

  checkDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    if (def.is('bpmn:MessageEventDefinition')) {
      this.checkMessageDefinition(el, def, reporter);
    } else if (def.is('bpmn:TimerEventDefinition')) {
      this.timers.check(el, reporter);
    } else if (def.is('bpmn:SignalEventDefinition')) {
      this.checkSignalDefinition(el, def, reporter);
    } else if (def.is('bpmn:ErrorEventDefinition')) {
      this.checkErrorDefinition(el, def, reporter);
    } else if (def.is('bpmn:EscalationEventDefinition')) {
      this.checkEscalationDefinition(el, def, reporter);
    } else if (def.is('bpmn:CompensateEventDefinition')) {
      this.checkCompensateDefinition(el, def, reporter);
    } else if (def.is('bpmn:ConditionalEventDefinition')) {
      this.checkConditionalDefinition(el, def, reporter);
    }
  }

  private checkCompensationBoundary(el: BpmnElement, reporter: RuleReporter): void {
    const scope = this.document.scopes.scopeOf(el);
    const associated = (scope?.list('artifacts') ?? []).some((artifact) => artifact.is('bpmn:Association') && artifact.peek<BpmnElement>('sourceRef') === el);
    const out = this.outgoing.get(el) ?? [];
    if (!associated || out.length) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_DEFINITION', element: el, subject: 'compensationBoundary', message: `Compensation boundary event ${el.id} ${!associated ? 'has no association to a compensation handler' : 'has an outgoing sequence flow'}; Camunda 8 refuses the file`, hint: !associated ? `Connect it to its handler (an activity with isForCompensation=true): \`bpmn connect <file> ${el.id} <handlerId>\`.` : `Remove the flow (\`bpmn remove <file> ${out[0]?.id} --no-bridge\`) and connect the handler instead: \`bpmn connect <file> ${el.id} <handlerId>\`.` });
    }
  }

  private checkMessageDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    if (el.is('bpmn:ThrowEvent')) {
      this.tasks.checkMessageThrow(el, def, reporter);
    } else {
      this.checkMessageCatch(el, reporter);
    }
  }

  private checkSignalDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el);
    const sig = def.peek<BpmnElement>('signalRef');
    if (!sig) {
      reporter.deploy({ code: 'W_C8_DEPLOY_SIGNAL', element: el, subject: 'signalRef', message: `${label} has no signal; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} signal=<SignalName>\`.` });
    } else if (!this.nameAttr(sig)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_SIGNAL', element: el, subject: 'signalName', message: `Signal ${sig.id} of ${label} has no name; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${sig.id} name=<SignalName>\`.`, related: [sig.id] });
    } else if (el.is('bpmn:StartEvent') && this.isFeel(this.nameOf(sig))) {
      reporter.deploy({ code: 'W_C8_DEPLOY_SIGNAL', element: el, subject: 'signalName', message: `Start event ${el.id} catches the signal "${this.nameOf(sig)}", a FEEL expression; Camunda 8 needs a static signal name on start events and refuses the file`, hint: `\`bpmn set <file> ${sig.id} name=<SignalName>\`.`, related: [sig.id] });
    }
  }

  private checkErrorDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    if (el.is('bpmn:ThrowEvent')) {
      this.checkThrownError(el, def, reporter);
    } else {
      this.checkCaughtError(el, def, reporter);
    }
  }

  private checkThrownError(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el);
    const err = def.peek<BpmnElement>('errorRef');
    if (!err) {
      reporter.deploy({ code: 'W_C8_DEPLOY_ERROR', element: el, subject: 'errorRef', message: `${label} throws no error (no errorRef); Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} error=<ErrorName> errorCode=<CODE>\`.` });
    } else if (this.missing(err.peek<string>('errorCode'))) {
      reporter.deploy({ code: 'W_C8_DEPLOY_ERROR', element: el, subject: 'errorCode', message: `Error ${err.id} thrown by ${label} has no errorCode; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} errorCode=<CODE>\`.`, related: [err.id] });
    }
  }

  private checkCaughtError(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el);
    const err = def.peek<BpmnElement>('errorRef');
    const code = err?.peek<string>('errorCode');
    if (this.isFeel(code)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_ERROR', element: el, subject: 'errorCode', message: `${label} catches the error code "${code}", an expression; Camunda 8 needs a static code on catching error events and refuses the file`, hint: `\`bpmn set <file> ${el.id} errorCode=<CODE>\` (or no code: it catches every error).`, related: err ? [err.id] : [] });
    }
    if (this.nonInterrupting(el)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_ERROR', element: el, subject: 'nonInterrupting', message: `${label} is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)`, hint: `\`bpmn set <file> ${el.id} nonInterrupting=false\`.` });
    }
  }

  private checkEscalationDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    if (el.is('bpmn:ThrowEvent')) {
      this.checkThrownEscalation(el, def, reporter);
    } else if (el.is('bpmn:BoundaryEvent')) {
      this.checkEscalationHost(el, reporter);
    }
  }

  private checkThrownEscalation(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el);
    const esc = def.peek<BpmnElement>('escalationRef');
    if (!esc) {
      reporter.deploy({ code: 'W_C8_DEPLOY_ESCALATION', element: el, subject: 'escalationRef', message: `${label} throws no escalation (no escalationRef); Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} escalation=<Name> escalationCode=<CODE>\`.` });
    } else if (this.missing(esc.peek<string>('escalationCode'))) {
      reporter.deploy({ code: 'W_C8_DEPLOY_ESCALATION', element: el, subject: 'escalationCode', message: `Escalation ${esc.id} thrown by ${label} has no escalationCode; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} escalationCode=<CODE>\`.`, related: [esc.id] });
    }
  }

  private checkEscalationHost(el: BpmnElement, reporter: RuleReporter): void {
    const host = el.peek<BpmnElement>('attachedToRef');
    if (!host || host.is('bpmn:SubProcess') || host.is('bpmn:CallActivity')) {
      return;
    }
    reporter.deploy({ code: 'W_C8_DEPLOY_ESCALATION', element: el, subject: 'escalationHost', message: `Escalation boundary event ${el.id} is attached to ${this.describe(host)}; Camunda 8 allows it only on sub-processes and call activities and refuses the file`, hint: `Attach it elsewhere (\`bpmn move <file> ${el.id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${el.id}\`.`, related: [host.id] });
  }

  private checkCompensateDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    if (el.is('bpmn:ThrowEvent')) {
      this.checkCompensationRef(el, def, reporter);
    }
    if (el.is('bpmn:BoundaryEvent')) {
      this.checkCompensationBoundary(el, reporter);
    }
  }

  private checkConditionalDefinition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const body = def.peek<BpmnElement>('condition')?.peek<string>('body');
    this.checkFeel(el, undefined, 'condition', `The condition of conditional event ${el.id}`, body, `\`bpmn set <file> ${el.id} ${ShellWords.quote(`when==${this.feelOf((body ?? '').trim().slice(1))}`)}\` (check the FEEL syntax).`, reporter);
    if (!def.peek<BpmnElement>('condition') || this.isFeel(body)) {
      return;
    }
    reporter.deploy({ code: 'W_C8_DEPLOY_EXPRESSION', element: el, subject: 'condition', message: `The condition "${(body ?? '').trim()}" of conditional event ${el.id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, hint: `\`bpmn set <file> ${el.id} ${ShellWords.quote(`when==${this.feelOf(body ?? '')}`)}\` (check the FEEL syntax).` });
  }

  private checkMessageCatch(el: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el);
    const msg = this.messageOf(el);
    if (!msg) {
      reporter.deploy({ code: 'W_C8_DEPLOY_MESSAGE', element: el, subject: 'messageRef', message: `${label} has no message; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} message=<MessageName>\` (creates the bpmn:Message), then give it a correlation key: \`bpmn ext add <file> <messageId> ${this.zeebeName('subscription')} correlationKey==<expression>\`.` });
      return;
    }
    const name = this.nameAttr(msg);
    if (!name) {
      reporter.deploy({ code: 'W_C8_DEPLOY_MESSAGE', element: el, subject: 'messageName', message: `Message ${msg.id} of ${label} has no name; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${msg.id} name=<MessageName>\`.`, related: [msg.id] });
      return;
    }
    const processStart = el.is('bpmn:StartEvent') && (el.parent as BpmnElement).is('bpmn:Process');
    if (processStart) {
      if (this.isFeel(name)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_MESSAGE', element: el, subject: 'messageName', message: `Start event ${el.id} catches the message "${name}", a FEEL expression; Camunda 8 needs a static message name on process start events and refuses the file`, hint: `\`bpmn set <file> ${msg.id} name=<MessageName>\`.`, related: [msg.id] });
      }
      return;
    }
    const subs = this.zeebe(msg, 'subscription');
    if (subs.length > 1) {
      return;
    }
    if (!subs.length) {
      reporter.deploy({ code: 'W_C8_DEPLOY_MESSAGE', element: el, subject: `subscription:${msg.id}`, message: `Message ${msg.id} ("${name}") of ${label} has no ${this.zeebeName('subscription')}: Camunda 8 needs one with the correlation key that matches a message to an instance and refuses the file`, hint: `\`bpmn ext add <file> ${msg.id} ${this.zeebeName('subscription')} correlationKey==<expression>\` (e.g. correlationKey==orderId).`, related: [msg.id] });
      return;
    }
    const key = this.attr(subs[0], 'correlationKey');
    if (this.blank(key)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_MESSAGE', element: el, subject: `correlationKey:${msg.id}`, message: `The ${this.zeebeName('subscription')} of message ${msg.id} ("${name}") has no correlationKey; Camunda 8 refuses the file`, hint: this.fixHint(msg, undefined, subs[0]!, { correlationKey: '=<expression>' }), related: [msg.id] });
    } else if (!this.isFeel(key)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EXPRESSION', element: el, subject: `correlationKey:${msg.id}`, message: `The correlationKey "${key}" of message ${msg.id} is a static value; Camunda 8 needs a FEEL expression (=${key!.trim()}) and refuses the file`, hint: this.fixHint(msg, undefined, subs[0]!, { correlationKey: `=${key!.trim()}` }), related: [msg.id] });
    }
  }

  private checkCompensationRef(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const ref = def.peek<BpmnElement>('activityRef');
    if (!ref) {
      return;
    }
    const scope = this.document.scopes.scopeOf(el);
    if (this.document.scopes.scopeOf(ref) === scope) {
      return;
    }
    reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_DEFINITION', element: el, subject: 'activityRef', message: `Compensation event ${el.id} names ${ref.id}, which is not in its own scope ${scope?.id}; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} definition.activityRef=<activityId>\` (an activity of ${scope?.id}), or \`definition.activityRef=\` to compensate the whole scope.`, related: [ref.id] });
  }
}
