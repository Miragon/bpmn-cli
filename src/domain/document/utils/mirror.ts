/**
 * BPMN 2.0 makes `incoming` / `outgoing` optional mirrors of each flow's sourceRef / targetRef.
 * They are complete in memory, but a file keeps them only the way it kept them before:
 * a file that never listed them never gets them, a Modeler file stays complete.
 */
import { addTo, indexById, is, parseXml, serialize, walk, type El, type Model } from './moddle.js';

type Direction = 'incoming' | 'outgoing';

const DIRECTIONS: readonly Direction[] = ['incoming', 'outgoing'];

export interface MirrorSnapshot {
  /** the flow nodes that listed at least one entry */
  listed: Map<El, { incoming: Set<El>; outgoing: Set<El> }>;
  ends: Map<El, readonly [unknown, unknown]>;
  connected: Set<El>;
}

export interface MirrorEntry {
  node: El;
  direction: Direction;
  flow: El;
}

const listOf = (node: El, direction: Direction): El[] => (node.get<El[] | undefined>(direction) ?? []);

/** Returns the number of entries added; entries that contradict a flow's ends are left alone. */
export function completeMirrorLists(definitions: El): number {
  let added = 0;
  const has = (node: El, direction: Direction, flow: El): boolean => {
    const flows = (node as unknown as Record<string, unknown>)[direction];
    return Array.isArray(flows) && flows.includes(flow);
  };
  for (const flow of walk(definitions)) {
    if (!is(flow, 'bpmn:SequenceFlow')) continue;
    const source = (flow as unknown as Record<string, El | undefined>)['sourceRef'];
    const target = (flow as unknown as Record<string, El | undefined>)['targetRef'];
    if (source && is(source, 'bpmn:FlowNode') && !has(source, 'outgoing', flow)) {
      addTo(source, 'outgoing', flow);
      added++;
    }
    if (target && is(target, 'bpmn:FlowNode') && !has(target, 'incoming', flow)) {
      addTo(target, 'incoming', flow);
      added++;
    }
  }
  return added;
}

export function takeMirrorSnapshot(definitions: El): MirrorSnapshot {
  const listed: MirrorSnapshot['listed'] = new Map();
  const ends: MirrorSnapshot['ends'] = new Map();
  const connected = new Set<El>();
  for (const el of walk(definitions, { bpmnOnly: true })) {
    if (is(el, 'bpmn:SequenceFlow')) {
      const source = el.get<El | undefined>('sourceRef');
      const target = el.get<El | undefined>('targetRef');
      ends.set(el, [source, target]);
      if (source) connected.add(source);
      if (target) connected.add(target);
    } else if (is(el, 'bpmn:FlowNode')) {
      const incoming = listOf(el, 'incoming');
      const outgoing = listOf(el, 'outgoing');
      if (incoming.length || outgoing.length) {
        listed.set(el, { incoming: new Set(incoming), outgoing: new Set(outgoing) });
      }
    }
  }
  return { listed, ends, connected };
}

/**
 * A node that listed entries keeps them plus those of new or re-ended flows; a connected node
 * without entries stays without; a new node follows the file.
 * A file without sequence flows shows no style: it gets the lists, like a new one.
 */
export function unkeptEntries(definitions: El, snapshot: MirrorSnapshot): MirrorEntry[] {
  const fileLists = snapshot.listed.size > 0 || snapshot.ends.size === 0;
  const changed = (flow: El): boolean => {
    const was = snapshot.ends.get(flow);
    return !was || was[0] !== flow.get('sourceRef') || was[1] !== flow.get('targetRef');
  };
  const out: MirrorEntry[] = [];
  for (const node of walk(definitions, { bpmnOnly: true })) {
    if (!is(node, 'bpmn:FlowNode')) continue;
    const had = snapshot.listed.get(node);
    const lists = !!had || (fileLists && !snapshot.connected.has(node));
    for (const direction of DIRECTIONS) {
      for (const flow of listOf(node, direction)) {
        if (lists && (had?.[direction].has(flow) || changed(flow))) continue;
        out.push({ node, direction, flow });
      }
    }
  }
  return out;
}

/** The entries are put back afterwards. */
export async function serializeWithout(model: Model, entries: MirrorEntry[]): Promise<string> {
  const removed: Array<{ list: El[]; index: number; flow: El }> = [];
  for (const entry of entries) {
    const list = listOf(entry.node, entry.direction);
    const index = list.indexOf(entry.flow);
    if (index < 0) continue;
    list.splice(index, 1);
    removed.push({ list, index, flow: entry.flow });
  }
  try {
    return await serialize(model);
  } finally {
    for (const removal of removed.reverse()) {
      removal.list.splice(removal.index, 0, removal.flow);
    }
  }
}

/** Matches by id: the final XML may come from another model instance (a redraw, the format ops). */
export async function withoutEntries(xml: string, entries: MirrorEntry[]): Promise<string> {
  const keys = new Set(entries.map((entry) => `${entry.node.get<string>('id')}\u0000${entry.direction}\u0000${entry.flow.get<string>('id')}`));
  const model = await parseXml(xml);
  let removed = 0;
  for (const [id, node] of indexById(model.definitions, { semanticOnly: true })) {
    if (!is(node, 'bpmn:FlowNode')) continue;
    for (const direction of DIRECTIONS) {
      const list = node.get<El[] | undefined>(direction);
      if (!list?.length) continue;
      for (let index = list.length - 1; index >= 0; index--) {
        if (!keys.has(`${id}\u0000${direction}\u0000${list[index]!.get<string>('id')}`)) {
          continue;
        }
        list.splice(index, 1);
        removed++;
      }
    }
  }
  return removed ? serialize(model) : xml;
}
