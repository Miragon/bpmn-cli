import type { Snapshot } from './Snapshot.js';
import type { IncrementalLayout } from './IncrementalLayout.js';
import { LayoutDebug } from '../shared/LayoutDebug.js';
import { is, type El } from '../model/utils/moddle.js';
import { cx, right } from '../diagram/utils/geom.js';
import { idOf, raw, rawList } from '../diagram/utils/raw.js';
import { DiagramReader } from '../diagram/DiagramReader.js';
import type { DShape } from '../diagram/types.js';

/**
 * A join drawn before the ops that a new flow would enter backwards (no loop return) is placed
 * again right of its rightmost predecessor, before its one successor: a `connect` into a merge an
 * earlier command spliced draws what the batch adding both draws. Its DI is reused.
 */
export class JoinPuller {
  constructor(
    private readonly run: IncrementalLayout,
    private readonly snap: Snapshot,
  ) {}

  /** Only a gateway with 2+ incoming flows and one outgoing, all in its pool / sub-process. */
  pullJoins(): void {
    const before = new Set([...this.snap.flowEnds.keys()].map((id) => this.snap.currentId(id)));
    let next: Map<string, string[]> | undefined;
    const reaches = (from: string, to: string): boolean => {
      if (!next) {
        next = new Map();
        for (const el of this.run.sem.byId.values()) {
          const ends = is(el, 'bpmn:SequenceFlow') ? DiagramReader.edgeEnds(el) : is(el, 'bpmn:BoundaryEvent') ? { sourceId: idOf(raw(el, 'attachedToRef')), targetId: idOf(el) } : undefined;
          if (ends?.sourceId && ends.targetId) next.set(ends.sourceId, [...(next.get(ends.sourceId) ?? []), ends.targetId]);
        }
      }
      const seen = new Set([from]);
      const stack = [from];
      while (stack.length) {
        for (const n of next.get(stack.pop()!) ?? []) {
          if (n === to) return true;
          if (seen.has(n)) continue;
          seen.add(n);
          stack.push(n);
        }
      }
      return false;
    };
    const seqFlows = (el: El | undefined, prop: 'incoming' | 'outgoing'): El[] => rawList(el, prop).filter((f) => is(f, 'bpmn:SequenceFlow'));
    for (const el of this.run.sem.byId.values()) {
      const fid = idOf(el);
      if (!fid || !is(el, 'bpmn:SequenceFlow') || (before.has(fid) && !this.run.place.oldTarget.has(fid))) continue;
      const { sourceId, targetId } = DiagramReader.edgeEnds(el);
      const plane = this.run.planes.find((p) => !!targetId && p.shapes.has(targetId));
      const join = targetId ? plane?.shapes.get(targetId) : undefined;
      const source = sourceId ? plane?.shapes.get(sourceId) : undefined;
      if (!plane || !join || !source || !join.di || !this.snap.byDi.has(join.di) || this.run.relocated.has(join.id) || this.run.place.joins?.has(join.id)) continue;
      if (!is(join.el, 'bpmn:Gateway') || cx(join.bounds) >= source.bounds.x) continue;
      const ins = seqFlows(join.el, 'incoming');
      const outs = seqFlows(join.el, 'outgoing');
      const S = outs.length === 1 ? plane.shapes.get(idOf(raw(outs[0], 'targetRef')) ?? '') : undefined;
      if (ins.length < 2 || !S || reaches(join.id, source.id)) continue;
      const preds = ins.map((f) => plane.shapes.get(idOf(raw(f, 'sourceRef')) ?? ''));
      const sameFrame = (s: DShape | undefined): boolean => !!s && s.poolId === join.poolId && s.parentId === join.parentId;
      if (!preds.every(sameFrame) || !sameFrame(S) || S.bounds.x <= Math.max(...preds.map((p) => right(p!.bounds)))) continue;
      plane.shapes.delete(join.id);
      this.run.place.reuse.set(join.id, { shape: join, boundaries: [], from: plane });
      (this.run.place.joins ??= new Map()).set(join.id, S.id);
      this.run.relocated.add(join.id);
      for (const e of plane.edges.values()) if (e.sourceId === join.id || e.targetId === join.id) this.run.reroute.add(e.id);
      if (LayoutDebug.on()) LayoutDebug.log(`[join] ${join.id}: ${fid} from ${source.id} would enter it backwards: placed again before ${S.id}`);
    }
  }
}
