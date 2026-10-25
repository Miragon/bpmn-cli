import type { El } from '../../../model/utils/moddle.js';
import type { RuleRun } from '../RuleRun.js';
import { EVENT_GATEWAY_TRIGGERS, idOf, nameOf, peek } from '../utils/element.js';
import { sh } from '../utils/hint.js';
import type { C7ImplementationRules } from './C7ImplementationRules.js';
import { C7Rules } from './C7Rules.js';

/** Sequence flows, gateways, and the elements the engines refuse once something connects them. */
export class C7FlowRules extends C7Rules {
  /** `operaton`: the file targets Operaton, which deploys a valid loop on an ad-hoc sub-process */
  constructor(
    run: RuleRun,
    p: string,
    private readonly operaton: boolean,
    private readonly implementation: C7ImplementationRules,
  ) {
    super(run, p);
  }

  /**
   * An empty condition on a sequence flow the engines evaluate (not a default flow, not out of a
   * parallel / event-based gateway).
   */
  checkFlowCondition(flow: El): void {
    const cond = peek<El>(flow, 'conditionExpression');
    if (!cond || !this.emptyCondition(cond)) return;
    const source = peek<El>(flow, 'sourceRef');
    if (source && (this.kit.is(source, 'bpmn:ParallelGateway') || this.kit.is(source, 'bpmn:EventBasedGateway') || peek<El>(source, 'default') === flow)) return;
    const id = idOf(flow)!;
    this.push('runtime', 'W_C7_EMPTY_CONDITION', flow, undefined, 'emptyCondition', `Sequence flow ${id} has an empty condition (no expression and no ${this.p}:resource): it deploys, but the engines fail when they evaluate it`, `Give it one: \`bpmn set <file> ${id} ${sh('condition=${expression}')}\`, or remove it: \`bpmn set <file> ${id} condition=\`.`);
  }

