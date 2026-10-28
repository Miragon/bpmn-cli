import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { C8EventPosition } from './C8EventPosition.js';
import type { FlowIndex } from './FlowIndex.js';

/** The boundary events of one activity in a (sub-)process. */
export interface BoundaryGroup {
  activity: ModdleElement;
  boundaries: ModdleElement[];
}

/** An element whose key an earlier element of its group already has. */
export interface Duplicate {
  first: ModdleElement;
  el: ModdleElement;
  key: string;
}

/**
 * The events of one (sub-)process that Camunda 8 subscribes to together, so a message name, signal
 * name or error code may occur only once among them: the boundary events of one activity, the
 * targets of one event-based gateway, the start events of the scope's event sub-processes and the
 * start events of a process.
 */
export class SubscriptionGroups {
  private readonly nodes: ModdleElement[];

  constructor(
    private readonly scope: ModdleElement,
    private readonly flows: FlowIndex,
  ) {
    this.nodes = (scope.get('flowElements') ?? []).filter((element: ModdleElement) =>
      is(element, 'bpmn:FlowNode'),
    );
  }

  /** The 2nd and later elements of `elements` whose key (`undefined`: none) an earlier one has. */
  static duplicates(
    elements: ModdleElement[],
    keyOf: (el: ModdleElement) => string | undefined,
  ): Duplicate[] {
    const firstByKey = new Map<string, ModdleElement>();
    const duplicates: Duplicate[] = [];
    for (const el of elements) {
      const key = keyOf(el);
      if (key === undefined) {
        continue;
      }
      const first = firstByKey.get(key);
      if (first) {
        duplicates.push({ first, el, key });
      } else {
        firstByKey.set(key, el);
      }
    }
    return duplicates;
  }

  /** Every activity of the scope that has boundary events, in document order. */
  boundaryGroups(): BoundaryGroup[] {
    const boundariesByActivity = new Map<ModdleElement, ModdleElement[]>();
    for (const node of this.nodes) {
      const host = is(node, 'bpmn:BoundaryEvent') ? node.get('attachedToRef') : undefined;
      if (host) {
        const boundaries = boundariesByActivity.get(host) ?? [];
        boundaries.push(node);
        boundariesByActivity.set(host, boundaries);
      }
    }
    return this.nodes
      .filter((node) => is(node, 'bpmn:Activity') && boundariesByActivity.has(node))
      .map((activity) => ({ activity, boundaries: boundariesByActivity.get(activity)! }));
  }

  /** The intermediate catch events each event-based gateway of the scope leads to. */
  gatewayTargets(): Array<{ gateway: ModdleElement; targets: ModdleElement[] }> {
    return this.nodes
      .filter((node) => is(node, 'bpmn:EventBasedGateway'))
      .map((gateway) => ({
        gateway,
        targets: this.flows
          .outgoing(gateway)
          .map((flow) => flow.get('targetRef'))
          .filter((target) => target && is(target, 'bpmn:IntermediateCatchEvent')),
      }));
  }

  /** The start events of the event sub-processes directly in the scope. */
  eventSubProcessStarts(): ModdleElement[] {
    return this.nodes
      .filter((node) => C8EventPosition.isEventSubProcess(node))
      .flatMap((subProcess) =>
        (subProcess.get('flowElements') ?? []).filter((element: ModdleElement) =>
          is(element, 'bpmn:StartEvent'),
        ),
      );
  }

  /** The start events of a process; none for a sub-process. */
  processStarts(): ModdleElement[] {
    return is(this.scope, 'bpmn:Process')
      ? this.nodes.filter((node) => is(node, 'bpmn:StartEvent'))
      : [];
  }
}
