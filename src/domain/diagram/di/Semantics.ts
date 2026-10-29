import { is, type El } from '../../document/utils/moddle.js';
import type { Plane } from './types.js';
import { SUB_PROCESS_TYPES } from '../utils/expansion.js';
import { idOf, raw, rawList, rawTree } from '../utils/raw.js';

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
    for (const artifact of rawList(scope, 'artifacts')) {
      const id = idOf(artifact);
      if (id) this.scopeOf.set(id, scope);
    }
  }

  /** Indexes lanes recursively; deeper lanes are visited later, so a node belongs to its deepest lane. */
  private indexLanes(lanes: El[], process: El, parent: El | undefined): void {
    for (const lane of lanes) {
      const id = idOf(lane);
      if (!id) continue;
      this.laneProcess.set(id, idOf(process)!);
      if (parent) this.laneParent.set(id, idOf(parent)!);
      for (const node of rawList(lane, 'flowNodeRef')) {
        const nid = idOf(node);
        if (nid) this.laneOf.set(nid, id);
      }
      const child = raw<El>(lane, 'childLaneSet');
      if (child) this.indexLanes(rawList(child, 'lanes'), process, lane);
    }
  }

  private static indexAll(root: El, byId: Map<string, El>): void {
    for (const el of rawTree(root, (candidate) => /^(bpmndi|dc|di):/.test(candidate.$type))) {
      const id = idOf(el);
      if (id) byId.set(id, el);
    }
  }

  static isSubProcess(el: El): boolean {
    return SUB_PROCESS_TYPES.some((type) => is(el, type));
  }

  static sequenceFlows(el: El | undefined, prop: 'incoming' | 'outgoing'): El[] {
    return rawList(el, prop).filter((flow) => is(flow, 'bpmn:SequenceFlow'));
  }

  static of(defs: El): Semantics {
    const sem = new Semantics();
    Semantics.indexAll(defs, sem.byId);
    for (const root of rawList(defs, 'rootElements')) {
      if (is(root, 'bpmn:Process')) {
        sem.indexScope(root);
        for (const ls of rawList(root, 'laneSets')) {
          sem.indexLanes(rawList(ls, 'lanes'), root, undefined);
        }
      } else if (is(root, 'bpmn:Collaboration')) {
        sem.collaboration ??= root;
        for (const participant of rawList(root, 'participants')) {
          const pid = idOf(raw(participant, 'processRef'));
          if (pid && idOf(participant)) sem.poolOfProcess.set(pid, idOf(participant)!);
        }
        for (const artifact of rawList(root, 'artifacts')) {
          const id = idOf(artifact);
          if (id) sem.scopeOf.set(id, root);
        }
      }
    }
    return sem;
  }

  processOf(id: string): El | undefined {
    let scope = this.scopeOf.get(id);
    while (scope && !is(scope, 'bpmn:Process')) {
      scope = this.scopeOf.get(idOf(scope) ?? '');
    }
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
    const collabPlane = (): Plane | undefined => (this.collaboration ? planes.find((plane) => plane.rootId === idOf(this.collaboration)) : undefined);
    if (is(el, 'bpmn:Participant') || is(el, 'bpmn:MessageFlow')) {
      return collabPlane();
    }
    if (is(el, 'bpmn:Lane')) {
      const pid = this.laneProcess.get(id);
      return planes.find((plane) => plane.rootId === pid) ?? (pid && this.poolOfProcess.has(pid) ? collabPlane() : undefined);
    }
    const anchorId = is(el, 'bpmn:DataAssociation') ? idOf(el.$parent) : id;
    const scope = anchorId ? this.scopeOf.get(anchorId) : undefined;
    const sid = idOf(scope);
    if (!scope || !sid) return undefined;
    if (is(scope, 'bpmn:Collaboration')) return collabPlane();
    if (Semantics.isSubProcess(scope)) {
      const expandedOn = planes.find((plane) => plane.shapes.get(sid)?.expanded);
      if (expandedOn) return expandedOn;
      return planes.find((plane) => plane.rootId === sid);
    }
    return planes.find((plane) => plane.rootId === sid) ?? (this.poolOfProcess.has(sid) ? collabPlane() : undefined);
  }

  predecessors(id: string): string[] {
    return Semantics.sequenceFlows(this.byId.get(id), 'incoming')
      .map((flow) => idOf(raw(flow, 'sourceRef')))
      .filter((sourceId): sourceId is string => !!sourceId);
  }

  successors(id: string): string[] {
    return Semantics.sequenceFlows(this.byId.get(id), 'outgoing')
      .map((flow) => idOf(raw(flow, 'targetRef')))
      .filter((targetId): targetId is string => !!targetId);
  }
}
