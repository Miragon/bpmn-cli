import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { C7EventDefinitions } from './C7EventDefinitions.js';
import { C7ExecutableScope } from './C7ExecutableScope.js';

export type SubscriptionKind = 'message' | 'signal';

/** A message or signal subscription whose name an earlier one of its engine scope already has. */
export interface DuplicateSubscription {
  first: ModdleElement;
  el: ModdleElement;
  name: string;
  /** The report path from `el` to its message or signal reference. */
  path: (string | number)[];
}

interface Subscription {
  el: ModdleElement;
  path: (string | number)[];
}

/**
 * The message and signal subscriptions of a process, grouped by the engine scope they share: the
 * start events of a process; the event sub-process starts of a scope with the boundary events on it;
 * the boundary events of one activity with its own receive-task message (multi-instance: separate
 * scopes). The content of an ad-hoc sub-process is skipped, as the engines skip it.
 */
export class C7Subscriptions {
  private readonly groups = new Map<string, Subscription[]>();

  constructor(process: ModdleElement) {
    this.collect(process);
  }

  /** The second and later subscriptions of `kind` with one name in one scope, in document order. */
  duplicates(kind: SubscriptionKind): DuplicateSubscription[] {
    const found: DuplicateSubscription[] = [];
    for (const [key, subscriptions] of this.groups) {
      const [groupKind, , name] = key.split('\u0000');
      if (groupKind !== kind) {
        continue;
      }
      const [first, ...rest] = subscriptions;
      for (const { el, path } of rest) {
        found.push({ first: first!.el, el, name: name!, path });
      }
    }
    return found;
  }

  private collect(scope: ModdleElement): void {
    for (const node of scope.flowElements ?? []) {
      this.add(node);
      if (is(node, 'bpmn:SubProcess') && !is(node, 'bpmn:AdHocSubProcess')) {
        this.collect(node);
      }
    }
  }

  private add(node: ModdleElement): void {
    if (is(node, 'bpmn:ReceiveTask')) {
      this.addNamed('message', `scope:${node.id}`, node.messageRef?.name, {
        el: node,
        path: ['messageRef'],
      });
      return;
    }
    const scope = this.scopeKey(node);
    if (!scope) {
      return;
    }
    const definitions = new C7EventDefinitions(node);
    const message = definitions.ofType('bpmn:MessageEventDefinition');
    if (message) {
      this.addNamed('message', scope, message.messageRef?.name, {
        el: node,
        path: definitions.pathTo(message, 'messageRef'),
      });
    }
    const signal = definitions.ofType('bpmn:SignalEventDefinition');
    if (signal) {
      this.addNamed('signal', scope, signal.signalRef?.name, {
        el: node,
        path: definitions.pathTo(signal, 'signalRef'),
      });
    }
  }

  private scopeKey(node: ModdleElement): string | undefined {
    if (is(node, 'bpmn:StartEvent')) {
      const parent = node.$parent;
      if (is(parent, 'bpmn:Process')) {
        return `start:${parent.id}`;
      }
      if (C7ExecutableScope.isEventSubProcess(parent)) {
        return `scope:${C7ExecutableScope.scopeOf(parent)?.id}`;
      }
      return undefined;
    }
    if (is(node, 'bpmn:BoundaryEvent') && node.attachedToRef) {
      const host = node.attachedToRef;
      const loop = host.loopCharacteristics;
      const multiInstance = !!loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics');
      return `${multiInstance ? 'body' : 'scope'}:${host.id}`;
    }
    return undefined;
  }

  private addNamed(
    kind: SubscriptionKind,
    scope: string,
    name: string | undefined,
    subscription: Subscription,
  ): void {
    if (!name) {
      return;
    }
    const key = `${kind}\u0000${scope}\u0000${name}`;
    const group = this.groups.get(key);
    if (group) {
      group.push(subscription);
    } else {
      this.groups.set(key, [subscription]);
    }
  }
}
