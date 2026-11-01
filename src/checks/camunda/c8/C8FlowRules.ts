import { type BpmnElement, MirrorLists, type Trigger, Triggers } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C8FlowRules extends C8Rules {
  private readonly unlisted = new Map<BpmnElement, BpmnElement>();

  constructor(context: RuleContext) {
    super(context);
    if (this.document.source) {
      for (const entry of new MirrorLists(this.document.tree.definitions).unkept(this.document.source.mirror)) {
        if (entry.direction === 'outgoing') {
          this.unlisted.set(entry.flow, entry.node);
        }
      }
    }
  }

  check(element: BpmnElement, reporter: RuleReporter): void {
    if (element.is('bpmn:ComplexGateway')) {
      C8FlowRules.checkComplexGateway(element, reporter);
    }
    if (element.is('bpmn:AdHocSubProcess')) {
      this.checkAdHoc(element, reporter);
    }
    if (element.is('bpmn:ExclusiveGateway') || element.is('bpmn:InclusiveGateway')) {
      this.checkBranchingGateway(element, reporter);
    }
    if (element.is('bpmn:EventBasedGateway')) {
      this.checkEventGateway(element, reporter);
    }
    if (element.is('bpmn:SequenceFlow')) {
      this.checkFlow(element, reporter);
    }
  }

  checkTransaction(el: BpmnElement, reporter: RuleReporter): void {
    reporter.deploy({ code: 'W_C8_DEPLOY_UNSUPPORTED', element: el, subject: 'transaction', message: `${this.describe(el)} is a transaction; Camunda 8 does not support transactions and refuses the file`, hint: `\`bpmn retype <file> ${el.id} subProcess\` (an embedded sub-process).`, fix: { op: 'retype', id: el.id, kind: 'subProcess' } });
  }

  private static checkComplexGateway(el: BpmnElement, reporter: RuleReporter): void {
    reporter.deploy({ code: 'W_C8_DEPLOY_UNSUPPORTED', element: el, subject: 'complexGateway', message: `Complex gateway ${el.id}: Camunda 8 does not support complex gateways and refuses the file`, hint: `\`bpmn retype <file> ${el.id} inclusiveGateway\` (or exclusiveGateway: one path).`, fix: { op: 'retype', id: el.id, kind: 'inclusiveGateway' } });
  }

  checkAdHoc(el: BpmnElement, reporter: RuleReporter): void {
    const nodes = this.document.scopes.flowNodes(el);
    for (const node of nodes) {
      if (node.is('bpmn:StartEvent') || node.is('bpmn:EndEvent')) {
        reporter.deploy({ code: 'W_C8_DEPLOY_AD_HOC_SUBPROCESS', element: el, subject: `adHoc:${node.id}`, message: `Ad-hoc sub-process ${el.id} contains the ${node.is('bpmn:StartEvent') ? 'start' : 'end'} event ${node.id}; Camunda 8 refuses start and end events in ad-hoc sub-processes`, hint: `\`bpmn remove <file> ${node.id}\`.`, related: [node.id], fix: { op: 'remove', ids: [node.id] } });
      }
    }
    if (!nodes.some((node) => node.is('bpmn:Activity'))) {
      reporter.deploy({ code: 'W_C8_DEPLOY_AD_HOC_SUBPROCESS', element: el, subject: 'adHoc:empty', message: `Ad-hoc sub-process ${el.id} contains no activity; Camunda 8 refuses the file`, hint: `\`bpmn add <file> serviceTask "<Name>" --in ${el.id}\`.` });
    }
    const cc = el.peek<BpmnElement>('completionCondition');
    if (cc) {
      const body = cc.peek<string>('body') ?? '';
      const fix = `\`bpmn set <file> ${el.id} ${ShellWords.quote(`completion==${this.feelOf(this.isFeel(body) ? body.trim().slice(1) : body)}`)}\` (check the FEEL syntax)`;
      if (!this.isFeel(body)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_EXPRESSION', element: el, subject: 'adHoc:completion', message: `The completion condition "${body.trim()}" of ad-hoc sub-process ${el.id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, hint: `${fix}, or remove it: \`bpmn set <file> ${el.id} completion=\`.` });
      } else {
        this.checkFeel(el, undefined, 'adHoc:completion', `The completion condition of ad-hoc sub-process ${el.id}`, body, `${fix}.`, reporter);
      }
    }
  }

  private checkFlow(flow: BpmnElement, reporter: RuleReporter): void {
    const cond = flow.peek<BpmnElement>('conditionExpression');
    if (!cond) {
      return;
    }
    const body = cond.peek<string>('body') ?? '';
    const source = flow.peek<BpmnElement>('sourceRef');
    this.checkFeel(flow, undefined, 'condition', `The condition of sequence flow ${flow.id}`, body, `\`bpmn set <file> ${flow.id} ${ShellWords.quote(`condition==${this.feelOf(body.trim().slice(1))}`)}\` (check the FEEL syntax: and / or, = for equality, not(...)).`, reporter);
    if (!this.isFeel(body)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EXPRESSION', element: flow, subject: 'condition', message: `The condition "${body.trim()}" of sequence flow ${flow.id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, hint: body.trim() ? `\`bpmn set <file> ${flow.id} ${ShellWords.quote(`condition==${this.feelOf(body)}`)}\` (check the FEEL syntax: and / or, = for equality).` : `Give it one (\`bpmn set <file> ${flow.id} ${ShellWords.quote('condition== <expression>')}\`) or remove it (\`bpmn set <file> ${flow.id} condition=\`).` });
    }
    if (source && !source.is('bpmn:Gateway')) {
      reporter.runtime({ code: 'W_C8_CONDITION_IGNORED', element: flow, subject: 'conditionIgnored', message: `Sequence flow ${flow.id} out of ${this.describe(source)} has a condition; Camunda 8 evaluates conditions at exclusive and inclusive gateways only and always takes this flow`, hint: `Remove it (\`bpmn set <file> ${flow.id} condition=\`), or branch with a gateway: \`bpmn add <file> exclusiveGateway "<Question?>" --after ${source.id}\`, then move the condition onto its flows.` });
    }
  }

  private checkBranchingGateway(gw: BpmnElement, reporter: RuleReporter): void {
    const flows = this.outgoing.get(gw) ?? [];
    if (flows.length < 2) {
      return;
    }
    const def = gw.peek<BpmnElement>('default');
    for (const flow of flows) {
      if (flow === def || flow.peek<BpmnElement>('conditionExpression')) {
        continue;
      }
      reporter.runtime({ code: 'W_C8_EXCLUSIVE_GATEWAY', element: gw, subject: `noCondition:${flow.id}`, message: `Sequence flow ${flow.id} out of ${this.describe(gw)} has no condition and is not the default flow: Camunda 8 never takes it (an instance where no condition holds gets an incident)`, hint: `Make it the default flow (\`bpmn set <file> ${flow.id} default=true\`) or give it a condition: \`bpmn set <file> ${flow.id} ${ShellWords.quote('condition== <expression>')}\`.`, related: [flow.id] });
    }
  }

  private checkEventGateway(gw: BpmnElement, reporter: RuleReporter): void {
    const flows = this.outgoing.get(gw) ?? [];
    const listed = flows.filter((flow) => !this.unlisted.has(flow) || this.unlisted.get(flow) !== gw);
    if (flows.length < 2) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_GATEWAY', element: gw, subject: 'branches', message: `Event-based gateway ${gw.id} has ${flows.length} outgoing flow${flows.length === 1 ? '' : 's'}; Camunda 8 needs at least two and refuses the file`, hint: `Add a branch: \`bpmn add <file> intermediateCatchEvent:timer "<Timeout>" --after ${gw.id} timer=PT1H\`.` });
    } else if (listed.length < 2) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_GATEWAY', element: gw, subject: 'branches', message: `Event-based gateway ${gw.id} has ${flows.length} outgoing flows, but the file lists ${listed.length} of them as its <bpmn:outgoing> entries; Camunda 8 counts the listed ones and refuses the file`, hint: `Add the missing <bpmn:outgoing>${flows.filter((flow) => !listed.includes(flow)).map(({ id: flowId }) => flowId).join('</bpmn:outgoing>, <bpmn:outgoing>')}</bpmn:outgoing> entries to ${gw.id} in the XML (Camunda Modeler writes them; this file leaves the lists out, and \`bpmn\` keeps a file's style).` });
    }
    for (const flow of flows) {
      const target = flow.peek<BpmnElement>('targetRef');
      if (!target) {
        continue;
      }
      const defs = target.list('eventDefinitions');
      const ok = target.is('bpmn:IntermediateCatchEvent') && defs.length === 1 && Triggers.EVENT_GATEWAY_TRIGGERS.includes(this.triggerName(defs[0]!) as Trigger);
      if (!ok) {
        reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_GATEWAY', element: gw, subject: `target:${target.id}`, message: `Event-based gateway ${gw.id} leads to ${this.describe(target)}; Camunda 8 allows only message, timer, signal and conditional intermediate catch events after it and refuses the file`, hint: target.is('bpmn:ReceiveTask') ? `Use a message catch event: \`bpmn retype <file> ${target.id} intermediateCatchEvent:message message=${ShellWords.quote(this.nameOf(this.messageOf(target)) ?? '<MessageName>')}\`.` : `Put a catch event in between: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${flow.id} message=<MessageName>\` (or retype ${target.id}).`, related: [target.id, flow.id] });
      }
    }
  }
}
