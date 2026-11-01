import type { BpmnNode } from './BpmnNode.js';

export class Semantics {
  private static readonly SUB_PROCESS_TYPES = ['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction'];
  private static readonly DRAWING_TYPE = /^(bpmndi|dc|di):/;

  readonly byId = new Map<string, BpmnNode>();
  readonly laneOf = new Map<string, string>();
  readonly laneParent = new Map<string, string>();
  readonly laneProcess = new Map<string, string>();
  readonly poolOfProcess = new Map<string, string>();
  readonly scopeOf = new Map<string, BpmnNode>();
  collaboration: BpmnNode | undefined;

  constructor(definitions: BpmnNode) {
    for (const node of definitions.tree((candidate) => Semantics.DRAWING_TYPE.test(candidate.type))) {
      if (node.id) {
        this.byId.set(node.id, node);
      }
    }
    for (const root of definitions.list('rootElements')) {
      if (root.is('bpmn:Process')) {
        this.indexProcess(root);
      } else if (root.is('bpmn:Collaboration')) {
        this.indexCollaboration(root);
      }
    }
  }

  static isSubProcess(node: BpmnNode): boolean {
    return Semantics.SUB_PROCESS_TYPES.some((type) => node.is(type));
  }

  private indexProcess(process: BpmnNode): void {
    this.indexScope(process);
    for (const laneSet of process.list('laneSets')) {
      this.indexLanes(laneSet.list('lanes'), process, undefined);
    }
  }

  private indexCollaboration(collaboration: BpmnNode): void {
    this.collaboration ??= collaboration;
    for (const participant of collaboration.list('participants')) {
      const processId = participant.ref('processRef')?.id;
      if (processId && participant.id) {
        this.poolOfProcess.set(processId, participant.id);
      }
    }
    this.indexArtifacts(collaboration);
  }

  private indexScope(scope: BpmnNode): void {
    for (const element of scope.list('flowElements')) {
      if (element.id) {
        this.scopeOf.set(element.id, scope);
      }
      if (Semantics.isSubProcess(element)) {
        this.indexScope(element);
      }
    }
    this.indexArtifacts(scope);
  }

  private indexArtifacts(scope: BpmnNode): void {
    for (const artifact of scope.list('artifacts')) {
      if (artifact.id) {
        this.scopeOf.set(artifact.id, scope);
      }
    }
  }

  private indexLanes(lanes: BpmnNode[], process: BpmnNode, parent: BpmnNode | undefined): void {
    for (const lane of lanes) {
      if (!lane.id) {
        continue;
      }
      this.laneProcess.set(lane.id, process.id as string);
      if (parent) {
        this.laneParent.set(lane.id, parent.id as string);
      }
      this.indexLaneNodes(lane);
      const children = lane.ref('childLaneSet');
      if (children) {
        this.indexLanes(children.list('lanes'), process, lane);
      }
    }
  }

  private indexLaneNodes(lane: BpmnNode): void {
    for (const node of lane.list('flowNodeRef')) {
      if (node.id) {
        this.laneOf.set(node.id, lane.id as string);
      }
    }
  }
}
