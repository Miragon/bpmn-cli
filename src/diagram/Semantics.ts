import { is, type El } from '../model/utils/moddle.js';
import type { Plane } from './types.js';
import { SUB_PROCESS_TYPES } from './utils/expansion.js';
import { idOf, raw, rawList } from './utils/raw.js';

/** The semantic model a drawing is read against: elements by id, lanes, pools, scopes, flows. */
export class Semantics {
  readonly byId = new Map<string, El>();
  readonly laneOf = new Map<string, string>();
  readonly laneParent = new Map<string, string>();
  readonly laneProcess = new Map<string, string>();
  readonly poolOfProcess = new Map<string, string>();
  readonly scopeOf = new Map<string, El>();
  collaboration?: El;

  private constructor() {}

  private indexScope(scope: El): void {
    for (const fe of rawList(scope, 'flowElements')) {
      const id = idOf(fe);
      if (id) this.scopeOf.set(id, scope);
      if (Semantics.isSubProcess(fe)) this.indexScope(fe);
    }
    for (const a of rawList(scope, 'artifacts')) {
      const id = idOf(a);
      if (id) this.scopeOf.set(id, scope);
    }
  }

  private indexLanes(lanes: El[], process: El, parent: El | undefined): void {
    for (const lane of lanes) {
      const id = idOf(lane);
      if (!id) continue;
      this.laneProcess.set(id, idOf(process)!);
      if (parent) this.laneParent.set(id, idOf(parent)!);
      for (const node of rawList(lane, 'flowNodeRef')) {
        const nid = idOf(node);
        if (nid) this.laneOf.set(nid, id); // deeper lanes are visited later and win
      }
      const child = raw<El>(lane, 'childLaneSet');
      if (child) this.indexLanes(rawList(child, 'lanes'), process, lane);
    }
  }

  private static indexAll(root: El, byId: Map<string, El>): void {
    const stack: El[] = [root];
    const seen = new Set<El>();
    while (stack.length) {
      const el = stack.pop()!;
      if (seen.has(el)) continue;
      seen.add(el);
      if (/^(bpmndi|dc|di):/.test(el.$type)) continue;
      const id = idOf(el);
      if (id) byId.set(id, el);
      const descriptor = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
      if (descriptor.isGeneric) continue;
      for (const p of descriptor.properties ?? []) {
        if (p.isReference) continue;
        const v = raw<unknown>(el, p.name);
        if (Array.isArray(v)) {
          for (const c of v) if (c && typeof c === 'object' && '$type' in c) stack.push(c as El);
        } else if (v && typeof v === 'object' && '$type' in v) stack.push(v as El);
      }
    }
  }

  static isSubProcess(el: El): boolean {
    return SUB_PROCESS_TYPES.some((t) => is(el, t));
  }

  static sequenceFlows(el: El | undefined, prop: 'incoming' | 'outgoing'): El[] {
    return rawList(el, prop).filter((f) => is(f, 'bpmn:SequenceFlow'));
  }

  static of(defs: El): Semantics {
    const sem = new Semantics();
    Semantics.indexAll(defs, sem.byId);
    for (const root of rawList(defs, 'rootElements')) {
      if (is(root, 'bpmn:Process')) {
        sem.indexScope(root);
        for (const ls of rawList(root, 'laneSets')) sem.indexLanes(rawList(ls, 'lanes'), root, undefined);
      } else if (is(root, 'bpmn:Collaboration')) {
        sem.collaboration ??= root;
        for (const p of rawList(root, 'participants')) {
          const pid = idOf(raw(p, 'processRef'));
          if (pid && idOf(p)) sem.poolOfProcess.set(pid, idOf(p)!);
        }
        for (const a of rawList(root, 'artifacts')) {
          const id = idOf(a);
          if (id) sem.scopeOf.set(id, root);
        }
      }
    }
    return sem;
  }

  processOf(id: string): El | undefined {
    let scope = this.scopeOf.get(id);
    while (scope && !is(scope, 'bpmn:Process')) scope = this.scopeOf.get(idOf(scope) ?? '');
    return scope;
  }

  poolOf(id: string): string | undefined {
    const el = this.byId.get(id);
    if (!el) return undefined;
    if (is(el, 'bpmn:Participant')) return undefined;
    if (is(el, 'bpmn:Lane')) {
      const pid = this.laneProcess.get(id);
      return pid ? this.poolOfProcess.get(pid) : undefined;
    }
    const proc = this.processOf(id);
    return proc ? this.poolOfProcess.get(idOf(proc) ?? '') : undefined;
  }

  /** A collapsed parent has its own plane; undefined when that plane does not exist yet. */
  homePlane(planes: readonly Plane[], id: string): Plane | undefined {
    const el = this.byId.get(id);
    if (!el) return undefined;
    const collabPlane = (): Plane | undefined => (this.collaboration ? planes.find((p) => p.rootId === idOf(this.collaboration)) : undefined);
    if (is(el, 'bpmn:Participant') || is(el, 'bpmn:MessageFlow')) return collabPlane();
    if (is(el, 'bpmn:Lane')) {
      const pid = this.laneProcess.get(id);
      return planes.find((p) => p.rootId === pid) ?? (pid && this.poolOfProcess.has(pid) ? collabPlane() : undefined);
    }
    const anchorId = is(el, 'bpmn:DataAssociation') ? idOf(el.$parent) : id;
    const scope = anchorId ? this.scopeOf.get(anchorId) : undefined;
    const sid = idOf(scope);
    if (!scope || !sid) return undefined;
    if (is(scope, 'bpmn:Collaboration')) return collabPlane();
    if (Semantics.isSubProcess(scope)) {
      const expandedOn = planes.find((p) => p.shapes.get(sid)?.expanded);
      if (expandedOn) return expandedOn;
      return planes.find((p) => p.rootId === sid);
    }
    return planes.find((p) => p.rootId === sid) ?? (this.poolOfProcess.has(sid) ? collabPlane() : undefined);
  }

  predecessors(id: string): string[] {
    return Semantics.sequenceFlows(this.byId.get(id), 'incoming')
      .map((f) => idOf(raw(f, 'sourceRef')))
      .filter((x): x is string => !!x);
  }

  successors(id: string): string[] {
    return Semantics.sequenceFlows(this.byId.get(id), 'outgoing')
      .map((f) => idOf(raw(f, 'targetRef')))
      .filter((x): x is string => !!x);
  }
}
