import { type BpmnElement, Kinds } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import { LinkEvents } from '../values/LinkEvents.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C8SubscriptionRules extends C8Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    if (element.is('bpmn:Definitions')) {
      this.checkFeelNames(reporter);
    }
    if (element.is('bpmn:Process') || (element.is('bpmn:SubProcess') && !element.is('bpmn:AdHocSubProcess'))) {
      this.checkStartEvents(element, reporter);
    }
    if (element.is('bpmn:Process') || element.is('bpmn:SubProcess')) {
      this.checkSubscriptionScopes(element, reporter);
    }
    if (element.is('bpmn:Process')) {
      this.checkLinks(element, reporter);
    }
  }

  private checkStartEvents(scope: BpmnElement, reporter: RuleReporter): void {
    const starts = this.document.scopes.flowNodes(scope).filter((node) => node.is('bpmn:StartEvent'));
    if (scope.is('bpmn:Process')) {
      C8SubscriptionRules.checkProcessStarts(scope, starts, reporter);
      return;
    }
    if (scope.is('bpmn:AdHocSubProcess') || scope.is('bpmn:Transaction')) {
      return;
    }
    const id = scope.id;
    const event = Kinds.isEventSubProcess(scope);
    if (starts.length !== 1) {
      reporter.deploy({ code: 'W_C8_DEPLOY_START_EVENT', element: scope, subject: 'startCount', message: `${event ? 'Event sub-process' : 'Sub-process'} ${id} has ${starts.length ? `${starts.length} start events` : 'no start event'}; Camunda 8 needs exactly one and refuses the file`, hint: C8SubscriptionRules.startCountHint(id, starts, event) });
    }
  }

  private static startCountHint(id: string, starts: BpmnElement[], event: boolean): string {
    if (starts.length) {
      return `Keep one: \`bpmn remove <file> ${starts[1]?.id}\`.`;
    }
    return event ? `\`bpmn add <file> startEvent:message "<Name>" --in ${id} message=<MessageName>\` (or timer, error, signal, escalation, conditional).` : `\`bpmn add <file> startEvent "<Name>" --in ${id}\`, then connect it to the first node.`;
  }

  private static checkProcessStarts(scope: BpmnElement, starts: BpmnElement[], reporter: RuleReporter): void {
    if (!starts.length) {
      reporter.deploy({ code: 'W_C8_DEPLOY_START_EVENT', element: scope, subject: 'noStart', message: `Process ${scope.id} has no start event; Camunda 8 refuses the file`, hint: `\`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${scope.id}).` });
      return;
    }
    const none = starts.filter((start) => !start.list('eventDefinitions').length);
    for (const extra of none.slice(1)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_START_EVENT', element: extra, subject: 'noneStart', message: `Process ${scope.id} has ${none.length} none start events (${none.map(({ id: startId }) => startId).join(', ')}); Camunda 8 allows one and refuses the file`, hint: `Remove ${extra.id} (\`bpmn remove <file> ${extra.id}\`) or give it a trigger: \`bpmn set <file> ${extra.id} trigger=message message=<MessageName>\`.`, related: [none[0]!.id] });
    }
  }

  private static soleDefinition(el: BpmnElement, type: string): BpmnElement | undefined {
    const defs = el.list('eventDefinitions');
    return defs.length === 1 && defs[0]?.is(type) ? defs[0] : undefined;
  }

  private subscriptionName(el: BpmnElement, kind: 'message' | 'signal'): string | undefined {
    if (kind === 'signal') {
      return this.nameOf(C8SubscriptionRules.soleDefinition(el, 'bpmn:SignalEventDefinition')?.peek<BpmnElement>('signalRef'));
    }
    return this.nameOf(el.is('bpmn:ReceiveTask') ? el.peek<BpmnElement>('messageRef') : C8SubscriptionRules.soleDefinition(el, 'bpmn:MessageEventDefinition')?.peek<BpmnElement>('messageRef'));
  }

  private checkUniqueNames(els: BpmnElement[], kind: 'message' | 'signal', where: string, subjectPrefix: string, reporter: RuleReporter): void {
    const byName = new Map<string, BpmnElement[]>();
    for (const el of els) {
      const name = this.subscriptionName(el, kind);
      if (name && !this.isFeel(name)) {
        byName.set(name, [...(byName.get(name) ?? []), el]);
      }
    }
    for (const [name, [first, ...rest]] of byName) {
      rest.forEach((el) => this.reportRepeat(el, first!, kind, name, where, subjectPrefix, reporter));
    }
  }

  private reportRepeat(el: BpmnElement, first: BpmnElement, kind: 'message' | 'signal', name: string, where: string, subjectPrefix: string, reporter: RuleReporter): void {
    reporter.deploy({ code: kind === 'message' ? 'W_C8_DEPLOY_MESSAGE' : 'W_C8_DEPLOY_SIGNAL', element: el, subject: `${subjectPrefix}:${name}`, message: `${this.describe(el)} waits for the ${kind} "${name}" like ${this.describe(first)} ${where}; Camunda 8 refuses one ${kind} name twice there`, hint: `Use another ${kind}: \`bpmn set <file> ${el.id} ${kind}=<Other${kind === 'message' ? 'Message' : 'Signal'}>\`${kind === 'message' ? ` (and a ${this.zeebeName('subscription')} on it)` : ''}.`, related: [first.id] });
  }

  private checkBoundaries(activity: BpmnElement, nodes: BpmnElement[], reporter: RuleReporter): void {
    const boundaries = nodes.filter((node) => node.is('bpmn:BoundaryEvent') && node.peek<BpmnElement>('attachedToRef') === activity);
    if (boundaries.length) {
      this.checkUniqueNames([...(activity.is('bpmn:ReceiveTask') ? [activity] : []), ...boundaries], 'message', `on ${activity.id}`, `boundaryMessage:${activity.id}`, reporter);
      this.checkUniqueNames(boundaries, 'signal', `on ${activity.id}`, `boundarySignal:${activity.id}`, reporter);
      this.checkErrorCodes(boundaries, `the boundary events of ${activity.id}`, reporter);
    }
  }

  private checkSubscriptionScopes(scope: BpmnElement, reporter: RuleReporter): void {
    const nodes = this.document.scopes.flowNodes(scope);
    for (const activity of nodes.filter((node) => node.is('bpmn:Activity'))) {
      this.checkBoundaries(activity, nodes, reporter);
    }
    for (const gw of nodes.filter((node) => node.is('bpmn:EventBasedGateway'))) {
      const targets = (this.outgoing.get(gw) ?? []).map((flow) => flow.peek<BpmnElement>('targetRef')).filter((target): target is BpmnElement => !!target && target.is('bpmn:IntermediateCatchEvent'));
      this.checkUniqueNames(targets, 'message', `after event-based gateway ${gw.id}`, `gatewayMessage:${gw.id}`, reporter);
    }
    const eventSubStarts = nodes.filter((node) => Kinds.isEventSubProcess(node)).flatMap((sp) => this.document.scopes.flowNodes(sp).filter((node) => node.is('bpmn:StartEvent')));
    this.checkUniqueNames(eventSubStarts, 'message', `in the event sub-processes of ${scope.id}`, `eventSubMessage:${scope.id}`, reporter);
    this.checkErrorCodes(eventSubStarts, `the event sub-processes of ${scope.id}`, reporter);
    if (scope.is('bpmn:Process')) {
      const starts = nodes.filter((node) => node.is('bpmn:StartEvent'));
      this.checkUniqueNames(starts, 'message', `in process ${scope.id}`, 'startMessage', reporter);
      this.checkUniqueNames(starts, 'signal', `in process ${scope.id}`, 'startSignal', reporter);
    }
  }

  private checkErrorCodes(events: BpmnElement[], where: string, reporter: RuleReporter): void {
    const seen = new Map<string, BpmnElement>();
    for (const el of events) {
      const def = C8SubscriptionRules.soleDefinition(el, 'bpmn:ErrorEventDefinition');
      if (!def) {
        continue;
      }
      const code = def.peek<BpmnElement>('errorRef')?.peek<string>('errorCode');
      const key = this.blank(code) ? '' : code!;
      const first = seen.get(key);
      if (first) {
        reporter.deploy({ code: 'W_C8_DEPLOY_ERROR', element: el, subject: `errorCode:${key}`, message: key ? `${this.describe(el)} catches the error code "${key}" like ${this.describe(first)} (${where}); Camunda 8 refuses one code twice in a scope` : `${this.describe(el)} and ${this.describe(first)} both catch every error (no error code) (${where}); Camunda 8 allows one catch-all per scope`, hint: `Catch another error: \`bpmn set <file> ${el.id} error=<OtherError> errorCode=<OTHER_CODE>\` (the events share no bpmn:Error then), or remove one of them.`, related: [first.id] });
      } else {
        seen.set(key, el);
      }
    }
  }

  private checkLinks(proc: BpmnElement, reporter: RuleReporter): void {
    const links = new LinkEvents(this.document, this.allFlowNodes(proc, (node) => node.is('bpmn:SubProcess')), (node) => C8SubscriptionRules.soleDefinition(node, 'bpmn:LinkEventDefinition')?.peek<string>('name'));
    for (const { el, name, scope } of links.unmatchedThrows()) {
      reporter.deploy({ code: 'W_C8_DEPLOY_LINK', element: el, subject: `link:${name}`, message: `Link throw event ${el.id} goes to "${name}", but ${scope?.id} has no link catch event of that name; Camunda 8 refuses the file`, hint: `\`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${scope?.id} link=${ShellWords.quote(name)}\`, then continue from it (or rename the link: \`bpmn set <file> ${el.id} link=<Name>\`).` });
    }
    for (const { first, el, name } of links.duplicateCatches()) {
      reporter.deploy({ code: 'W_C8_DEPLOY_LINK', element: el, subject: `linkCatch:${name}`, message: `Link catch events ${first.id} and ${el.id} share the name "${name}" in process ${proc.id}; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} link=<OtherName>\` (and its throw events).`, related: [first.id] });
    }
  }

  private namedReferences(): Set<BpmnElement> {
    const used = new Set<BpmnElement>();
    for (const el of this.document.tree.walk(this.document.tree.definitions, { bpmnOnly: true })) {
      if (!el.is('bpmn:FlowNode')) {
        continue;
      }
      const signals = el.list('eventDefinitions').map((def) => (def.is('bpmn:SignalEventDefinition') ? def.peek<BpmnElement>('signalRef') : undefined));
      for (const ref of [this.messageOf(el), ...signals]) {
        if (ref) {
          used.add(ref);
        }
      }
    }
    return used;
  }

  private checkFeelNames(reporter: RuleReporter): void {
    for (const ref of this.namedReferences()) {
      const id = ref.id;
      if (!id) {
        continue;
      }
      const what = ref.is('bpmn:Signal') ? 'signal' : 'message';
      this.checkFeel(ref, undefined, 'name', `The name of ${what} ${id}`, this.nameAttr(ref), `\`bpmn set <file> ${id} ${ShellWords.quote('name==<FEEL expression>')}\` (check the FEEL syntax), or a static name.`, reporter);
    }
  }
}
