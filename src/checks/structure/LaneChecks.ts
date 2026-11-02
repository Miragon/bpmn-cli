import { type BpmnDocument, type BpmnElement, ElementText } from '../../model/index.js';
import type { StructureFindings } from './StructureFindings.js';

export class LaneChecks {
  constructor(
    private readonly document: BpmnDocument,
    private readonly findings: StructureFindings,
  ) {}

  checkLanes(process: BpmnElement): void {
    const lanes = this.document.scopes.allLanes(process);
    if (!lanes.length) {
      return;
    }
    const seen = this.laneMembers(process, lanes);
    for (const [member, inLanes] of seen) {
      if (inLanes.length > 1) {
        this.findings.error('E_LANE_CONFLICT', `${this.findings.describe(member)} is a member of ${inLanes.length} lanes (${inLanes.map((element) => ElementText.shownId(element)).join(', ')})`, ElementText.shownId(member), { related: inLanes.map((element) => ElementText.shownId(element)), hint: `A node belongs to one lane: \`bpmn set <file> ${ElementText.shownId(member)} lane=<laneId>\` keeps only that one.` });
      }
    }
    for (const node of this.document.scopes.flowNodes(process)) {
      if (node.is('bpmn:BoundaryEvent')) {
        continue;
      }
      if (!seen.has(node)) {
        this.findings.warning('W_NOT_IN_LANE', `${this.findings.describe(node)} is in no lane although process ${ElementText.shownId(process)} has lanes`, ElementText.shownId(node), { hint: `Assign it: \`bpmn set <file> ${ElementText.shownId(node)} lane=<laneId>\` (lanes: ${lanes.map((element) => ElementText.shownId(element)).join(', ')}).` });
      }
    }
  }

  private laneMembers(process: BpmnElement, lanes: BpmnElement[]): Map<BpmnElement, BpmnElement[]> {
    const direct = this.document.scopes.flowElements(process);
    const seen = new Map<BpmnElement, BpmnElement[]>();
    for (const lane of lanes) {
      for (const member of lane.list('flowNodeRef')) {
        if (!member.is('bpmn:FlowNode') || !direct.includes(member)) {
          this.findings.error('E_INVALID_LANE_MEMBER', `Lane ${ElementText.shownId(lane)} lists ${ElementText.shownId(member)}, which is not a flow node of process ${ElementText.shownId(process)}`, ElementText.shownId(lane), { related: [ElementText.shownId(member)], hint: 'Only flow nodes declared directly in the process (not inside sub-processes) can be lane members. Fix with `bpmn set <file> <nodeId> --unset lane`.' });
          continue;
        }
        seen.set(member, [...(seen.get(member) ?? []), lane]);
      }
    }
    return seen;
  }
}
