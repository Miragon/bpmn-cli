import type { El } from '../../../document/utils/moddle.js';
import { LayoutDebug } from '../LayoutDebug.js';
import { LayoutAnalysis } from '../../di/LayoutAnalysis.js';
import { TrialGuard, type TrialPolicy } from '../../di/TrialGuard.js';
import type { DEdge, Plane, Point } from '../../di/types.js';
import { copyBox, polylinesCross, samePoints } from '../../utils/geom.js';
import { raw } from '../../utils/raw.js';
import { isHardProblem, problemKey, type LayoutMetrics } from '../../utils/problems.js';
import { PlaneWriter } from '../../di/PlaneWriter.js';
import type { Checkpoint, IncrementalLayout } from './IncrementalLayout.js';

/** repair trials per write; each one is measured */
const REPAIR_TRIALS = 8;

const CHAIN_RETRIES = 2;

/**
 * Removes crossings between connections drawn in this run and existing ones: first by rerouting,
 * then by placing the new chain at its next row candidate. A trial stays only when it lowers the
 * score and adds no hard problem and no crossing among the hand-drawn lines.
 */
export class CrossingRepair {
  constructor(private readonly run: IncrementalLayout) {}

  private newCrossings(): Array<[DEdge, DEdge, Plane]> {
    const out: Array<[DEdge, DEdge, Plane]> = [];
    for (const plane of this.run.planes) {
      const fresh = [...plane.edges.values()].filter((edge) => this.run.newEdges.has(edge.id) && edge.points.length >= 2);
      if (!fresh.length) continue;
      const kept = [...plane.edges.values()].filter((edge) => !this.run.newEdges.has(edge.id) && edge.points.length >= 2);
      for (const freshEdge of fresh) for (const edge of kept) if (polylinesCross(freshEdge.points, edge.points)) out.push([freshEdge, edge, plane]);
    }
    return out;
  }

  /** a chain placed again must draw the same elements */
  private membersOf(): string {
    return this.run.planes.map((plane) => `${plane.rootId}:${[...plane.shapes.keys()].sort().join(',')}|${[...plane.edges.keys()].sort().join(',')}`).join(';');
  }

  /** Hands the measured DI of a replaced drawing on, so no element gets a second DI element. */
  private takeDi(): Map<string, El> {
    const out = new Map<string, El>();
    for (const plane of this.run.planes) {
      for (const shape of plane.shapes.values()) if (shape.di) out.set(`${plane.rootId}|s|${shape.id}`, shape.di);
      for (const edge of plane.edges.values()) if (edge.di) out.set(`${plane.rootId}|e|${edge.id}`, edge.di);
    }
    return out;
  }

  /**
   * Gives elements without DI their old one back, dropping a label the replaced drawing gave it and
   * this one does not.
   */
  private giveDi(di: ReadonlyMap<string, El>): void {
    for (const plane of this.run.planes) {
      for (const element of [...plane.shapes.values(), ...plane.edges.values()]) {
        if (element.di) continue;
        const diagramElement = di.get(`${plane.rootId}|${'points' in element ? 'e' : 's'}|${element.id}`);
        if (!diagramElement) continue;
        element.di = diagramElement;
        if (!element.label && raw(diagramElement, 'label')) diagramElement.set('label', undefined);
      }
    }
  }

