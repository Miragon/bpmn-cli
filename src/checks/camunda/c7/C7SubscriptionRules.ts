import { type BpmnElement, Kinds } from '../../../model/index.js';
import { C7Rules } from './C7Rules.js';
import { LinkEvents } from '../values/LinkEvents.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C7SubscriptionRules extends C7Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    if (element.is('bpmn:Definitions') && this.document.tree.processes().some((process) => process.peek<boolean>('isExecutable') === true)) {
      this.checkSignalNames(reporter);
    }
    if (reporter.executable && element.is('bpmn:Process')) {
      this.checkSubscriptions(element, reporter);
      this.checkLinks(element, reporter);
    }
  }

  private processNodes(proc: BpmnElement): BpmnElement[] {
    return this.allFlowNodes(proc, (node) => node.is('bpmn:SubProcess') && !node.is('bpmn:AdHocSubProcess'));
  }

  private checkSubscriptions(proc: BpmnElement, reporter: RuleReporter): void {
    const groups = new Map<string, BpmnElement[]>();
    for (const node of this.processNodes(proc)) {
      this.collectSubscriptions(node, groups);
    }
    for (const [key, els] of groups) {
      if (els.length >= 2) {
        this.reportDuplicateSubscriptions(key, els, reporter);
      }
    }
  }

  private collectSubscriptions(node: BpmnElement, groups: Map<string, BpmnElement[]>): void {
    const add = (kind: 'message' | 'signal', scope: string, name: string | undefined): void => {
      const key = `${kind}\u0000${scope}\u0000${name}`;
      if (name) {
        groups.set(key, [...(groups.get(key) ?? []), node]);
      }
    };
    if (node.is('bpmn:ReceiveTask')) {
      add('message', `scope:${node.id}`, this.nameOf(node.peek<BpmnElement>('messageRef')));
    }
    const scope = this.subscriptionScope(node);
    if (scope) {
      add('message', scope, this.nameOf(this.definitionOf(node, 'bpmn:MessageEventDefinition')?.peek<BpmnElement>('messageRef')));
      add('signal', scope, this.nameOf(this.definitionOf(node, 'bpmn:SignalEventDefinition')?.peek<BpmnElement>('signalRef')));
    }
  }

  private subscriptionScope(node: BpmnElement): string | undefined {
    if (node.is('bpmn:StartEvent')) {
      const parent = this.document.scopes.scopeOf(node);
      if (parent && parent.is('bpmn:Process')) {
        return `start:${parent.id}`;
      }
      return parent && Kinds.isEventSubProcess(parent) ? `scope:${this.document.scopes.scopeOf(parent)?.id}` : undefined;
    }
    const host = node.is('bpmn:BoundaryEvent') ? node.peek<BpmnElement>('attachedToRef') : undefined;
    return host ? `${this.isMultiInstance(host) ? 'body' : 'scope'}:${host.id}` : undefined;
  }

  private reportDuplicateSubscriptions(key: string, els: BpmnElement[], reporter: RuleReporter): void {
    const [kind, , name] = key.split('\u0000') as ['message' | 'signal', string, string];
    const [first, ...rest] = els;
    for (const el of rest) {
      const code = kind === 'message' ? 'W_C7_DEPLOY_MESSAGE' : 'W_C7_DEPLOY_SIGNAL';
      reporter.deploy({ code: code, element: el, subject: kind === 'message' ? `dupMessage:${name}` : `dupSignalEvent:${name}`, message: `${this.describe(el, undefined)} waits for ${kind} "${name}" like ${first?.id} in the same scope; the engines refuse two ${kind} subscriptions with one name`, hint: `Use another ${kind}: \`bpmn set <file> ${el.id} ${kind}=<OtherName>\`.`, related: [first!.id] });
    }
  }

  private checkLinks(proc: BpmnElement, reporter: RuleReporter): void {
    const links = new LinkEvents(this.document, this.processNodes(proc), (node) => {
      const name = this.definitionOf(node, 'bpmn:LinkEventDefinition')?.peek<string>('name');
      return name === null ? undefined : name;
    });
    for (const { first, el, name } of links.duplicateCatches()) {
      reporter.deploy({ code: 'W_C7_DEPLOY_LINK', element: el, subject: `link:dup:${name}`, message: `Link catch events ${first.id} and ${el.id} are both named "${name}"; the engines refuse two link catch events with one name in a process (sub-processes included)`, hint: `\`bpmn set <file> ${el.id} link=<OtherName>\` (and its throw events too).`, related: [first!.id] });
    }
    for (const { el, name, scope } of links.unmatchedThrows()) {
      if (!(this.incoming.get(el) ?? []).length) {
        continue;
      }
      const sid = scope?.id ?? '<scopeId>';
      const elsewhere = links.catchNamed(name);
      reporter.deploy({ code: 'W_C7_DEPLOY_LINK', element: el, subject: `link:target:${name}`, message: `Link throw event ${el.id} jumps to "${name}", but ${elsewhere ? `the catch event of that name (${elsewhere.id}) is in another scope` : 'no link catch event has that name'}; the engines resolve links within one (sub-)process (${sid}) and refuse the file`, hint: `Add the catching side in ${sid}: \`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${sid} --link ${ShellWords.quote(name)}\` and continue from it, or point the throw at an existing catch: \`bpmn set <file> ${el.id} link=<Name>\`.`, related: elsewhere ? [elsewhere.id] : [] });
    }
  }

  private checkSignalNames(reporter: RuleReporter): void {
    const seen = new Map<string, BpmnElement>();
    for (const sig of this.document.tree.rootElementsOfType('bpmn:Signal')) {
      const name = this.nameOf(sig);
      if (!name) {
        continue;
      }
      const first = seen.get(name);
      if (first) {
        reporter.deploy({ code: 'W_C7_DEPLOY_SIGNAL', element: sig, subject: `dupSignal:${name}`, message: `Signals ${first.id} and ${sig.id} are both named "${name}"; the engines refuse duplicate signal names`, hint: `\`bpmn set <file> ${sig.id} name=<OtherName>\` (or point its events at ${first.id} and remove it).`, related: [first!.id] });
      } else {
        seen.set(name, sig);
      }
    }
  }
}
