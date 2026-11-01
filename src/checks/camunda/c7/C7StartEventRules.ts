import { type BpmnElement, Kinds } from '../../../model/index.js';
import { C7Rules } from './C7Rules.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C7StartEventRules extends C7Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    if (!reporter.executable) {
      return;
    }
    if (element.is('bpmn:Process') || element.is('bpmn:SubProcess')) {
      this.checkStartEvents(element, reporter);
    }
  }

  checkStartEvents(scope: BpmnElement, reporter: RuleReporter): void {
    const id = scope.id ?? '<scopeId>';
    const nodes = this.document.scopes.flowNodes(scope);
    const starts = nodes.filter((node) => node.is('bpmn:StartEvent'));
    const isProcess = scope.is('bpmn:Process');
    const transaction = scope.is('bpmn:Transaction');
    const kind = isProcess ? 'Process' : Kinds.isEventSubProcess(scope) ? 'Event sub-process' : transaction ? 'Transaction' : 'Sub-process';
    if (!starts.length) {
      if (Kinds.isEventSubProcess(scope)) {
        return;
      }
      const what = nodes.length ? 'has no start event' : 'is empty, without a start event';
      const add = nodes.length
        ? `Add one: \`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${id}, then connect it)`
        : `Add content: \`bpmn add <file> startEvent "<Name>" --in ${id}\` and continue from it`;
      const hint = `${add}${isProcess ? '' : `, or remove it: \`bpmn remove <file> ${id}\``}.`;
      if (transaction) {
        reporter.runtime({ code: 'W_C7_TRANSACTION_NO_START', element: scope, subject: 'start:none', message: `${kind} ${id} ${what}: it deploys, but every instance that reaches it fails ("No initial activity found for subprocess ${id}")`, hint });
      } else {
        reporter.deploy({ code: 'W_C7_DEPLOY_START_EVENT', element: scope, subject: 'start:none', message: `${kind} ${id} ${what}; the engines refuse the file (${isProcess ? 'process' : 'subProcess'} must define a startEvent element)`, hint });
      }
      return;
    }
    const limited = isProcess ? starts.filter((start) => this.actedOn(start).every((definition) => definition.is('bpmn:TimerEventDefinition'))) : starts;
    const [first, ...rest] = limited;
    for (const extra of rest) {
      const sid = extra.id;
      const message = isProcess
        ? `Start event ${sid} is a second none or timer start event of process ${id} (with ${first?.id}); the engines allow only one and refuse the file`
        : `${kind} ${id} has ${limited.length} start events (${limited.map(({ id: startId }) => startId).join(', ')}); the engines allow only one in a sub-process and refuse the file`;
      reporter.deploy({ code: 'W_C7_DEPLOY_START_EVENT', element: extra, subject: 'start:multiple', message, hint: this.extraStartHint(scope, first!, extra), related: [first!.id] });
    }
  }

  private reachableFrom(from: BpmnElement): Set<BpmnElement> {
    const seen = new Set<BpmnElement>();
    const queue = [from];
    while (queue.length) {
      for (const flow of this.outgoing.get(queue.shift()!) ?? []) {
        const target = flow.peek<BpmnElement>('targetRef');
        if (target && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    return seen;
  }

  private extraStartHint(scope: BpmnElement, first: BpmnElement, extra: BpmnElement): string {
    const sid = extra.id;
    const fid = first.id;
    const reached = this.reachableFrom(first);
    const flows = this.outgoing.get(extra) ?? [];
    const own = flows.filter((flow) => {
      const target = flow.peek<BpmnElement>('targetRef');
      return target && target !== first && !reached.has(target);
    });
    const into = flows.filter((flow) => !own.includes(flow));
    const meet = new Set<string>();
    for (const flow of own) {
      const target = flow.peek<BpmnElement>('targetRef')!;
      for (const node of this.reachableFrom(target)) {
        if (reached.has(node) && !node.is('bpmn:EndEvent') && node.id) {
          meet.add(node.id);
        }
      }
    }
    const ids = (els: BpmnElement[]): string => els.map(({ id }) => id).join(', ');
    const targets = (els: BpmnElement[]): string => [...new Set(els.map((flow) => flow.peek<BpmnElement>('targetRef')?.id).filter((targetId): targetId is string => !!targetId))].join(', ');
    const remove = `\`bpmn remove <file> ${sid}\``;
    const parts: string[] = [];
    if (!own.length) {
      parts.push(`Remove it: ${remove}${into.length ? ` (${fid} already leads to ${targets(into)}; ${ids(into)} go${into.length === 1 ? 'es' : ''} with it)` : ''}`);
    } else if (meet.size) {
      const names = [...meet].slice(0, 3).join(', ') + (meet.size > 3 ? ', ...' : '');
      parts.push(`Remove it: ${remove} (${targets(own)} is then no longer started; starting it from ${fid} instead would run ${names}, which ${fid} reaches too, once per branch)`);
    } else {
      const moves = own.map((flow) => `\`bpmn set <file> ${flow.id} source=${fid}\``).join(', ');
      const notes = [(this.outgoing.get(first) ?? []).length ? `${fid} then starts both branches in parallel` : '', into.length ? `${ids(into)} into ${targets(into)}, which ${fid} already reaches, go${into.length === 1 ? 'es' : ''} with ${sid}` : ''].filter(Boolean);
      parts.push(`Start its branch from ${fid}: ${moves}, then ${remove}${notes.length ? ` (${notes.join('; ')})` : ''}`);
    }
    if (scope.is('bpmn:Process')) {
      parts.push(`give it another trigger, which keeps it as a second way into the process: \`bpmn set <file> ${sid} trigger=message message=<Name>\``);
    }
    const again = Kinds.isEventSubProcess(scope) ? this.ownEventSubProcess(scope, extra) : '';
    return `${parts.join(', or ')}${again ? `; ${again}` : ''}.`;
  }

  private ownEventSubProcess(scope: BpmnElement, extra: BpmnElement): string {
    const def = this.actingDefinition(extra) ?? extra.list('eventDefinitions')[0];
    if (!def) {
      return '';
    }
    const trigger = this.triggerName(def);
    const ref = (prop: string): string => ShellWords.quote(this.nameOf(def.peek<BpmnElement>(prop)) ?? '<Name>');
    const option: Record<string, string> = {
      message: `--message ${ref('messageRef')}`,
      signal: `--signal ${ref('signalRef')}`,
      error: `--error ${ref('errorRef')}`,
      escalation: `--escalation ${ref('escalationRef')}`,
      timer: '--timer <value>',
      conditional: `--when ${ShellWords.quote('${expression}')}`,
    };
    const opts = [option[trigger] ?? '', extra.peek<boolean>('isInterrupting') === false ? '--non-interrupting' : ''].filter(Boolean).join(' ');
    return `then keep its ${trigger} trigger in an event sub-process of its own: \`bpmn add <file> eventSubProcess:${trigger} "<Name>" --in ${this.document.scopes.scopeOf(scope)?.id ?? '<parentId>'}${opts ? ` ${opts}` : ''}\``;
  }
}
