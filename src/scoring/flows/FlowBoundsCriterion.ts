import type { DrawnEdge, DrawnPlane, DrawnShape } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class FlowBoundsCriterion extends ScoringCriterion {
  readonly kinds = ['edgeOutside', 'edgeLeavesLane'] as const;

  private static frameOf(flow: DrawnEdge, plane: DrawnPlane): DrawnShape | undefined {
    const parent = plane.homes.parents.get(flow.id);
    return parent?.is('bpmn:SubProcess') ? plane.expandedSubProcess(parent) : plane.poolOf(parent);
  }

  private static leaves(flow: DrawnEdge, frame: DrawnShape): boolean {
    return flow.points.some((point) => !frame.bounds.contains(point));
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const flow of plane.sequenceFlows) {
      const frame = FlowBoundsCriterion.frameOf(flow, plane);
      if (frame && FlowBoundsCriterion.leaves(flow, frame)) {
        report.add('edgeOutside', flow.id, [flow.id, frame.id]);
      }
      const sourceLane = plane.homes.lanes.get(flow.sourceId);
      const lane = sourceLane && sourceLane === plane.homes.lanes.get(flow.targetId) ? plane.shape(sourceLane.id) : undefined;
      if (lane && FlowBoundsCriterion.leaves(flow, lane)) {
        report.add('edgeLeavesLane', flow.id, [flow.id, lane.id]);
      }
    }
  }
}