  checkEventGateway(gw: El): void {
    const id = idOf(gw)!;
    const names = new Map<string, El>();
    for (const flow of this.outgoing.get(gw) ?? []) {
      const t = peek<El>(flow, 'targetRef');
      if (!t) continue;
      const tid = idOf(t)!;
      const fid = idOf(flow)!;
      const leadsTo = `Event-based gateway ${id} leads to ${this.describe(t, undefined)}`;
      if (!this.kit.is(t, 'bpmn:IntermediateCatchEvent')) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `target:${tid}`, `${leadsTo}; the engines accept only intermediate catch events (message, timer, signal, conditional) there and refuse the file`, `Put a catch event in front of it: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${fid} --message <MessageName>\` (or :timer --timer PT1H).`, [tid, fid]);
        continue;
      }
      // of several definitions the engines act on one (a link is refused only when it wins)
      const defs = this.actedOn(t);
      const kind = defs.length === 1 ? (EVENT_GATEWAY_TRIGGERS.find((k) => this.kit.is(defs[0], `bpmn:${k}EventDefinition`)) ?? '') : '';
      if (!kind) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `target:${tid}`, `${leadsTo}; after an event-based gateway the engines accept only message, timer, signal and conditional catch events and refuse the file`, `\`bpmn set <file> ${tid} trigger=message message=<MessageName>\` (or trigger=timer timer=PT1H).`, [tid, fid]);
        continue;
      }
      if ((this.incoming.get(t) ?? []).length > 1) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `incoming:${tid}`, `${this.describe(t, undefined)} after event-based gateway ${id} has other incoming flows; the engines refuse the file`, `Join before the gateway instead, and keep only ${fid} into ${tid} (\`bpmn set <file> <otherFlowId> target=<nodeId>\`).`, [tid, fid]);
      }
      const ref = kind === 'Message' ? peek<El>(defs[0], 'messageRef') : kind === 'Signal' ? peek<El>(defs[0], 'signalRef') : undefined;
      const name = nameOf(ref);
      if (!name) continue;
      const key = `${kind}\u0000${name}`;
      const first = names.get(key);
      if (first) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `dup:${kind}:${name}`, `Branches ${idOf(first)} and ${tid} of event-based gateway ${id} wait for the same ${kind.toLowerCase()} "${name}"; the engines refuse the file`, `\`bpmn set <file> ${tid} ${kind.toLowerCase()}=<OtherName>\`, or remove one branch.`, [idOf(first)!, tid]);
      } else names.set(key, t);
    }
  }

  checkExclusiveGateway(gw: El): void {
    const id = idOf(gw)!;
    const outgoing = this.outgoing.get(gw) ?? [];
    const def = peek<El>(gw, 'default');
    const hasCond = (f: El): boolean => !!peek<El>(f, 'conditionExpression');
    const conditionedDefault = (f: El): void => {
      this.push('deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `default:${idOf(f)}`, `Default flow ${idOf(f)} of exclusive gateway ${id} has a condition; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} condition=\`.`, [idOf(f)!]);
    };
    if (!outgoing.length) {
      this.push('deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, 'none', `Exclusive gateway ${id} has no outgoing flow; the engines refuse the file`, `Continue it: \`bpmn add <file> <kind> "<Name>" --after ${id}\`.`);
      return;
    }
    if (outgoing.length === 1) {
      const f = outgoing[0]!;
      if (hasCond(f) && f !== def) this.push('deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `single:${idOf(f)}`, `Exclusive gateway ${id} has a single outgoing flow ${idOf(f)} with a condition; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} condition=\`.`, [idOf(f)!]);
      if (hasCond(f) && f === def) conditionedDefault(f);
      return;
    }
    const unconditioned: El[] = [];
    for (const f of outgoing) {
      if (f === def) {
        if (hasCond(f)) conditionedDefault(f);
        continue;
      }
      if (!hasCond(f)) unconditioned.push(f);
    }
    if (def || unconditioned.length > 1) {
      for (const f of unconditioned) {
        this.push('deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `uncond:${idOf(f)}`, `Flow ${idOf(f)} of exclusive gateway ${id} has no condition and is not the default flow${def ? '' : ` (${unconditioned.length} such flows)`}; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} ${sh('condition=${...}')}\`${def ? '' : ` or make one of them the default: \`bpmn set <file> ${idOf(f)} default=true\``}.`, [idOf(f)!]);
      }
    } else if (unconditioned.length === 1) {
      const f = unconditioned[0]!;
      this.push('practice', 'W_C7_EXCLUSIVE_GATEWAY_DEFAULT', gw, undefined, `implicit:${idOf(f)}`, `Flow ${idOf(f)} of exclusive gateway ${id} has no condition and is not the default flow; the engines take it as the default and log a warning`, `\`bpmn set <file> ${idOf(f)} default=true\`.`, [idOf(f)!]);
    }
  }

  /** The engines ignore complex gateways; one that nothing connects deploys. */
  checkComplexGateway(el: El): void {
    const id = idOf(el)!;
    const incoming = this.incoming.get(el) ?? [];
    const flows = [...incoming, ...(this.outgoing.get(el) ?? [])];
    if (!flows.length) return;
    this.push('deploy', 'W_C7_DEPLOY_COMPLEX_GATEWAY', el, undefined, 'complexGateway', `Complex gateway ${id} is connected; the engines do not run complex gateways and refuse the file (invalid ${incoming.length ? 'destination' : 'source'} '${id}' of sequence flow ${idOf(flows[0])})`, `\`bpmn retype <file> ${id} inclusiveGateway\` (or exclusiveGateway: one path).`, flows.map(idOf).filter((x): x is string => !!x));
  }

  /**
   * The engines skip an ad-hoc sub-process with its content and refuse one with a sequence flow or
   * a boundary event. Its multi-instance loop is parsed first: the loop rules hold, and Camunda 7
   * and CIB seven refuse any loop on it (Operaton deploys a valid one).
   */
  checkAdHoc(el: El): void {
    const id = idOf(el)!;
    const flows = [...(this.incoming.get(el) ?? []), ...(this.outgoing.get(el) ?? [])];
    const scope = this.doc.scopeOf(el);
    const boundaries = scope ? this.doc.flowNodes(scope).filter((n) => this.kit.is(n, 'bpmn:BoundaryEvent') && peek<El>(n, 'attachedToRef') === el) : [];
    const loop = this.isMultiInstance(el);
    this.implementation.checkMultiInstance(el);
    if (!flows.length && !boundaries.length && (!loop || this.operaton)) return;
    const parts = [flows.length ? `sequence flow${flows.length > 1 ? 's' : ''} ${flows.map(idOf).join(', ')}` : '', boundaries.length ? `boundary event${boundaries.length > 1 ? 's' : ''} ${boundaries.map(idOf).join(', ')}` : ''].filter(Boolean);
    const connected = parts.length > 0;
    const message = connected
      ? `Ad-hoc sub-process ${id} is connected (${parts.join(' and ')}); the engines do not run ad-hoc sub-processes and refuse the file (${flows.length ? `invalid ${(this.incoming.get(el) ?? []).length ? 'destination' : 'source'} '${id}' of sequence flow ${idOf(flows[0])}` : 'invalid reference in boundary event'})`
      : `Ad-hoc sub-process ${id} has a multi-instance loop; the engines do not run ad-hoc sub-processes, and Camunda 7 and CIB seven refuse the file (ENGINE-01009, "activity" is null)`;
    const retype = `Make it an embedded sub-process: \`bpmn retype <file> ${id} subProcess\`, then give its content a start event and flows (\`bpmn add <file> startEvent "<Name>" --in ${id}\`, \`bpmn connect <file> <fromId> <toId>\`)`;
    this.push('deploy', 'W_C7_DEPLOY_AD_HOC_SUBPROCESS', el, undefined, 'adHoc', message, connected ? `${retype}.` : `${retype}, or drop the loop: \`bpmn set <file> ${id} loop=none\`.`, [...flows, ...boundaries].map(idOf).filter((x): x is string => !!x));
  }
}
