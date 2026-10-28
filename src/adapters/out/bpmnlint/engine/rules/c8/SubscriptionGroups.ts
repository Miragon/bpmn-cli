import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { EngineScope } from '../EngineScope.js';
import { FirstOfKey } from '../FirstOfKey.js';
import type { FlowIndex } from './FlowIndex.js';

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

  constructor(private readonly scope: ModdleElement, private readonly flows: FlowIndex) {
    this.nodes = (scope.get('flowElements') ?? []).filter((element: ModdleElement) => is(element, 'bpmn:FlowNode'));
  }

  /** The 2nd and later elements of `elements` whose key (`undefined`: none) an earlier one has. */
  static duplicates(elements: ModdleElement[], keyOf: (el: ModdleElement) => string | undefined): Duplicate[] {
    const firsts = new FirstOfKey<ModdleElement>();
    return elements.flatMap((el) => {
      const key = keyOf(el);
      const first = key === undefined ? undefined : firsts.repeats(key, el);
      return first && key !== undefined ? [{ first, el, key }] : [];
    });
  }

  /** Every activity of the scope that has boundary events, in document order, with them. */
  boundaryGroups(): Array<{ activity: ModdleElement; boundaries: ModdleElement[] }> {
    const boundariesByActivity = new Map<ModdleElement, ModdleElement[]>();
    for (const node of this.nodes) {
      const host = is(node, 'bpmn:BoundaryEvent') ? node.get('attachedToRef') : undefined;
      if (host) boundariesByActivity.set(host, [...(boundariesByActivity.get(host) ?? []), node]);
    }
    return this.nodes.filter((node) => is(node, 'bpmn:Activity') && boundariesByActivity.has(node)).map((activity) => ({ activity, boundaries: boundariesByActivity.get(activity)! }));
  }

  /** The intermediate catch events each event-based gateway of the scope leads to. */
  gatewayTargets(): Array<{ gateway: ModdleElement; targets: ModdleElement[] }> {
    return this.nodes.filter((node) => is(node, 'bpmn:EventBasedGateway')).map((gateway) => ({ gateway, targets: this.flows.outgoing(gateway).map((flow) => flow.get('targetRef')).filter((target) => target && is(target, 'bpmn:IntermediateCatchEvent')) }));
  }

  /** The start events of the event sub-processes directly in the scope. */
  eventSubProcessStarts(): ModdleElement[] {
    return this.nodes.filter((node) => EngineScope.isEventSubProcess(node)).flatMap((subProcess) => (subProcess.get('flowElements') ?? []).filter((element: ModdleElement) => is(element, 'bpmn:StartEvent')));
  }

  /** The start events of a process; none for a sub-process. */
  processStarts(): ModdleElement[] {
    return is(this.scope, 'bpmn:Process') ? this.nodes.filter((node) => is(node, 'bpmn:StartEvent')) : [];
  }
}
