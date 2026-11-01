import { ProblemKinds, type ProblemKind } from './ProblemKinds.js';

export type ProblemLocation = { plane: string; x: number; y: number };

export interface LayoutProblem {
  kind: ProblemKind;
  ids: string[];
  detail?: string;
  at?: ProblemLocation;
}

export class ProblemReport {
  static readonly LABEL_ON_LABEL = 'label on label';

  private readonly found = ProblemKinds.perKind(() => new Map<string, LayoutProblem>());

  static identityOf({ kind, ids, detail }: LayoutProblem): string {
    const unordered = ProblemKinds.recordOf(kind).symmetric || (kind === 'labelClash' && detail === ProblemReport.LABEL_ON_LABEL);
    const shownIds = unordered ? [...ids].sort() : ids;
    const shownDetail = detail !== undefined && !ProblemKinds.recordOf(kind).measured ? `#${detail}` : '';
    return `${kind}:${shownIds.join(',')}${shownDetail}`;
  }

  add(kind: ProblemKind, key: string, ids: string[], detail?: string): void {
    if (!this.found[kind].has(key)) {
      this.found[kind].set(key, detail === undefined ? { kind, ids } : { kind, ids, detail });
    }
  }

  problems(): LayoutProblem[] {
    return ProblemKinds.ALL.flatMap((kind) => [...this.found[kind].values()]);
  }
}
