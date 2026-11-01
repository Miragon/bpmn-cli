import { type BpmnElement, Kinds, Triggers } from '../../../model/index.js';
import type { C7BindingRules } from './C7BindingRules.js';
import { C7Rules } from './C7Rules.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C7FlowRules extends C7Rules {
  constructor(
    context: RuleContext,
    private readonly bindings: C7BindingRules,
  ) {
    super(context);
  }

  check(element: BpmnElement, reporter: RuleReporter): void {
    if (!reporter.executable) {
      return;
    }
    if (element.is('bpmn:EventBasedGateway')) {
      this.checkEventGateway(element, reporter);
    }
    if (element.is('bpmn:ComplexGateway')) {
      this.checkComplexGateway(element, reporter);
    }
    if (element.is('bpmn:ExclusiveGateway')) {
      this.checkExclusiveGateway(element, reporter);
    }
    if (element.is('bpmn:SequenceFlow')) {
      this.checkFlowCondition(element, reporter);
    }
  }

  checkFlowCondition(flow: BpmnElement, reporter: RuleReporter): void {
    const cond = flow.peek<BpmnElement>('conditionExpression');
    if (!cond || !this.emptyCondition(cond)) {
      return;
    }
    const source = flow.peek<BpmnElement>('sourceRef');
    if (source && (Kinds.ignoresConditions(source) || source.peek<BpmnElement>('default') === flow)) {
      return;
    }
    const id = flow.id;
    reporter.runtime({ code: 'W_C7_EMPTY_CONDITION', element: flow, subject: 'emptyCondition', message: `Sequence flow ${id} has an empty condition (no expression and no ${this.prefix}:resource): it deploys, but the engines fail when they evaluate it`, hint: `Give it one: \`bpmn set <file> ${id} ${ShellWords.quote('condition=${expression}')}\`, or remove it: \`bpmn set <file> ${id} condition=\`.` });
  }

  checkEventGateway(gw: BpmnElement, reporter: RuleReporter): void {
    const id = gw.id;
    const names = new Map<string, BpmnElement>();
    for (const flow of this.outgoing.get(gw) ?? []) {
      const target = flow.peek<BpmnElement>('targetRef');
      if (!target) {
        continue;
      }
      const tid = target.id;
      const fid = flow.id;
      const leadsTo = `Event-based gateway ${id} leads to ${this.describe(target, undefined)}`;
      if (!target.is('bpmn:IntermediateCatchEvent')) {
        reporter.deploy({ code: 'W_C7_DEPLOY_EVENT_GATEWAY', element: gw, subject: `target:${tid}`, message: `${leadsTo}; the engines accept only intermediate catch events (message, timer, signal, conditional) there and refuse the file`, hint: `Put a catch event in front of it: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${fid} --message <MessageName>\` (or :timer --timer PT1H).`, related: [tid, fid] });
        continue;
      }
      const defs = this.actedOn(target);
      const trigger = defs.length === 1 ? this.triggerName(defs[0]!) : '';
      const kind = Triggers.EVENT_GATEWAY_TRIGGERS.find((knownTrigger) => knownTrigger === trigger) ?? '';
      if (!kind) {
        reporter.deploy({ code: 'W_C7_DEPLOY_EVENT_GATEWAY', element: gw, subject: `target:${tid}`, message: `${leadsTo}; after an event-based gateway the engines accept only message, timer, signal and conditional catch events and refuse the file`, hint: `\`bpmn set <file> ${tid} trigger=message message=<MessageName>\` (or trigger=timer timer=PT1H).`, related: [tid, fid] });
        continue;
      }
      const ref = kind === 'message' ? defs[0]?.peek<BpmnElement>('messageRef') : kind === 'signal' ? defs[0]?.peek<BpmnElement>('signalRef') : undefined;
      const name = this.nameOf(ref);
      if (!name) {
        continue;
      }
      const key = `${kind}\u0000${name}`;
      const first = names.get(key);
      if (first) {
        reporter.deploy({ code: 'W_C7_DEPLOY_EVENT_GATEWAY', element: gw, subject: `dup:${kind}:${name}`, message: `Branches ${first.id} and ${tid} of event-based gateway ${id} wait for the same ${kind} "${name}"; the engines refuse the file`, hint: `\`bpmn set <file> ${tid} ${kind}=<OtherName>\`, or remove one branch.`, related: [first.id, tid] });
      } else {
        names.set(key, target);
      }
    }
  }

  checkExclusiveGateway(gw: BpmnElement, reporter: RuleReporter): void {
    const id = gw.id;
    const outgoing = this.outgoing.get(gw) ?? [];
    const def = gw.peek<BpmnElement>('default');
    const hasCond = (flow: BpmnElement): boolean => !!flow.peek<BpmnElement>('conditionExpression');
    const conditionedDefault = (flow: BpmnElement): void => {
      reporter.deploy({ code: 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', element: gw, subject: `default:${flow.id}`, message: `Default flow ${flow.id} of exclusive gateway ${id} has a condition; the engines refuse the file`, hint: `\`bpmn set <file> ${flow.id} condition=\`.`, related: [flow.id] });
    };
    if (!outgoing.length) {
      reporter.deploy({ code: 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', element: gw, subject: 'none', message: `Exclusive gateway ${id} has no outgoing flow; the engines refuse the file`, hint: `Continue it: \`bpmn add <file> <kind> "<Name>" --after ${id}\`.` });
      return;
    }
    if (outgoing.length === 1) {
      const flow = outgoing[0]!;
      if (hasCond(flow) && flow !== def) {
        reporter.deploy({ code: 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', element: gw, subject: `single:${flow.id}`, message: `Exclusive gateway ${id} has a single outgoing flow ${flow.id} with a condition; the engines refuse the file`, hint: `\`bpmn set <file> ${flow.id} condition=\`.`, related: [flow.id] });
      }
      if (hasCond(flow) && flow === def) {
        conditionedDefault(flow);
      }
      return;
    }
    const unconditioned: BpmnElement[] = [];
    for (const flow of outgoing) {
      if (flow === def) {
        if (hasCond(flow)) {
          conditionedDefault(flow);
        }
        continue;
      }
      if (!hasCond(flow)) {
        unconditioned.push(flow);
      }
    }
    if (def || unconditioned.length > 1) {
      for (const flow of unconditioned) {
        reporter.deploy({ code: 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', element: gw, subject: `uncond:${flow.id}`, message: `Flow ${flow.id} of exclusive gateway ${id} has no condition and is not the default flow${def ? '' : ` (${unconditioned.length} such flows)`}; the engines refuse the file`, hint: `\`bpmn set <file> ${flow.id} ${ShellWords.quote('condition=${...}')}\`${def ? '' : ` or make one of them the default: \`bpmn set <file> ${flow.id} default=true\``}.`, related: [flow.id] });
      }
    } else if (unconditioned.length === 1) {
      const flow = unconditioned[0]!;
      reporter.practice({ code: 'W_C7_EXCLUSIVE_GATEWAY_DEFAULT', element: gw, subject: `implicit:${flow.id}`, message: `Flow ${flow.id} of exclusive gateway ${id} has no condition and is not the default flow; the engines take it as the default and log a warning`, hint: `\`bpmn set <file> ${flow.id} default=true\`.`, related: [flow.id] });
    }
  }

  checkComplexGateway(el: BpmnElement, reporter: RuleReporter): void {
    const id = el.id;
    const incoming = this.incoming.get(el) ?? [];
    const flows = [...incoming, ...(this.outgoing.get(el) ?? [])];
    if (!flows.length) {
      return;
    }
    reporter.deploy({ code: 'W_C7_DEPLOY_COMPLEX_GATEWAY', element: el, subject: 'complexGateway', message: `Complex gateway ${id} is connected; the engines do not run complex gateways and refuse the file (invalid ${incoming.length ? 'destination' : 'source'} '${id}' of sequence flow ${flows[0]?.id})`, hint: `\`bpmn retype <file> ${id} inclusiveGateway\` (or exclusiveGateway: one path).`, related: flows.map(({ id }) => id) });
  }

  checkAdHoc(el: BpmnElement, reporter: RuleReporter): void {
    const id = el.id;
    const flows = [...(this.incoming.get(el) ?? []), ...(this.outgoing.get(el) ?? [])];
    const scope = this.document.scopes.scopeOf(el);
    const boundaries = scope ? this.document.scopes.flowNodes(scope).filter((node) => node.is('bpmn:BoundaryEvent') && node.peek<BpmnElement>('attachedToRef') === el) : [];
    const loop = this.isMultiInstance(el);
    this.bindings.checkMultiInstance(el, reporter);
    if (!flows.length && !boundaries.length && (!loop || this.operaton)) {
      return;
    }
    const parts = [flows.length ? `sequence flow${flows.length > 1 ? 's' : ''} ${flows.map(({ id }) => id).join(', ')}` : '', boundaries.length ? `boundary event${boundaries.length > 1 ? 's' : ''} ${boundaries.map(({ id }) => id).join(', ')}` : ''].filter(Boolean);
    const connected = parts.length > 0;
    const message = connected
      ? `Ad-hoc sub-process ${id} is connected (${parts.join(' and ')}); the engines do not run ad-hoc sub-processes and refuse the file (${flows.length ? `invalid ${(this.incoming.get(el) ?? []).length ? 'destination' : 'source'} '${id}' of sequence flow ${flows[0]?.id}` : 'invalid reference in boundary event'})`
      : `Ad-hoc sub-process ${id} has a multi-instance loop; the engines do not run ad-hoc sub-processes, and Camunda 7 and CIB seven refuse the file (ENGINE-01009, "activity" is null)`;
    const retype = `Make it an embedded sub-process: \`bpmn retype <file> ${id} subProcess\`, then give its content a start event and flows (\`bpmn add <file> startEvent "<Name>" --in ${id}\`, \`bpmn connect <file> <fromId> <toId>\`)`;
    reporter.deploy({ code: 'W_C7_DEPLOY_AD_HOC_SUBPROCESS', element: el, subject: 'adHoc', message, hint: connected ? `${retype}.` : `${retype}, or drop the loop: \`bpmn set <file> ${id} loop=none\`.`, related: [...flows, ...boundaries].map(({ id }) => id) });
  }
}
