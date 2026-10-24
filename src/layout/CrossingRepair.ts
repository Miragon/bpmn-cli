import type { El } from '../model/utils/moddle.js';
import { LayoutDebug } from '../shared/LayoutDebug.js';
import { LayoutAnalysis } from '../diagram/LayoutAnalysis.js';
import { TrialGuard, type TrialPolicy } from '../diagram/TrialGuard.js';
import type { DEdge, Plane, Point } from '../diagram/types.js';
import { copyBox, polylinesCross, samePoints } from '../diagram/utils/geom.js';
import { predecessors, raw } from '../diagram/utils/plane.js';
import { isHardProblem, problemKey, type LayoutMetrics } from '../diagram/utils/problems.js';
import { writePlanes } from '../diagram/write.js';
import type { Checkpoint, IncrementalLayout } from './IncrementalLayout.js';

/** at most this many repair trials per write (a reroute or a chain placed again, each measured) */
const REPAIR_TRIALS = 8;

/** of them at most this many chains placed again (each draws the new elements again) */
const CHAIN_RETRIES = 2;

export class CrossingRepair {
  constructor(private readonly run: IncrementalLayout) {}

  /** Every crossing between a connection drawn in this run and an existing one: [new, existing, plane]. */
  private newCrossings(): Array<[DEdge, DEdge, Plane]> {
    const out: Array<[DEdge, DEdge, Plane]> = [];
    for (const plane of this.run.planes) {
      const fresh = [...plane.edges.values()].filter((e) => this.run.newEdges.has(e.id) && e.points.length >= 2);
      if (!fresh.length) continue;
      const kept = [...plane.edges.values()].filter((e) => !this.run.newEdges.has(e.id) && e.points.length >= 2);
      for (const n of fresh) for (const e of kept) if (polylinesCross(n.points, e.points)) out.push([n, e, plane]);
    }
    return out;
  }

  /** The ids of the shapes and connections of every plane (a chain placed again must draw the same elements). */
  private membersOf(): string {
    return this.run.planes.map((p) => `${p.rootId}:${[...p.shapes.keys()].sort().join(',')}|${[...p.edges.keys()].sort().join(',')}`).join(';');
  }

  /**
   * The DI the measurements created for the new elements of a drawing that is
   * replaced (by element id per plane), handed to the elements of the drawing
   * that replaces it: one DI element per element, never a second one.
   */
  private takeDi(): Map<string, El> {
    const out = new Map<string, El>();
    for (const p of this.run.planes) {
      for (const s of p.shapes.values()) if (s.di) out.set(`${p.rootId}|s|${s.id}`, s.di);
      for (const e of p.edges.values()) if (e.di) out.set(`${p.rootId}|e|${e.id}`, e.di);
    }
    return out;
  }

  private giveDi(di: ReadonlyMap<string, El>): void {
    for (const p of this.run.planes) {
      for (const x of [...p.shapes.values(), ...p.edges.values()]) {
        if (x.di) continue;
        const d = di.get(`${p.rootId}|${'points' in x ? 'e' : 's'}|${x.id}`);
        if (!d) continue;
        x.di = d;
        // a label the replaced drawing gave it and this one does not
        if (!x.label && raw(d, 'label')) d.set('label', undefined);
      }
    }
  }

