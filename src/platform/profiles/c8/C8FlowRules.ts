import type { El } from '../../../model/utils/moddle.js';
import type { RuleRun } from '../RuleRun.js';
import { EVENT_GATEWAY_TRIGGERS, idOf, list, nameOf, peek } from '../utils/element.js';
import { sh } from '../utils/hint.js';
import { feelOf, isFeel } from './utils/value.js';
import { C8Rules } from './C8Rules.js';

/** Sequence flows, gateways and sub-process kinds Camunda 8 runs differently or not at all. */
export class C8FlowRules extends C8Rules {
  /** flows whose source does not list them in the file's text: flow -> source */
  private readonly unlisted = new Map<El, El>();

  constructor(run: RuleRun, p: string) {
    super(run, p);
    const { doc } = run;
    if (doc.source) for (const e of run.kit.unkeptEntries(doc.definitions, doc.source.mirror)) if (e.direction === 'outgoing') this.unlisted.set(e.flow, e.node);
  }

  checkTransaction(el: El): void {
    this.push('deploy', 'W_C8_DEPLOY_UNSUPPORTED', el, undefined, 'transaction', `${this.describe(el)} is a transaction; Camunda 8 does not support transactions and refuses the file`, `\`bpmn retype <file> ${idOf(el)} subProcess\` (an embedded sub-process).`);
  }

  checkComplexGateway(el: El): void {
    this.push('deploy', 'W_C8_DEPLOY_UNSUPPORTED', el, undefined, 'complexGateway', `Complex gateway ${idOf(el)}: Camunda 8 does not support complex gateways and refuses the file`, `\`bpmn retype <file> ${idOf(el)} inclusiveGateway\` (or exclusiveGateway: one path).`);
  }

  checkAdHoc(el: El): void {
    const id = idOf(el)!;
    const nodes = this.doc.flowNodes(el);
    for (const n of nodes) {
      if (this.kit.is(n, 'bpmn:StartEvent') || this.kit.is(n, 'bpmn:EndEvent')) {
        this.push('deploy', 'W_C8_DEPLOY_AD_HOC_SUBPROCESS', el, undefined, `adHoc:${idOf(n)}`, `Ad-hoc sub-process ${id} contains the ${this.kit.is(n, 'bpmn:StartEvent') ? 'start' : 'end'} event ${idOf(n)}; Camunda 8 refuses start and end events in ad-hoc sub-processes`, `\`bpmn remove <file> ${idOf(n)}\`.`, [idOf(n)!]);
      }
    }
    if (!nodes.some((n) => this.kit.is(n, 'bpmn:Activity'))) {
      this.push('deploy', 'W_C8_DEPLOY_AD_HOC_SUBPROCESS', el, undefined, 'adHoc:empty', `Ad-hoc sub-process ${id} contains no activity; Camunda 8 refuses the file`, `\`bpmn add <file> serviceTask "<Name>" --in ${id}\`.`);
    }
    // a static completion condition is refused at deploy (unlike a multi-instance one)
    const cc = peek<El>(el, 'completionCondition');
    if (cc) {
      const body = peek<string>(cc, 'body') ?? '';
      const fix = `\`bpmn set <file> ${id} ${sh(`completion==${feelOf(isFeel(body) ? body.trim().slice(1) : body)}`)}\` (check the FEEL syntax)`;
      if (!isFeel(body)) this.push('deploy', 'W_C8_DEPLOY_EXPRESSION', el, undefined, 'adHoc:completion', `The completion condition "${body.trim()}" of ad-hoc sub-process ${id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, `${fix}, or remove it: \`bpmn set <file> ${id} completion=\`.`);
      else this.checkFeel(el, undefined, 'adHoc:completion', `The completion condition of ad-hoc sub-process ${id}`, body, `${fix}.`);
    }
  }

