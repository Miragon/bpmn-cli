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


  checkStartEvents(scope: BpmnElement, reporter: RuleReporter): void {
    const id = scope.id;
    const starts = this.document.scopes.flowNodes(scope).filter((node) => node.is('bpmn:StartEvent'));
    if (scope.is('bpmn:Process')) {
      if (!starts.length) {
        reporter.deploy({ code: 'W_C8_DEPLOY_START_EVENT', element: scope, subject: 'noStart', message: `Process ${id} has no start event; Camunda 8 refuses the file`, hint: `\`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${id}).` });
        return;
      }
      const none = starts.filter((start) => !start.list('eventDefinitions').length);
      for (const extra of none.slice(1)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_START_EVENT', element: extra, subject: 'noneStart', message: `Process ${id} has ${none.length} none start events (${none.map(({ id: startId }) => startId).join(', ')}); Camunda 8 allows one and refuses the file`, hint: `Remove ${extra.id} (\`bpmn remove <file> ${extra.id}\`) or give it a trigger: \`bpmn set <file> ${extra.id} trigger=message message=<MessageName>\`.`, related: [none[0]!.id] });
      }
      return;
    }
    if (scope.is('bpmn:AdHocSubProcess') || scope.is('bpmn:Transaction')) {
      return;
    }
    const event = Kinds.isEventSubProcess(scope);
    if (starts.length !== 1) {
      reporter.deploy({ code: 'W_C8_DEPLOY_START_EVENT', element: scope, subject: 'startCount', message: `${event ? 'Event sub-process' : 'Sub-process'} ${id} has ${starts.length ? `${starts.length} start events` : 'no start event'}; Camunda 8 needs exactly one and refuses the file`, hint: starts.length ? `Keep one: \`bpmn remove <file> ${starts[1]?.id}\`.` : event ? `\`bpmn add <file> startEvent:message "<Name>" --in ${id} --message <MessageName>\` (or timer, error, signal, escalation, conditional).` : `\`bpmn add <file> startEvent "<Name>" --in ${id}\`, then connect it to the first node.` });
    }
  }


  checkSubscriptionScopes(scope: BpmnElement, reporter: RuleReporter): void {
    const nodes = this.document.scopes.flowNodes(scope);
    const literal = (name: string | undefined): name is string => !!name && !this.isFeel(name);
    const defOf = (el: BpmnElement, type: string): BpmnElement | undefined => {
      const defs = el.list('eventDefinitions');
      return defs.length === 1 && defs[0]?.is(type) ? defs[0] : undefined;
    };
    const report = (els: BpmnElement[], kind: 'message' | 'signal', name: string, where: string, code: string, subjectPrefix: string): void => {
      const [first, ...rest] = els;
      for (const el of rest) {
        reporter.deploy({ code: code, element: el, subject: `${subjectPrefix}:${name}`, message: `${this.describe(el)} waits for the ${kind} "${name}" like ${this.describe(first!)} ${where}; Camunda 8 refuses one ${kind} name twice there`, hint: `Use another ${kind}: \`bpmn set <file> ${el.id} ${kind}=<Other${kind === 'message' ? 'Message' : 'Signal'}>\`${kind === 'message' ? ` (and a ${this.zeebeName('subscription')} on it)` : ''}.`, related: [first!.id] });
      }
    };
    const group = (els: BpmnElement[], kind: 'message' | 'signal', where: string, code: string, subjectPrefix: string): void => {
      const byName = new Map<string, BpmnElement[]>();
      for (const el of els) {
        const def = defOf(el, kind === 'message' ? 'bpmn:MessageEventDefinition' : 'bpmn:SignalEventDefinition');
        const name = kind === 'message' ? this.nameOf(el.is('bpmn:ReceiveTask') ? el.peek<BpmnElement>('messageRef') : def?.peek<BpmnElement>('messageRef')) : this.nameOf(def?.peek<BpmnElement>('signalRef'));
        if (!literal(name)) {
          continue;
        }
        byName.set(name, [...(byName.get(name) ?? []), el]);
      }
      for (const [name, list_] of byName) {
        if (list_.length > 1) {
          report(list_, kind, name, where, code, subjectPrefix);
        }
      }
    };
    for (const act of nodes.filter((node) => node.is('bpmn:Activity'))) {
      const boundaries = nodes.filter((node) => node.is('bpmn:BoundaryEvent') && node.peek<BpmnElement>('attachedToRef') === act);
      if (!boundaries.length) {
        continue;
      }
      group([...(act.is('bpmn:ReceiveTask') ? [act] : []), ...boundaries], 'message', `on ${act.id}`, 'W_C8_DEPLOY_MESSAGE', `boundaryMessage:${act.id}`);
      group(boundaries, 'signal', `on ${act.id}`, 'W_C8_DEPLOY_SIGNAL', `boundarySignal:${act.id}`);
      this.checkErrorCodes(boundaries, `the boundary events of ${act.id}`, reporter);
    }
    for (const gw of nodes.filter((node) => node.is('bpmn:EventBasedGateway'))) {
      const targets = (this.outgoing.get(gw) ?? []).map((flow) => flow.peek<BpmnElement>('targetRef')).filter((target): target is BpmnElement => !!target && target.is('bpmn:IntermediateCatchEvent'));
      group(targets, 'message', `after event-based gateway ${gw.id}`, 'W_C8_DEPLOY_MESSAGE', `gatewayMessage:${gw.id}`);
    }
    const eventSubStarts = nodes.filter((node) => Kinds.isEventSubProcess(node)).flatMap((sp) => this.document.scopes.flowNodes(sp).filter((node) => node.is('bpmn:StartEvent')));
    group(eventSubStarts, 'message', `in the event sub-processes of ${scope.id}`, 'W_C8_DEPLOY_MESSAGE', `eventSubMessage:${scope.id}`);
    this.checkErrorCodes(eventSubStarts, `the event sub-processes of ${scope.id}`, reporter);
    if (scope.is('bpmn:Process')) {
      const starts = nodes.filter((node) => node.is('bpmn:StartEvent'));
      group(starts, 'message', `in process ${scope.id}`, 'W_C8_DEPLOY_MESSAGE', 'startMessage');
      group(starts, 'signal', `in process ${scope.id}`, 'W_C8_DEPLOY_SIGNAL', 'startSignal');
    }
  }


  private checkErrorCodes(events: BpmnElement[], where: string, reporter: RuleReporter): void {
    const seen = new Map<string, BpmnElement>();
    for (const el of events) {
      const defs = el.list('eventDefinitions');
      if (defs.length !== 1 || !defs[0]?.is('bpmn:ErrorEventDefinition')) {
        continue;
      }
      const code = defs[0]?.peek<BpmnElement>('errorRef')?.peek<string>('errorCode');
      const key = this.blank(code) ? '' : code!;
      const first = seen.get(key);
      if (first) {
        reporter.deploy({ code: 'W_C8_DEPLOY_ERROR', element: el, subject: `errorCode:${key}`, message: key ? `${this.describe(el)} catches the error code "${key}" like ${this.describe(first)} (${where}); Camunda 8 refuses one code twice in a scope` : `${this.describe(el)} and ${this.describe(first)} both catch every error (no error code) (${where}); Camunda 8 allows one catch-all per scope`, hint: `Catch another error: \`bpmn set <file> ${el.id} error=<OtherError> errorCode=<OTHER_CODE>\` (the events share no bpmn:Error then), or remove one of them.`, related: [first.id] });
      } else {
        seen.set(key, el);
      }
    }
  }


  checkLinks(proc: BpmnElement, reporter: RuleReporter): void {
    const links = new LinkEvents(this.document, this.allFlowNodes(proc), (node) => {
      const defs = node.list('eventDefinitions');
      return defs.length === 1 && defs[0]?.is('bpmn:LinkEventDefinition') ? defs[0]?.peek<string>('name') : undefined;
    });
    for (const { el, name, scope } of links.unmatchedThrows()) {
      reporter.deploy({ code: 'W_C8_DEPLOY_LINK', element: el, subject: `link:${name}`, message: `Link throw event ${el.id} goes to "${name}", but ${scope?.id} has no link catch event of that name; Camunda 8 refuses the file`, hint: `\`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${scope?.id} --link ${ShellWords.quote(name)}\`, then continue from it (or rename the link: \`bpmn set <file> ${el.id} link=<Name>\`).` });
    }
    for (const { first, el, name } of links.duplicateCatches()) {
      reporter.deploy({ code: 'W_C8_DEPLOY_LINK', element: el, subject: `linkCatch:${name}`, message: `Link catch events ${first.id} and ${el.id} share the name "${name}" in process ${proc.id}; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} link=<OtherName>\` (and its throw events).`, related: [first.id] });
    }
  }


  private allFlowNodes(scope: BpmnElement): BpmnElement[] {
    return this.document.scopes.flowNodes(scope).flatMap((node) => (node.is('bpmn:SubProcess') ? [node, ...this.allFlowNodes(node)] : [node]));
  }


  checkFeelNames(reporter: RuleReporter): void {
    const used = new Set<BpmnElement>();
    for (const el of this.document.tree.walk(this.document.tree.definitions, { bpmnOnly: true })) {
      if (!el.is('bpmn:FlowNode')) {
        continue;
      }
      const msg = this.messageOf(el);
      if (msg) {
        used.add(msg);
      }
      for (const def of el.list('eventDefinitions')) {
        const sig = def.is('bpmn:SignalEventDefinition') ? def.peek<BpmnElement>('signalRef') : undefined;
        if (sig) {
          used.add(sig);
        }
      }
    }
    for (const ref of used) {
      const id = ref.id;
      if (!id) {
        continue;
      }
      const what = ref.is('bpmn:Signal') ? 'signal' : 'message';
      this.checkFeel(ref, undefined, 'name', `The name of ${what} ${id}`, this.nameAttr(ref), `\`bpmn set <file> ${id} ${ShellWords.quote('name==<FEEL expression>')}\` (check the FEEL syntax), or a static name.`, reporter);
    }
  }
}