  /** A chain head is a node placed at the cheapest of several row candidates (NodePlacer.heads). */
  private chainHead(from: readonly (string | undefined)[]): string | undefined {
    const heads = this.run.place.heads;
    if (!heads?.size) return undefined;
    const seen = new Set<string>();
    const queue = from.filter((id): id is string => !!id && this.run.place.placed.has(id));
    while (queue.length && seen.size < 30) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (heads.has(id)) return id;
      for (const predecessor of this.run.sem.predecessors(id)) if (this.run.place.placed.has(predecessor)) queue.push(predecessor);
    }
    return undefined;
  }

  /** A route that still crosses is skipped without measuring, as the guard would reject it anyway. */
  async repair(rerouted: string[], start: Checkpoint, redraw: () => Promise<string[]>): Promise<string[]> {
    if (!this.newCrossings().length) return rerouted;
    let trials = 0;
    let retries = 0;
    let guard: TrialGuard | undefined;
    const measure = (): LayoutMetrics => {
      new PlaneWriter(this.run.doc.moddle, this.run.doc.definitions).write(this.run.planes);
      return LayoutAnalysis.of(this.run.doc.definitions);
    };
    /**
     * Old-line crossings are counted together: a reroute must not trade a crossing with a new
     * connection for one among the hand-drawn lines.
     */
    const DRAWN = 'crossings among drawn lines';
    const policy: TrialPolicy = { key: (problem) => (isHardProblem(problem) ? problemKey(problem) : problem.kind === 'crossings' && problem.ids.every((id) => !this.run.newEdges.has(id)) ? DRAWN : undefined), lower: true, rebase: true };
    const ensureBase = (): void => {
      guard ??= new TrialGuard(measure, policy);
    };
    const judge = (what: string): boolean => {
      const verdict = guard!.judge();
      if (LayoutDebug.on()) LayoutDebug.log(`[repair] ${what}: score ${verdict.before} -> ${verdict.after}${verdict.addedKeys.length ? `, added ${verdict.addedKeys.join(' ')}` : ''}: ${verdict.ok ? 'kept' : 'undone'}`);
      return verdict.ok;
    };
    const reroutes = (list: string[]): void => {
      for (const [freshEdge, keptEdge, plane] of this.newCrossings()) {
        if (!polylinesCross(freshEdge.points, keptEdge.points)) continue;
        for (const target of [freshEdge, keptEdge]) {
          if (trials >= REPAIR_TRIALS) return;
          const drawing = this.run.drawing(plane);
          const pts = drawing.route(target, { lines: drawing.routingLines(target.id) });
          if (!pts || pts.length < 2 || samePoints(pts, target.points)) continue;
          const other = target === freshEdge ? keptEdge : freshEdge;
          if (polylinesCross(pts, other.points) || (target === keptEdge && crossesNewDrawnLine(plane, target, pts))) {
            if (LayoutDebug.on()) LayoutDebug.log(`[repair] ${target.id} routed again (it crossed: ${freshEdge.id} x ${keptEdge.id}): still crossing, not measured`);
            continue;
          }
          trials++;
          ensureBase();
          const old = { points: target.points, label: target.label ? copyBox(target.label) : undefined };
          drawing.adoptRoute(target, pts);
          if (!judge(`${target.id} routed again (it crossed: ${freshEdge.id} x ${keptEdge.id})`)) {
            target.points = old.points;
            if (old.label) target.label = old.label;
            else delete target.label;
            continue;
          }
          if (target === keptEdge) {
            if (!list.includes(keptEdge.id)) list.push(keptEdge.id);
            this.run.notes.push(`${keptEdge.id} routed again: it crossed the new ${freshEdge.id}`);
          }
          break;
        }
      }
    };
    const crossesNewDrawnLine = (plane: Plane, target: DEdge, pts: readonly Point[]): boolean =>
      [...plane.edges.values()].some((other) => other !== target && !this.run.newEdges.has(other.id) && other.points.length >= 2 && polylinesCross(pts, other.points) && !polylinesCross(target.points, other.points));
    reroutes(rerouted);
    const tried = new Map<string, number>();
    while (trials < REPAIR_TRIALS && retries < CHAIN_RETRIES && !this.run.fromEngine.size && this.run.planes.length === start.planes.length) {
      let next: { head: string; rank: number } | undefined;
      for (const [freshEdge] of this.newCrossings()) {
        const head = this.chainHead([freshEdge.targetId, freshEdge.sourceId]);
        if (!head) continue;
        const rank = Math.max(this.run.place.skip?.get(head) ?? 0, tried.get(head) ?? 0) + 1;
        if (rank < (this.run.place.heads?.get(head) ?? 0)) {
          next = { head, rank };
          break;
        }
      }
      if (!next) break;
      trials++;
      retries++;
      tried.set(next.head, next.rank);
      ensureBase();
      const kept = this.run.checkpoint();
      const keptRerouted = [...rerouted];
      const members = this.membersOf();
      const di = this.takeDi();
      const skip = new Map(this.run.place.skip ?? []);
      skip.set(next.head, next.rank);
      this.run.restore(start);
      this.run.place.skip = skip;
      let again: string[] | undefined;
      try {
        again = await redraw();
      } catch {
        again = undefined;
      }
      if (!again || this.membersOf() !== members) {
        this.run.restore(kept);
        rerouted = keptRerouted;
        continue;
      }
      this.giveDi(di);
      if (!judge(`${next.head} at its row candidate ${next.rank + 1}`)) {
        this.run.restore(kept);
        rerouted = keptRerouted;
        continue;
      }
      rerouted = again;
      this.run.notes.push(`${next.head} placed at another row: at the first one its path crossed a line`);
      reroutes(rerouted);
    }
    return rerouted;
  }
}