  checkFlow(flow: El): void {
    const cond = peek<El>(flow, 'conditionExpression');
    if (!cond) return;
    const id = idOf(flow)!;
    const body = peek<string>(cond, 'body') ?? '';
    const source = peek<El>(flow, 'sourceRef');
    this.checkFeel(flow, undefined, 'condition', `The condition of sequence flow ${id}`, body, `\`bpmn set <file> ${id} ${sh(`condition==${feelOf(body.trim().slice(1))}`)}\` (check the FEEL syntax: and / or, = for equality, not(...)).`);
    if (!isFeel(body)) {
      this.push('deploy', 'W_C8_DEPLOY_EXPRESSION', flow, undefined, 'condition', `The condition "${body.trim()}" of sequence flow ${id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, body.trim() ? `\`bpmn set <file> ${id} ${sh(`condition==${feelOf(body)}`)}\` (check the FEEL syntax: and / or, = for equality).` : `Give it one (\`bpmn set <file> ${id} ${sh('condition== <expression>')}\`) or remove it (\`bpmn set <file> ${id} condition=\`).`);
    }
    // complex gateways are W_C8_DEPLOY_UNSUPPORTED, parallel / event-based ones W_CONDITION_IGNORED
    if (source && !this.kit.is(source, 'bpmn:ParallelGateway') && !this.kit.is(source, 'bpmn:EventBasedGateway') && !this.kit.is(source, 'bpmn:ExclusiveGateway') && !this.kit.is(source, 'bpmn:InclusiveGateway') && !this.kit.is(source, 'bpmn:ComplexGateway')) {
      this.push('runtime', 'W_C8_CONDITION_IGNORED', flow, undefined, 'conditionIgnored', `Sequence flow ${id} out of ${this.describe(source)} has a condition; Camunda 8 evaluates conditions at exclusive and inclusive gateways only and always takes this flow`, `Remove it (\`bpmn set <file> ${id} condition=\`), or branch with a gateway: \`bpmn add <file> exclusiveGateway "<Question?>" --after ${idOf(source)}\`, then move the condition onto its flows.`);
    }
  }

  checkBranchingGateway(gw: El): void {
    const flows = this.outgoing.get(gw) ?? [];
    if (flows.length < 2) return;
    const def = peek<El>(gw, 'default');
    for (const f of flows) {
      if (f === def || peek<El>(f, 'conditionExpression')) continue;
      this.push('runtime', 'W_C8_EXCLUSIVE_GATEWAY', gw, undefined, `noCondition:${idOf(f)}`, `Sequence flow ${idOf(f)} out of ${this.describe(gw)} has no condition and is not the default flow: Camunda 8 never takes it (an instance where no condition holds gets an incident)`, `Make it the default flow (\`bpmn set <file> ${idOf(f)} default=true\`) or give it a condition: \`bpmn set <file> ${idOf(f)} ${sh('condition== <expression>')}\`.`, [idOf(f)!]);
    }
  }

  checkEventGateway(gw: El): void {
    const id = idOf(gw)!;
    const flows = this.outgoing.get(gw) ?? [];
    // the engine counts the <bpmn:outgoing> entries of the gateway, which a file may leave out
    const listed = flows.filter((f) => !this.unlisted.has(f) || this.unlisted.get(f) !== gw);
    if (flows.length < 2) {
      this.push('deploy', 'W_C8_DEPLOY_EVENT_GATEWAY', gw, undefined, 'branches', `Event-based gateway ${id} has ${flows.length} outgoing flow${flows.length === 1 ? '' : 's'}; Camunda 8 needs at least two and refuses the file`, `Add a branch: \`bpmn add <file> intermediateCatchEvent:timer "<Timeout>" --after ${id} --timer PT1H\`.`);
    } else if (listed.length < 2) {
      this.push('deploy', 'W_C8_DEPLOY_EVENT_GATEWAY', gw, undefined, 'branches', `Event-based gateway ${id} has ${flows.length} outgoing flows, but the file lists ${listed.length} of them as its <bpmn:outgoing> entries; Camunda 8 counts the listed ones and refuses the file`, `Add the missing <bpmn:outgoing>${flows.filter((f) => !listed.includes(f)).map(idOf).join('</bpmn:outgoing>, <bpmn:outgoing>')}</bpmn:outgoing> entries to ${id} in the XML (Camunda Modeler writes them; this file leaves the lists out, and \`bpmn\` keeps a file's style).`);
    }
    for (const f of flows) {
      const t = peek<El>(f, 'targetRef');
      if (!t) continue;
      const defs = list(t, 'eventDefinitions');
      const ok = this.kit.is(t, 'bpmn:IntermediateCatchEvent') && defs.length === 1 && EVENT_GATEWAY_TRIGGERS.some((k) => this.kit.is(defs[0], `bpmn:${k}EventDefinition`));
      if (!ok) {
        this.push('deploy', 'W_C8_DEPLOY_EVENT_GATEWAY', gw, undefined, `target:${idOf(t)}`, `Event-based gateway ${id} leads to ${this.describe(t)}; Camunda 8 allows only message, timer, signal and conditional intermediate catch events after it and refuses the file`, this.kit.is(t, 'bpmn:ReceiveTask') ? `Use a message catch event: \`bpmn retype <file> ${idOf(t)} intermediateCatchEvent:message --message ${sh(nameOf(this.messageOf(t)) ?? '<MessageName>')}\`.` : `Put a catch event in between: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${idOf(f)} --message <MessageName>\` (or retype ${idOf(t)}).`, [idOf(t)!, idOf(f)!]);
      }
    }
  }
}
