import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { C7FlowGraph } from '../flows/C7FlowGraph.js';
import { C7EventDefinitions } from './C7EventDefinitions.js';
import { C7ExecutableScope } from './C7ExecutableScope.js';
import { sh } from '../../shell.js';
import { triggerName } from '../../describe.js';

/** The `bpmn add eventSubProcess` option that carries a trigger's reference. */
const TRIGGER_OPTIONS: Record<string, string> = {
  message: 'messageRef',
  signal: 'signalRef',
  error: 'errorRef',
  escalation: 'escalationRef',
};

/**
 * How to get rid of a second start event `extra` next to `first`, without running a node twice:
 * its flows into what `first` reaches go with it, a branch of its own moves to `first` unless it
 * runs into a node `first` reaches. A process may keep it with another trigger, an event
 * sub-process may keep its trigger in an event sub-process of its own.
 */
export class C7ExtraStartHint {
  private readonly graph: C7FlowGraph;

  constructor(
    private readonly scope: ModdleElement,
    private readonly first: ModdleElement,
    private readonly extra: ModdleElement,
  ) {
    this.graph = C7FlowGraph.forElement(scope);
  }

  text(): string {
    const parts = [this.removal()];
    if (is(this.scope, 'bpmn:Process')) {
      parts.push(
        `give it another trigger, which keeps it as a second way into the process: \`bpmn set <file> ${this.extra.id} trigger=message message=<Name>\``,
      );
    }
    const again = C7ExecutableScope.isEventSubProcess(this.scope) ? this.ownEventSubProcess() : '';
    return `${parts.join(', or ')}${again ? `; ${again}` : ''}.`;
  }

  private removal(): string {
    const extraId = this.extra.id;
    const firstId = this.first.id;
    const reached = this.reachableFrom(this.first);
    const flows = this.graph.outgoing(this.extra);
    const own = flows.filter((flow) => {
      const target = flow.targetRef;
      return target && target !== this.first && !reached.has(target);
    });
    const into = flows.filter((flow) => !own.includes(flow));
    const remove = `\`bpmn remove <file> ${extraId}\``;
    if (!own.length) {
      const goes = into.length
        ? ` (${firstId} already leads to ${this.targets(into)}; ${this.ids(into)} go${into.length === 1 ? 'es' : ''} with it)`
        : '';
      return `Remove it: ${remove}${goes}`;
    }
    const meet = this.meetingNodes(own, reached);
    if (meet.length) {
      const names = meet.slice(0, 3).join(', ') + (meet.length > 3 ? ', ...' : '');
      return `Remove it: ${remove} (${this.targets(own)} is then no longer started; starting it from ${firstId} instead would run ${names}, which ${firstId} reaches too, once per branch)`;
    }
    const moves = own
      .map((flow) => `\`bpmn set <file> ${flow.id} source=${firstId}\``)
      .join(', ');
    const notes = [
      this.graph.outgoing(this.first).length ? `${firstId} then starts both branches in parallel` : '',
      into.length
        ? `${this.ids(into)} into ${this.targets(into)}, which ${firstId} already reaches, go${into.length === 1 ? 'es' : ''} with ${extraId}`
        : '',
    ].filter(Boolean);
    return `Start its branch from ${firstId}: ${moves}, then ${remove}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  }

  /** The nodes (no end events) a branch of its own runs into that `first` reaches as well. */
  private meetingNodes(own: ModdleElement[], reached: Set<ModdleElement>): string[] {
    const meet = new Set<string>();
    for (const flow of own) {
      for (const node of this.reachableFrom(flow.targetRef)) {
        if (reached.has(node) && !is(node, 'bpmn:EndEvent') && node.id) {
          meet.add(node.id);
        }
      }
    }
    return [...meet];
  }

  /** The flow nodes reachable from `from` (without `from`, unless a loop leads back to it). */
  private reachableFrom(from: ModdleElement): Set<ModdleElement> {
    const seen = new Set<ModdleElement>();
    const queue = [from];
    while (queue.length) {
      for (const flow of this.graph.outgoing(queue.shift())) {
        const target = flow.targetRef;
        if (target && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    return seen;
  }

  /** `then keep its <trigger> trigger in an event sub-process of its own: ...` */
  private ownEventSubProcess(): string {
    const definitions = new C7EventDefinitions(this.extra);
    const definition = definitions.acting() ?? definitions.all()[0];
    if (!definition) {
      return '';
    }
    const trigger = triggerName(definition);
    const options = [
      this.triggerOption(trigger, definition),
      this.extra.isInterrupting === false ? '--non-interrupting' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const parentId = C7ExecutableScope.scopeOf(this.scope)?.id ?? '<parentId>';
    return `then keep its ${trigger} trigger in an event sub-process of its own: \`bpmn add <file> eventSubProcess:${trigger} "<Name>" --in ${parentId}${options ? ` ${options}` : ''}\``;
  }

  private triggerOption(trigger: string, definition: ModdleElement): string {
    const reference = TRIGGER_OPTIONS[trigger];
    if (reference) {
      const name = definition.get(reference)?.name;
      const named = typeof name === 'string' && name.trim() ? name : '<Name>';
      return `--${trigger} ${sh(named)}`;
    }
    if (trigger === 'timer') {
      return '--timer <value>';
    }
    return trigger === 'conditional' ? `--when ${sh('${expression}')}` : '';
  }

  private ids(flows: ModdleElement[]): string {
    return flows.map((flow) => flow.id).join(', ');
  }

  private targets(flows: ModdleElement[]): string {
    const ids = flows.map((flow) => flow.targetRef?.id).filter((id): id is string => !!id);
    return [...new Set(ids)].join(', ');
  }
}