  /**
   * The head of the chain a new connection belongs to: a node placed in this
   * run at the cheapest of several row candidates (a branch or exception path,
   * NodePlacer.heads), found back from the connection's ends through nodes
   * placed in this run.
   */
  private chainHead(from: readonly (string | undefined)[]): string | undefined {
    const heads = this.run.place.heads;
    if (!heads?.size) return undefined;
    const seen = new Set<string>();
    const queue = from.filter((x): x is string => !!x && this.run.place.placed.has(x));
    while (queue.length && seen.size < 30) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (heads.has(id)) return id;
      for (const p of predecessors(this.run.sem, id)) if (this.run.place.placed.has(p)) queue.push(p);
    }
    return undefined;
  }

  /**
   * Local repair after placement (issue #18 (3)), at most REPAIR_TRIALS trials
   * per write, for every crossing between a connection drawn in this run and
   * an existing one:
   *  1. the new connection is routed again with the whole drawing in place
   *     (the hand drawing stays as it is), else the existing one, with the new
   *     shapes as obstacles;
   *  2. a crossing left: the chain the new connection belongs to (a branch or
   *     exception path, NodePlacer.heads) starts at its next row candidate
   *     instead: the new elements are drawn again from the checkpoint taken
   *     before them (`start`, by `redraw`), at most CHAIN_RETRIES times.
   * A trial is kept only under the guard `compact` uses: it adds no hard layout
   * problem (nor a crossing between two connections drawn before this run) and
   * lowers the score (the drawing is measured after each trial, its
   * planes written to the DI first; a chain drawn again takes over the DI the
   * measurement created for the new elements). An existing connection kept
   * rerouted is reported in `rerouted` and in a note, a chain placed again in a
   * note.
   */
  async repair(rerouted: string[], start: Checkpoint, redraw: () => Promise<string[]>): Promise<string[]> {
    if (!this.newCrossings().length) return rerouted;
    let trials = 0;
    let retries = 0;
    let guard: TrialGuard | undefined;
    const measure = (): LayoutMetrics => {
      writePlanes(this.run.doc.moddle, this.run.doc.definitions, this.run.planes);
      return LayoutAnalysis.of(this.run.doc.definitions);
    };
    // what a trial must never add: a hard problem (counted per problem), or a crossing between two connections drawn
    // before this run (counted together: a reroute must not trade a crossing with a new connection for one among the
    // hand-drawn lines; a chain drawn again may cross another pair of them, not more)
    const DRAWN = 'crossings among drawn lines';
    const policy: TrialPolicy = { key: (p) => (isHardProblem(p) ? problemKey(p) : p.kind === 'crossings' && p.ids.every((id) => !this.run.newEdges.has(id)) ? DRAWN : undefined), lower: true, rebase: true };
    const ensureBase = (): void => {
      guard ??= new TrialGuard(measure, policy);
    };
    /** the guard: measures the drawing; true (and the new baseline) when it lowered the score and added nothing guarded */
    const judge = (what: string): boolean => {
      const v = guard!.judge();
      if (LayoutDebug.on()) LayoutDebug.log(`[repair] ${what}: score ${v.before} -> ${v.after}${v.addedKeys.length ? `, added ${v.addedKeys.join(' ')}` : ''}: ${v.ok ? 'kept' : 'undone'}`);
      return v.ok;
    };
    const reroutes = (list: string[]): void => {
      for (const [n, e, plane] of this.newCrossings()) {
        if (!polylinesCross(n.points, e.points)) continue;
        for (const target of [n, e]) {
          if (trials >= REPAIR_TRIALS) return;
          const drawing = this.run.drawing(plane);
          const pts = drawing.route(target, { lines: drawing.routingLines(target.id) });
          if (!pts || pts.length < 2 || samePoints(pts, target.points)) continue;
          // not measured: a route that still crosses the line it is tried for, or (an existing connection) that crosses
          // another drawn line it did not cross before (the guard would undo it)
          const other = target === n ? e : n;
          if (polylinesCross(pts, other.points) || (target === e && crossesNewDrawnLine(plane, target, pts))) {
            if (LayoutDebug.on()) LayoutDebug.log(`[repair] ${target.id} routed again (it crossed: ${n.id} x ${e.id}): still crossing, not measured`);
            continue;
          }
          trials++;
          ensureBase();
          const old = { points: target.points, label: target.label ? copyBox(target.label) : undefined };
          drawing.adoptRoute(target, pts);
          if (!judge(`${target.id} routed again (it crossed: ${n.id} x ${e.id})`)) {
            target.points = old.points;
            if (old.label) target.label = old.label;
            else delete target.label;
            continue;
          }
          if (target === e) {
            if (!list.includes(e.id)) list.push(e.id);
            this.run.notes.push(`${e.id} routed again: it crossed the new ${n.id}`);
          }
          break;
        }
      }
    };
    /** an existing connection's new route crosses a connection drawn before this run that its old route did not cross */
    const crossesNewDrawnLine = (plane: Plane, target: DEdge, pts: readonly Point[]): boolean =>
      [...plane.edges.values()].some((o) => o !== target && !this.run.newEdges.has(o.id) && o.points.length >= 2 && polylinesCross(pts, o.points) && !polylinesCross(target.points, o.points));
    reroutes(rerouted);
    // the next row candidate of a chain that still crosses
    const tried = new Map<string, number>();
    while (trials < REPAIR_TRIALS && retries < CHAIN_RETRIES && !this.run.fromEngine.size && this.run.planes.length === start.planes.length) {
      let next: { head: string; rank: number } | undefined;
      for (const [n] of this.newCrossings()) {
        const head = this.chainHead([n.targetId, n.sourceId]);
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
