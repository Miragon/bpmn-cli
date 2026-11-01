import { ElementLabels, IdRequests, IdWords, Kinds, Triggers, type BpmnDocument, type BpmnElement, type IdRequest } from '../../model/index.js';

export interface GivenId {
  id: string;
  kind: string;
  name?: string;
}

export class DrawnElementIds {
  private static readonly CONNECTIONS: readonly string[] = ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation'];
  private static readonly DRAWN: readonly string[] = [
    'bpmn:Process',
    'bpmn:Collaboration',
    'bpmn:Participant',
    'bpmn:Lane',
    'bpmn:FlowNode',
    'bpmn:DataObjectReference',
    'bpmn:DataStoreReference',
    'bpmn:TextAnnotation',
    'bpmn:Group',
    ...DrawnElementIds.CONNECTIONS,
  ];

  constructor(private readonly document: BpmnDocument) {}

  private static hasId(element: BpmnElement | undefined): boolean {
    const id = element?.peek('id');
    return typeof id === 'string' && !!id;
  }

  private static isConnection(element: BpmnElement): boolean {
    return DrawnElementIds.CONNECTIONS.some((type) => element.is(type));
  }

  private static endsOf(element: BpmnElement): [BpmnElement | undefined, BpmnElement | undefined] {
    const source = element.get<BpmnElement | BpmnElement[] | undefined>('sourceRef');
    return [Array.isArray(source) ? source[0] : (source as BpmnElement | undefined), element.get<BpmnElement | undefined>('targetRef')];
  }

  private static namedIn(element: BpmnElement): { name?: string } {
    const name = element.get<string | undefined>('name');
    return typeof name === 'string' && name.trim() ? { name } : {};
  }

  private static labelOf(end: BpmnElement | undefined): string {
    return end && DrawnElementIds.hasId(end) ? new ElementLabels(end).label() : '';
  }

  private static connectionRequest(element: BpmnElement, context: string): IdRequest {
    const [source, target] = DrawnElementIds.endsOf(element);
    const named = DrawnElementIds.namedIn(element);
    if (source && target && DrawnElementIds.hasId(source) && DrawnElementIds.hasId(target) && (element.is('bpmn:SequenceFlow') || element.is('bpmn:MessageFlow'))) {
      return ElementLabels.flowRequest(element.type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source, target, named.name);
    }
    return IdRequests.typeRequest(element.type, { context: source || target ? `${DrawnElementIds.labelOf(source)} To ${DrawnElementIds.labelOf(target)}` : context });
  }

  private static requestFor(element: BpmnElement, context: string): IdRequest {
    if (DrawnElementIds.isConnection(element)) {
      return DrawnElementIds.connectionRequest(element, context);
    }
    const named = DrawnElementIds.namedIn(element);
    const definition = Kinds.of(element);
    if (!definition) {
      return IdRequests.typeRequest(element.type, { ...named, context });
    }
    const trigger = Triggers.of(element);
    return IdRequests.kindRequest(definition, { ...(definition.family === 'event' && trigger && trigger !== 'none' ? { trigger } : {}), ...named, context });
  }

  give(): GivenId[] {
    const idless = [...this.document.tree.walk(undefined, { bpmnOnly: true })].filter((element) => !element.isDi && !DrawnElementIds.hasId(element) && DrawnElementIds.DRAWN.some((type) => element.is(type)));
    const connectionsLast = [...idless.filter((element) => !DrawnElementIds.isConnection(element)), ...idless.filter(DrawnElementIds.isConnection)];
    return connectionsLast.map((element) => this.giveId(element));
  }

  private giveId(element: BpmnElement): GivenId {
    const id = this.document.ids.allocate(DrawnElementIds.requestFor(element, this.contextOf(element))).id;
    element.set('id', id);
    const kind = Kinds.of(element) ? Kinds.label(element) : IdWords.lcfirst(element.type.slice(element.type.indexOf(':') + 1));
    return { id, kind, ...DrawnElementIds.namedIn(element) };
  }

  private contextOf(element: BpmnElement): string {
    if (element.is('bpmn:Collaboration')) {
      return this.contextOfCollaboration(element);
    }
    if (element.is('bpmn:Process')) {
      return this.contextOfProcess(element);
    }
    let parent = element.parent;
    while (parent && (!DrawnElementIds.hasId(parent) || parent.is('bpmn:LaneSet')) && !parent.is('bpmn:Definitions')) {
      parent = parent.parent;
    }
    return parent && !parent.is('bpmn:Definitions') ? new ElementLabels(parent).context('In') : '';
  }

  private contextOfCollaboration(collaboration: BpmnElement): string {
    const processes = collaboration.get<BpmnElement[] | undefined>('participants')?.map((participant) => participant.get<BpmnElement | undefined>('processRef')) ?? [];
    const process = processes.find(Boolean) ?? this.document.tree.processes()[0];
    return process ? new ElementLabels(process).label() : '';
  }

  private contextOfProcess(process: BpmnElement): string {
    const pool = [...this.document.tree.walk(undefined, { bpmnOnly: true })].find((candidate) => candidate.is('bpmn:Participant') && candidate.get<BpmnElement | undefined>('processRef') === process);
    return pool && (DrawnElementIds.hasId(pool) || pool.get<string | undefined>('name')) ? new ElementLabels(pool).label() : '';
  }
}
