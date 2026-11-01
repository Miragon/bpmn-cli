import type { BpmnDocument } from '../model/index.js';
import { BackwardFlowCriterion } from './flows/BackwardFlowCriterion.js';
import { CrossingCriterion } from './flows/CrossingCriterion.js';
import { DegenerateEdgeCriterion } from './flows/DegenerateEdgeCriterion.js';
import { DetachedEdgeCriterion } from './flows/DetachedEdgeCriterion.js';
import { DiagonalCriterion } from './flows/DiagonalCriterion.js';
import { FlowBoundsCriterion } from './flows/FlowBoundsCriterion.js';
import { InOutCriterion } from './flows/InOutCriterion.js';
import { MessageThroughPoolCriterion } from './flows/MessageThroughPoolCriterion.js';
import { ParallelRunCriterion } from './flows/ParallelRunCriterion.js';
import { SegmentOverlapCriterion } from './flows/SegmentOverlapCriterion.js';
import { ThroughCriterion } from './flows/ThroughCriterion.js';
import { LabelClashCriterion } from './labels/LabelClashCriterion.js';
import { LabelOnLineCriterion } from './labels/LabelOnLineCriterion.js';
import { LabelOutsideFrameCriterion } from './labels/LabelOutsideFrameCriterion.js';
import { LabelTitleCriterion } from './labels/LabelTitleCriterion.js';
import { MessageLabelCriterion } from './labels/MessageLabelCriterion.js';
import { LayoutScore } from './LayoutScore.js';
import { DrawnPlane, type PlaneDrawing } from './plane/DrawnPlane.js';
import { ElementHomes } from './plane/ElementHomes.js';
import { ProblemReport } from './plane/ProblemReport.js';
import type { ScoringCriterion } from './plane/ScoringCriterion.js';
import { ContainmentCriterion } from './shapes/ContainmentCriterion.js';
import { FrameIntrusionCriterion } from './shapes/FrameIntrusionCriterion.js';
import { FrameOverlapCriterion } from './shapes/FrameOverlapCriterion.js';
import { LaneGapCriterion } from './shapes/LaneGapCriterion.js';
import { MissingCriterion } from './shapes/MissingCriterion.js';
import { OverlapCriterion } from './shapes/OverlapCriterion.js';

export class Scorer {
  static readonly CRITERIA: readonly ScoringCriterion[] = [
    new OverlapCriterion(),
    new MissingCriterion(),
    new ContainmentCriterion(),
    new LaneGapCriterion(),
    new FrameIntrusionCriterion(),
    new FrameOverlapCriterion(),
    new DiagonalCriterion(),
    new ThroughCriterion(),
    new CrossingCriterion(),
    new ParallelRunCriterion(),
    new InOutCriterion(),
    new FlowBoundsCriterion(),
    new MessageThroughPoolCriterion(),
    new DegenerateEdgeCriterion(),
    new DetachedEdgeCriterion(),
    new BackwardFlowCriterion(),
    new SegmentOverlapCriterion(),
    new LabelClashCriterion(),
    new LabelOnLineCriterion(),
    new LabelOutsideFrameCriterion(),
    new LabelTitleCriterion(),
    new MessageLabelCriterion(),
  ];

  constructor(private readonly criteria = Scorer.CRITERIA) {}

  score(document: BpmnDocument): LayoutScore {
    const report = new ProblemReport();
    const importWarnings = document.importWarnings.length;
    if (importWarnings) {
      const message = `import warnings: ${importWarnings}`;
      report.add('failed', message, [], message);
    }
    return this.judge(DrawnPlane.read(document), new ElementHomes(document), report);
  }

  scoreDrawing(drawings: readonly PlaneDrawing[], homes: ElementHomes): LayoutScore {
    return this.judge(drawings, homes, new ProblemReport());
  }

  private judge(drawings: readonly PlaneDrawing[], homes: ElementHomes, report: ProblemReport): LayoutScore {
    for (const plane of DrawnPlane.of(drawings, homes)) {
      for (const criterion of this.criteria) {
        criterion.run(plane, report);
      }
    }
    return new LayoutScore(report.problems());
  }
}
