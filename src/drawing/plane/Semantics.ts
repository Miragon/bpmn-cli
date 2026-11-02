import { DiagramIndex, ElementWalk, type BpmnElement } from '../../model/index.js';
import type { Plane } from './Plane.js';

export class Semantics {
  readonly byId = new Map<string, BpmnElement>();
  readonly laneOf = new Map<string, string>();
  readonly laneParent = new Map<string, string>();
  readonly laneProcess = new Map<string, string>();
  readonly poolOfProcess = new Map<string, string>();
  readonly scopeOf = new Map<string, BpmnElement>();
  collaboration?: BpmnElement | undefined;

  private constructor() {}

  static of(definitions: BpmnElement): Semantics {
    const semantics = new Semantics();
    semantics.indexElements(definitions);
    for (const root of definitions.list('rootElements')) {
      if (root.is('bpmn:Process')) {
        semantics.indexProcess(root);
      } else if (root.is('bpmn:Collaboration')) {
        semantics.indexCollaboration(root);
      }
    }
    return semantics;
  }

  static sequenceFlows(element: BpmnElement | undefined, direction: 'incoming' | 'outgoing'): BpmnElement[] {
    return (element?.list(direction) ?? []).filter((flow) => flow.is('bpmn:SequenceFlow'));
  }

  static isAnnotationLine(element: BpmnElement): boolean {
    return element.is('bpmn:Association') && (!!element.peek<BpmnElement>('sourceRef')?.is('bpmn:TextAnnotation') || !!element.peek<BpmnElement>('targetRef')?.is('bpmn:TextAnnotation'));
  }

  private static idOf(element: BpmnElement | undefined): string | undefined {
    return element?.peek<string>('id');
  }

  processOf(id: string): BpmnElement | undefined {
    let scope = this.scopeOf.get(id);
    while (scope && !scope.is('bpmn:Process')) {
      scope = this.scopeOf.get(Semantics.idOf(scope) ?? '');
    }
    return scope;
  }

  poolOf(id: string): string | undefined {
    const element = this.byId.get(id);
    if (!element || element.is('bpmn:Participant')) {
      return undefined;
    }
    const processId = element.is('bpmn:Lane') ? this.laneProcess.get(id) : Semantics.idOf(this.processOf(id));
    return processId ? this.poolOfProcess.get(processId) : undefined;
  }

  homePlane(planes: readonly Plane[], id: string): Plane | undefined {
    const element = this.byId.get(id);
    if (!element) {
      return undefined;
    }
    if (element.is('bpmn:Participant') || element.is('bpmn:MessageFlow')) {
      return this.collaborationPlane(planes);
    }
    if (element.is('bpmn:Lane')) {
      return this.planeOfProcess(planes, this.laneProcess.get(id));
    }
    const anchorId = element.is('bpmn:DataAssociation') ? Semantics.idOf(element.parent) : id;
    const scope = anchorId ? this.scopeOf.get(anchorId) : undefined;
    const scopeId = Semantics.idOf(scope);
    if (!scope || !scopeId) {
      return undefined;
    }
    if (scope.is('bpmn:Collaboration')) {
      return this.collaborationPlane(planes);
    }
    return DiagramIndex.isSubProcess(scope) ? this.planeOfSubProcess(planes, scopeId) : this.planeOfProcess(planes, scopeId);
  }

  predecessors(id: string): string[] {
    return Semantics.sequenceFlows(this.byId.get(id), 'incoming').flatMap((flow) => Semantics.idOf(flow.peek<BpmnElement>('sourceRef')) || []);
  }

  successors(id: string): string[] {
    return Semantics.sequenceFlows(this.byId.get(id), 'outgoing').flatMap((flow) => Semantics.idOf(flow.peek<BpmnElement>('targetRef')) || []);
  }

  private collaborationPlane(planes: readonly Plane[]): Plane | undefined {
    const collaborationId = Semantics.idOf(this.collaboration);
    return collaborationId ? planes.find((plane) => plane.rootId === collaborationId) : undefined;
  }

  private planeOfProcess(planes: readonly Plane[], processId: string | undefined): Plane | undefined {
    const own = planes.find((plane) => plane.rootId === processId);
    return own ?? (processId && this.poolOfProcess.has(processId) ? this.collaborationPlane(planes) : undefined);
  }

  private planeOfSubProcess(planes: readonly Plane[], id: string): Plane | undefined {
    return planes.find((plane) => plane.shapes.get(id)?.expanded) ?? planes.find((plane) => plane.rootId === id);
  }

  private indexElements(definitions: BpmnElement): void {
    for (const element of new ElementWalk(definitions).stored((candidate) => /^(bpmndi|dc|di):/.test(candidate.type))) {
      const id = Semantics.idOf(element);
      if (id) {
        this.byId.set(id, element);
      }
    }
  }

  private indexProcess(process: BpmnElement): void {
    this.indexScope(process);
    for (const laneSet of process.list('laneSets')) {
      this.indexLanes(laneSet.list('lanes'), process, undefined);
    }
  }

  private indexCollaboration(collaboration: BpmnElement): void {
    this.collaboration ??= collaboration;
    for (const participant of collaboration.list('participants')) {
      const processId = Semantics.idOf(participant.peek<BpmnElement>('processRef'));
      const participantId = Semantics.idOf(participant);
      if (processId && participantId) {
        this.poolOfProcess.set(processId, participantId);
      }
    }
    this.indexArtifacts(collaboration);
  }

  private indexScope(scope: BpmnElement): void {
    for (const element of scope.list('flowElements')) {
      const id = Semantics.idOf(element);
      if (id) {
        this.scopeOf.set(id, scope);
      }
      if (DiagramIndex.isSubProcess(element)) {
        this.indexScope(element);
      }
    }
    this.indexArtifacts(scope);
  }

  private indexArtifacts(scope: BpmnElement): void {
    for (const artifact of scope.list('artifacts')) {
      const id = Semantics.idOf(artifact);
      if (id) {
        this.scopeOf.set(id, scope);
      }
    }
  }

  private indexLanes(lanes: readonly BpmnElement[], process: BpmnElement, parent: BpmnElement | undefined): void {
    for (const lane of lanes) {
      const id = Semantics.idOf(lane);
      if (id) {
        this.indexLane(id, lane, process, parent);
      }
    }
  }

  private indexLane(id: string, lane: BpmnElement, process: BpmnElement, parent: BpmnElement | undefined): void {
    this.laneProcess.set(id, Semantics.idOf(process)!);
    if (parent) {
      this.laneParent.set(id, Semantics.idOf(parent)!);
    }
    for (const nodeId of lane.list('flowNodeRef').flatMap((node) => Semantics.idOf(node) ?? [])) {
      this.laneOf.set(nodeId, id);
    }
    const children = lane.peek<BpmnElement>('childLaneSet');
    if (children) {
      this.indexLanes(children.list('lanes'), process, lane);
    }
  }
}
