import { ElementHomes, ProblemKinds, ProblemReport, type LayoutProblem } from '../../../scoring/index.js';
import { TrialGuard, type TrialPolicy } from '../../plane/TrialGuard.js';
import type { LayoutRun } from './LayoutRun.js';

export class RepairGuard {
  private static readonly MAX_TRIALS = 8;
  private static readonly AMONG_DRAWN_LINES = 'crossings among drawn lines';

  private trials = 0;
  private guard: TrialGuard | undefined;

  constructor(private readonly run: LayoutRun) {}

  get exhausted(): boolean {
    return this.trials >= RepairGuard.MAX_TRIALS;
  }

  begin(): void {
    this.trials++;
    this.guard ??= new TrialGuard(this.run.planes, new ElementHomes(this.run.document), this.policy());
  }

  keeps(): boolean {
    return this.guard!.judge().ok;
  }

  private policy(): TrialPolicy {
    return { key: (problem) => this.keyOf(problem), lower: true, rebase: true };
  }

  private keyOf(problem: LayoutProblem): string | undefined {
    if (ProblemKinds.isHard(problem.kind)) {
      return ProblemReport.identityOf(problem);
    }
    return problem.kind === 'crossings' && problem.ids.every((id) => !this.run.newEdges.has(id)) ? RepairGuard.AMONG_DRAWN_LINES : undefined;
  }
}
