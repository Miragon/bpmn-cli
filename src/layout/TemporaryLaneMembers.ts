import { addTo, is, many, processes, removeFrom, walk, type El, idOf } from '../model/utils/moddle.js';

interface TempMember {
  laneId: string;
  nodeId: string;
}

export class TemporaryLaneMembers {
  private constructor(private readonly members: TempMember[]) {}

  get count(): number {
    return this.members.length;
  }

  private static allLanes(process: El): El[] {
    const out: El[] = [];
    const visit = (laneSet: El | undefined): void => {
      if (!laneSet) return;
      for (const lane of many(laneSet, 'lanes')) {
        out.push(lane);
        visit(lane.get<El | undefined>('childLaneSet'));
      }
    };
    for (const ls of many(process, 'laneSets')) visit(ls);
    return out;
  }

  private static isLeafLane(lane: El): boolean {
    const child = lane.get<El | undefined>('childLaneSet');
    return !child || many(child, 'lanes').length === 0;
  }

  /** The lane a laneless node is drawn in: that of a connected neighbour, else the first leaf lane. */
  private static laneForLayout(node: El, laneOfNode: Map<El, El>, leafLanes: El[]): El | undefined {
    const neighbours: El[] = [];
    const host = node.get<El | undefined>('attachedToRef');
    if (host) neighbours.push(host);
    for (const f of node.get<El[] | undefined>('incoming') ?? []) {
      const src = f.get<El | undefined>('sourceRef');
      if (src) neighbours.push(src);
    }
    for (const f of node.get<El[] | undefined>('outgoing') ?? []) {
      const tgt = f.get<El | undefined>('targetRef');
      if (tgt) neighbours.push(tgt);
    }
    for (const n of neighbours) {
      const lane = laneOfNode.get(n);
      if (lane && TemporaryLaneMembers.isLeafLane(lane)) return lane;
    }
    return leafLanes[0];
  }

  /**
   * Puts every top-level flow node of a lane-partitioned process that is in no
   * lane into one, for the layout only. Returns what was added so it can be
   * stripped from the result again.
   */
  static add(defs: El): TemporaryLaneMembers {
    const added: TempMember[] = [];
    for (const process of processes(defs)) {
      const lanes = TemporaryLaneMembers.allLanes(process);
      if (!lanes.length) continue;
      const leafLanes = lanes.filter(TemporaryLaneMembers.isLeafLane);
      if (!leafLanes.length) continue;
      const laneOfNode = new Map<El, El>();
      for (const lane of lanes) for (const n of lane.get<El[] | undefined>('flowNodeRef') ?? []) laneOfNode.set(n, lane);
      for (const node of many(process, 'flowElements')) {
        if (!is(node, 'bpmn:FlowNode') || laneOfNode.has(node) || !node.get('id')) continue;
        const lane = TemporaryLaneMembers.laneForLayout(node, laneOfNode, leafLanes);
        if (!lane) continue;
        addTo(lane, 'flowNodeRef', node);
        laneOfNode.set(node, lane);
        added.push({ laneId: idOf(lane), nodeId: idOf(node) });
      }
    }
    return new TemporaryLaneMembers(added);
  }

  withdraw(defs: El): void {
    if (!this.members.length) return;
    const byId = new Map<string, El>();
    for (const el of walk(defs)) {
      const id = el.get<string | undefined>('id');
      if (id) byId.set(id, el);
    }
    for (const { laneId, nodeId } of this.members) {
      const lane = byId.get(laneId);
      const node = byId.get(nodeId);
      if (lane && node) removeFrom(lane, 'flowNodeRef', node);
    }
  }
}
