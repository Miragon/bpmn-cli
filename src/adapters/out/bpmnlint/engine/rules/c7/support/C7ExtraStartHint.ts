import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { ElementKinds } from '../../support/ElementKinds.js';
import { EngineScope } from '../../support/EngineScope.js';
import { Shell } from '../../support/Shell.js';
import { C7EventDefinitions } from './C7EventDefinitions.js';
import { C7FlowGraph } from './C7FlowGraph.js';

/** The `bpmn add eventSubProcess` option that carries a trigger's reference. */
const TRIGGER_OPTIONS: Record<string, string> = { message: 'messageRef', signal: 'signalRef', error: 'errorRef', escalation: 'escalationRef' };

/**
 * Builds the fix advice for a second start event Camunda 7 refuses: remove it, move its branch to
 * the first start event, or keep it with another trigger.
 * The advice depends on what each start event reaches, as removing it can leave its branch
 * unstarted and moving the branch can run a node twice.
 */
export class C7ExtraStartHint {
  private readonly graph: C7FlowGraph;

  constructor(private readonly scope: ModdleElement, private readonly first: ModdleElement, private readonly extra: ModdleElement) {
    this.graph = C7FlowGraph.forElement(scope);
  }

  text(): string {
    const parts = [this.removal()];
    if (is(this.scope, 'bpmn:Process')) {
      parts.push(`give it another trigger, which keeps it as a second way into the process: \`bpmn set <file> ${this.extra.id} trigger=message message=<Name>\``);
    }
    const again = EngineScope.isEventSubProcess(this.scope) ? this.ownEventSubProcess() : '';
    return `${parts.join(', or ')}${again ? `; ${again}` : ''}.`;
  }

  private removal(): string {
    const { id: extraId } = this.extra;
    const { id: firstId } = this.first;
    const reached = this.reachableFrom(this.first);
    const flows = this.graph.outgoing(this.extra);
    const own = flows.filter((flow) => flow.targetRef && flow.targetRef !== this.first && !reached.has(flow.targetRef));
    const into = flows.filter((flow) => !own.includes(flow));
    const remove = `\`bpmn remove <file> ${extraId}\``;
    const goes = `go${into.length === 1 ? 'es' : ''}`;
    if (!own.length) {
      return `Remove it: ${remove}${into.length ? ` (${firstId} already leads to ${this.targets(into)}; ${this.ids(into)} ${goes} with it)` : ''}`;
    }
    const meet = this.meetingNodes(own, reached);
    if (meet.length) {
      return `Remove it: ${remove} (${this.targets(own)} is then no longer started; starting it from ${firstId} instead would run ${meet.slice(0, 3).join(', ') + (meet.length > 3 ? ', ...' : '')}, which ${firstId} reaches too, once per branch)`;
    }
    const moves = own.map((flow) => `\`bpmn set <file> ${flow.id} source=${firstId}\``).join(', ');
    const notes = [this.graph.outgoing(this.first).length ? `${firstId} then starts both branches in parallel` : '', into.length ? `${this.ids(into)} into ${this.targets(into)}, which ${firstId} already reaches, ${goes} with ${extraId}` : ''].filter(Boolean);
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
      for (const { targetRef: target } of this.graph.outgoing(queue.shift())) {
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
    if (!definition) return '';
    const trigger = ElementKinds.trigger(definition);
    const options = [this.triggerOption(trigger, definition), this.extra.isInterrupting === false ? '--non-interrupting' : ''].filter(Boolean).join(' ');
    const parentId = EngineScope.scopeOf(this.scope)?.id ?? '<parentId>';
    return `then keep its ${trigger} trigger in an event sub-process of its own: \`bpmn add <file> eventSubProcess:${trigger} "<Name>" --in ${parentId}${options ? ` ${options}` : ''}\``;
  }

  private triggerOption(trigger: string, definition: ModdleElement): string {
    const reference = TRIGGER_OPTIONS[trigger];
    if (reference) {
      const name = definition.get(reference)?.name;
      return `--${trigger} ${Shell.quote(typeof name === 'string' && name.trim() ? name : '<Name>')}`;
    }
    if (trigger === 'timer') return '--timer <value>';
    return trigger === 'conditional' ? `--when ${Shell.quote('${expression}')}` : '';
  }

  private ids(flows: ModdleElement[]): string {
    return flows.map((flow) => flow.id).join(', ');
  }

  private targets(flows: ModdleElement[]): string {
    return [...new Set(flows.map((flow) => flow.targetRef?.id).filter((id): id is string => !!id))].join(', ');
  }
}
