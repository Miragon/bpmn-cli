import type { BpmnElement } from './BpmnElement.js';
import { ElementWalk } from './ElementWalk.js';

type Direction = 'incoming' | 'outgoing';

export interface MirrorSnapshot {
  listed: Map<BpmnElement, { incoming: Set<BpmnElement>; outgoing: Set<BpmnElement> }>;
  ends: Map<BpmnElement, readonly [unknown, unknown]>;
  connected: Set<BpmnElement>;
}

export interface MirrorEntry {
  node: BpmnElement;
  direction: Direction;
  flow: BpmnElement;
}

export class MirrorLists {
  private static readonly DIRECTIONS: readonly Direction[] = ['incoming', 'outgoing'];

  constructor(private readonly definitions: BpmnElement) {}

  private static isChanged(flow: BpmnElement, snapshot: MirrorSnapshot): boolean {
    const was = snapshot.ends.get(flow);
    return !was || was[0] !== flow.get('sourceRef') || was[1] !== flow.get('targetRef');
  }

  complete(): number {
    let added = 0;
    const completed = (node: BpmnElement | undefined, direction: Direction, flow: BpmnElement): void => {
      if (node?.is('bpmn:FlowNode') && !node.list(direction).includes(flow)) {
        node.add(direction, flow);
        added++;
      }
    };
    for (const flow of new ElementWalk(this.definitions).depthFirst()) {
      if (flow.is('bpmn:SequenceFlow')) {
        completed(flow.peek<BpmnElement>('sourceRef'), 'outgoing', flow);
        completed(flow.peek<BpmnElement>('targetRef'), 'incoming', flow);
      }
    }
    return added;
  }

  snapshot(): MirrorSnapshot {
    const snapshot: MirrorSnapshot = { listed: new Map(), ends: new Map(), connected: new Set() };
    for (const element of new ElementWalk(this.definitions).depthFirst({ bpmnOnly: true })) {
      if (element.is('bpmn:SequenceFlow')) {
        MirrorLists.recordFlow(element, snapshot);
      } else if (element.is('bpmn:FlowNode')) {
        MirrorLists.recordNode(element, snapshot);
      }
    }
    return snapshot;
  }

  unkept(snapshot: MirrorSnapshot): MirrorEntry[] {
    const fileLists = snapshot.listed.size > 0 || snapshot.ends.size === 0;
    const entries: MirrorEntry[] = [];
    for (const node of new ElementWalk(this.definitions).depthFirst({ bpmnOnly: true })) {
      if (node.is('bpmn:FlowNode')) {
        entries.push(...MirrorLists.unkeptOf(node, snapshot, fileLists));
      }
    }
    return entries;
  }

  async without<TResult>(entries: readonly MirrorEntry[], read: () => Promise<TResult>): Promise<TResult> {
    const removed: Array<{ entry: MirrorEntry; index: number }> = [];
    for (const entry of entries) {
      const index = entry.node.list(entry.direction).indexOf(entry.flow);
      if (index >= 0) {
        entry.node.remove(entry.direction, entry.flow);
        removed.push({ entry, index });
      }
    }
    try {
      return await read();
    } finally {
      for (const { entry, index } of removed.reverse()) {
        entry.node.insert(entry.direction, index, entry.flow);
      }
    }
  }

  private static recordFlow(flow: BpmnElement, snapshot: MirrorSnapshot): void {
    const source = flow.get<BpmnElement | undefined>('sourceRef');
    const target = flow.get<BpmnElement | undefined>('targetRef');
    snapshot.ends.set(flow, [source, target]);
    for (const end of [source, target]) {
      if (end) {
        snapshot.connected.add(end);
      }
    }
  }

  private static recordNode(node: BpmnElement, snapshot: MirrorSnapshot): void {
    const incoming = node.list('incoming');
    const outgoing = node.list('outgoing');
    if (incoming.length || outgoing.length) {
      snapshot.listed.set(node, { incoming: new Set(incoming), outgoing: new Set(outgoing) });
    }
  }

  private static unkeptOf(node: BpmnElement, snapshot: MirrorSnapshot, fileLists: boolean): MirrorEntry[] {
    const had = snapshot.listed.get(node);
    const lists = !!had || (fileLists && !snapshot.connected.has(node));
    return MirrorLists.DIRECTIONS.flatMap((direction) =>
      node
        .list(direction)
        .filter((flow) => !lists || !(had?.[direction].has(flow) || MirrorLists.isChanged(flow, snapshot)))
        .map((flow) => ({ node, direction, flow })),
    );
  }
}
