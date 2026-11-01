import type { GNode, ScopeLayout } from '../scopes/GNode.js';
import { ArrangementTrial, type Routes } from './ArrangementTrial.js';
import { JoinMove } from './JoinMove.js';
import { TakenColumns, type Columns } from './TakenColumns.js';

export class JoinColumnTrial extends ArrangementTrial {
  private readonly shifts = new Map<GNode, number>();
  private readonly tried = new Set<GNode>();
  private readonly columns: TakenColumns;

  constructor(
    layout: ScopeLayout,
    private readonly arrange: (shifts: ReadonlyMap<GNode, number>) => void,
  ) {
    super(layout);
    this.columns = new TakenColumns(layout);
  }

  run(): void {
    let routed: Routes | undefined;
    let taken: Columns | undefined;
    for (;;) {
      taken ??= this.columns.of();
      const candidate = this.nextCandidate(taken);
      if (!candidate) {
        return;
      }
      this.tried.add(candidate);
      routed ??= this.routesOf();
      if (this.needsItsColumn(candidate, routed)) {
        const moved = this.move(candidate, taken, routed);
        routed = moved?.routes ?? routed;
        taken = moved?.taken ?? taken;
      }
    }
  }

  private nextCandidate(blocked: Columns): GNode | undefined {
    const open = this.layout.nodes.filter((node) => blocked.has(node) && !this.tried.has(node));
    return open.find((node) => node.entriesFromBelow().length) ?? open[0];
  }

  private needsItsColumn(candidate: GNode, { above }: Routes): boolean {
    return !above.size || this.columns.of(above).has(candidate);
  }

  private move(candidate: GNode, blocked: Columns, before: Routes): { routes: Routes; taken: Columns } | undefined {
    const { layout, arrange, shifts } = this;
    return new JoinMove({ layout, arrange, shifts, route: () => this.routesOf() }, candidate, blocked, before).attempt();
  }
}
