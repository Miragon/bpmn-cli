import type { DrawnPlane } from '../../model/index.js';
import type { ProblemKind } from './ProblemKinds.js';
import type { ProblemReport } from './ProblemReport.js';

export abstract class ScoringCriterion {
  abstract readonly kinds: readonly ProblemKind[];

  abstract run(plane: DrawnPlane, report: ProblemReport): void;
}
