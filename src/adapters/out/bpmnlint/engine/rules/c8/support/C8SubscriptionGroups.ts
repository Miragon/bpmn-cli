import { is } from 'bpmnlint-utils';
import type { ModdleElement } from '../../CamundaRule.js';
import { EngineScope } from '../../support/EngineScope.js';
import type { FlowIndex } from './FlowIndex.js';

/**
 * The events of one (sub-)process that Camunda 8 subscribes to together, so a message name, signal
 * name or error code may occur only once among them: the boundary events of one activity, the
 * targets of one event-based gateway, the start events of the scope's event sub-processes and the
 * start events of a process (none for a sub-process).
 */
export class C8SubscriptionGroups {
  readonly boundaryGroups: Array<{ activity: ModdleElement; boundaries: ModdleElement[] }>;
  readonly gatewayTargets: Array<{ gateway: ModdleElement; targets: ModdleElement[] }>;
  readonly eventSubProcessStarts: ModdleElement[];
  readonly processStarts: ModdleElement[];

  constructor(scope: ModdleElement, flows: FlowIndex) {
    const nodes: ModdleElement[] = (scope.get('flowElements') ?? []).filter((element: ModdleElement) => is(element, 'bpmn:FlowNode'));
    const boundariesByActivity = new Map<ModdleElement, ModdleElement[]>();
    for (const node of nodes) {
      const host = is(node, 'bpmn:BoundaryEvent') ? node.get('attachedToRef') : undefined;
      if (host) {
        boundariesByActivity.set(host, [...(boundariesByActivity.get(host) ?? []), node]);
      }
    }
    this.boundaryGroups = nodes.filter((node) => is(node, 'bpmn:Activity') && boundariesByActivity.has(node)).map((activity) => ({ activity, boundaries: boundariesByActivity.get(activity)! }));
    this.gatewayTargets = nodes.filter((node) => is(node, 'bpmn:EventBasedGateway')).map((gateway) => ({ gateway, targets: flows.outgoing(gateway).map((flow) => flow.get('targetRef')).filter((target) => target && is(target, 'bpmn:IntermediateCatchEvent')) }));
    this.eventSubProcessStarts = nodes.filter((node) => EngineScope.isEventSubProcess(node)).flatMap((subProcess) => (subProcess.get('flowElements') ?? []).filter((element: ModdleElement) => is(element, 'bpmn:StartEvent')));
    this.processStarts = is(scope, 'bpmn:Process') ? nodes.filter((node) => is(node, 'bpmn:StartEvent')) : [];
  }
}
