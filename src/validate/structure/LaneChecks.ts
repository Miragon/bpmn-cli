import type { Doc } from '../../model/Doc.js';
import { is, type El, list, shownId } from '../../model/utils/moddle.js';
import type { StructureFindings } from './StructureFindings.js';

/** Lane membership: flow nodes of the process only, one lane each, none left out. */
export class LaneChecks {
  constructor(
    private readonly doc: Doc,
    private readonly findings: StructureFindings,
  ) {}

  checkLanes(process: El): void {
    const { doc } = this;
    const lanes = doc.allLanes(process);
    if (!lanes.length) return;
    const direct = doc.flowElements(process);
    const seen = new Map<El, El[]>();
    for (const lane of lanes) {
      for (const member of list(lane, 'flowNodeRef')) {
        if (!is(member, 'bpmn:FlowNode') || !direct.includes(member)) {
          this.findings.error('E_INVALID_LANE_MEMBER', `Lane ${shownId(lane)} lists ${shownId(member)}, which is not a flow node of process ${shownId(process)}`, shownId(lane), {
            related: [shownId(member)],
            hint: 'Only flow nodes declared directly in the process (not inside sub-processes) can be lane members. Fix with `bpmn set <file> <nodeId> lane=`.',
          });
          continue;
        }
        seen.set(member, [...(seen.get(member) ?? []), lane]);
      }
    }
    for (const [member, inLanes] of seen) {
      if (inLanes.length > 1) {
        this.findings.error('E_LANE_CONFLICT', `${this.findings.describe(member)} is a member of ${inLanes.length} lanes (${inLanes.map(shownId).join(', ')})`, shownId(member), {
          related: inLanes.map(shownId),
          hint: `A node belongs to one lane: \`bpmn set <file> ${shownId(member)} lane=<laneId>\` keeps only that one.`,
        });
      }
    }
    for (const node of doc.flowNodes(process)) {
      if (is(node, 'bpmn:BoundaryEvent')) continue;
      if (!seen.has(node)) {
        this.findings.warning('W_NOT_IN_LANE', `${this.findings.describe(node)} is in no lane although process ${shownId(process)} has lanes`, shownId(node), {
          hint: `Assign it: \`bpmn set <file> ${shownId(node)} lane=<laneId>\` (lanes: ${lanes.map(shownId).join(', ')}).`,
        });
      }
    }
  }
}
