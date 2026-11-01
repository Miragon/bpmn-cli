import { type BpmnElement, BpmnError, Kinds, Triggers } from '../../model/index.js';
import { ElementContainment } from '../containers/ElementContainment.js';
import type { EditSession } from '../session/EditSession.js';

export type ConnectionKind = 'sequenceFlow' | 'messageFlow' | 'association' | 'dataAssociation';

export class ConnectionKinds {
  constructor(private readonly edit: EditSession) {}

  private static ends(flow: BpmnElement): [BpmnElement | undefined, BpmnElement | undefined] {
    return [flow.get<BpmnElement | undefined>('sourceRef'), flow.get<BpmnElement | undefined>('targetRef')];
  }

  private static associates(artifact: BpmnElement, source: BpmnElement, target: BpmnElement): boolean {
    if (!artifact.is('bpmn:Association')) {
      return false;
    }
    const [from, to] = ConnectionKinds.ends(artifact);
    return (from === source && to === target) || (from === target && to === source);
  }

  private static existingAssociation(source: BpmnElement, target: BpmnElement): BpmnElement | undefined {
    const containers = [ElementContainment.artifactContainerOf(source), ElementContainment.artifactContainerOf(target)];
    for (const container of containers) {
      const hit = container?.list('artifacts').find((artifact) => ConnectionKinds.associates(artifact, source, target));
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

  private static existingDataAssociation(source: BpmnElement, target: BpmnElement): BpmnElement | undefined {
    if (ElementContainment.isDataReference(source)) {
      return target.list('dataInputAssociations').find((association) => association.list('sourceRef').includes(source));
    }
    return source.list('dataOutputAssociations').find((association) => association.get<BpmnElement | undefined>('targetRef') === target);
  }

  kindOf(source: BpmnElement, target: BpmnElement): ConnectionKind {
    if (source.is('bpmn:TextAnnotation') || target.is('bpmn:TextAnnotation')) {
      return 'association';
    }
    if (ElementContainment.isDataReference(source) || ElementContainment.isDataReference(target)) {
      return 'dataAssociation';
    }
    if (source.is('bpmn:Participant') || target.is('bpmn:Participant')) {
      return 'messageFlow';
    }
    if (source.is('bpmn:FlowNode') && target.is('bpmn:FlowNode')) {
      return this.kindBetweenNodes(source, target);
    }
    throw BpmnError.model('E_INVALID_ENDPOINT', `Cannot connect ${source.id} (${Kinds.label(source)}) with ${target.id} (${Kinds.label(target)})`, {
      element: source.id,
      related: [target.id],
      hint: 'connect joins flow nodes (sequence flow), nodes in different pools (message flow), a text annotation (association) or a data object/store (data association).',
    });
  }

  existing(kind: ConnectionKind, source: BpmnElement, target: BpmnElement): BpmnElement | undefined {
    switch (kind) {
      case 'sequenceFlow':
        return this.edit.document.flows.outgoing(source).find((flow) => flow.get<BpmnElement | undefined>('targetRef') === target);
      case 'messageFlow':
        return this.edit.document.flows.messageFlows().find((flow) => flow.get<BpmnElement | undefined>('sourceRef') === source && flow.get<BpmnElement | undefined>('targetRef') === target);
      case 'association':
        return ConnectionKinds.existingAssociation(source, target);
      default:
        return ConnectionKinds.existingDataAssociation(source, target);
    }
  }

  private kindBetweenNodes(source: BpmnElement, target: BpmnElement): ConnectionKind {
    if (source.is('bpmn:BoundaryEvent') && Triggers.of(source) === 'compensate' && target.is('bpmn:Activity')) {
      return 'association';
    }
    const from = this.edit.document.scopes.processOf(source);
    const to = this.edit.document.scopes.processOf(target);
    return from && to && from !== to ? 'messageFlow' : 'sequenceFlow';
  }
}
