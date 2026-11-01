import type { BpmnDocument, BpmnElement } from '../../model/index.js';

export class ElementHomes {
  readonly parents = new Map<string | undefined, BpmnElement>();
  readonly lanes = new Map<string | undefined, BpmnElement>();
  readonly pools = new Map<string | undefined, BpmnElement>();
  readonly required = new Set<string>();
  private readonly successors = new Map<string, string[]>();

  constructor(document: BpmnDocument) {
    const roots = document.tree.definitions.list('rootElements');
    for (const root of roots) {
      if (root.is('bpmn:Process')) {
        this.collectScope(root);
      }
      if (root.is('bpmn:Collaboration')) {
        this.collectCollaboration(root);
      }
    }
    this.dropUndrawnProcesses(roots);
  }

  private static ancestorsToProcess(element: BpmnElement): BpmnElement[] {
    const ancestors: BpmnElement[] = [];
    for (let current = element.parent; current; current = ancestors.at(-1)?.is('bpmn:Process') ? undefined : current.parent) {
      ancestors.push(current);
    }
    return ancestors;
  }

  static scopesOf(element: BpmnElement): BpmnElement[] {
    return ElementHomes.ancestorsToProcess(element).filter((ancestor) => ancestor.is('bpmn:SubProcess') || ancestor.is('bpmn:Process'));
  }

  static laneChainOf(lane: BpmnElement): BpmnElement[] {
    return [lane, ...ElementHomes.ancestorsToProcess(lane)].filter((element) => element.is('bpmn:Lane'));
  }

  processOf(element: BpmnElement | undefined): BpmnElement | undefined {
    return element && [element, ...ElementHomes.ancestorsToProcess(element)].find((candidate) => candidate.is('bpmn:Process'));
  }

  reaches(from: string, to: string): boolean {
    const seen = new Set([from]);
    for (const current of seen) {
      if (current === to) {
        return true;
      }
      this.successors.get(current)?.forEach((next) => seen.add(next));
    }
    return false;
  }

  private require(element: BpmnElement): void {
    if (element.id) {
      this.required.add(element.id);
    }
  }

  private collectCollaboration(collaboration: BpmnElement): void {
    for (const participant of collaboration.list('participants')) {
      this.require(participant);
      const process = participant.peek<BpmnElement>('processRef');
      if (process?.id) {
        this.pools.set(process.id, participant);
      }
    }
    collaboration.list('messageFlows').forEach((flow) => this.require(flow));
  }

  private collectLanes(lanes: readonly BpmnElement[]): void {
    for (const lane of lanes) {
      for (const node of lane.list('flowNodeRef')) {
        if (node.id) {
          this.lanes.set(node.id, lane);
        }
      }
      this.collectLanes(lane.peek<BpmnElement>('childLaneSet')?.list('lanes') ?? []);
    }
  }

  private link(from: string | undefined, to: string | undefined): void {
    if (from && to) {
      this.successors.set(from, [...(this.successors.get(from) ?? []), to]);
    }
  }

  private collectFlowElement(scope: BpmnElement, element: BpmnElement): void {
    if (element.id) {
      this.parents.set(element.id, scope);
      if (['bpmn:FlowNode', 'bpmn:SequenceFlow', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference'].some((type) => element.is(type))) {
        this.required.add(element.id);
      }
    }
    if (element.is('bpmn:SubProcess')) {
      this.collectScope(element);
    }
    if (element.is('bpmn:SequenceFlow')) {
      this.link(element.peek<BpmnElement>('sourceRef')?.id, element.peek<BpmnElement>('targetRef')?.id);
    }
    if (element.is('bpmn:BoundaryEvent')) {
      this.link(element.peek<BpmnElement>('attachedToRef')?.id, element.id);
    }
    [...element.list('dataInputAssociations'), ...element.list('dataOutputAssociations')].forEach((association) => this.require(association));
  }

  private collectScope(scope: BpmnElement): void {
    scope.list('flowElements').forEach((element) => this.collectFlowElement(scope, element));
    for (const artifact of scope.list('artifacts').filter(({ id }) => id)) {
      this.parents.set(artifact.id, scope);
      if (artifact.is('bpmn:TextAnnotation') || artifact.is('bpmn:Association')) {
        this.required.add(artifact.id);
      }
    }
    scope.list('laneSets').forEach((laneSet) => this.collectLanes(laneSet.list('lanes')));
  }

  private dropUndrawnProcesses(roots: readonly BpmnElement[]): void {
    const collaboration = roots.find((root) => root.is('bpmn:Collaboration'));
    const drawn = collaboration ? collaboration.list('participants').map((participant) => participant.peek<BpmnElement>('processRef')) : [roots.find((root) => root.is('bpmn:Process'))];
    const drawnIds = new Set(drawn.map((process) => process?.id).filter(Boolean));
    for (const id of [...this.required]) {
      const process = this.processOf(this.parents.get(id));
      if (process && !drawnIds.has(process.id)) {
        this.required.delete(id);
      }
    }
  }
}
