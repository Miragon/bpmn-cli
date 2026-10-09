/**
 * The `incoming` / `outgoing` lists of flow nodes are derived data: BPMN 2.0
 * makes them optional mirrors of each sequence flow's sourceRef / targetRef.
 * The CLI completes them in memory when it reads a document (Doc.fromXml,
 * after recording them as read; validate.ts repairFlowLinks does the same for
 * a model changed in memory), because the placement grammar, the views, the
 * lint and the layout read them. A file keeps them only the way it kept them
 * before:
 *
 *  - a node that listed entries when the file was read keeps its entries and
 *    gets the ones of new flows and of flows whose source or target changed;
 *    entries the repair added for flows that did not change are not written;
 *  - a node without entries that a sequence flow touched when the file was
 *    read stays without entries;
 *  - a new node (or one no flow touched) gets entries for its new and changed
 *    flows when some node of the file listed entries or the file had no
 *    sequence flow yet (nothing to tell its style by), else none.
 *
 * A file that never lists them (generated or hand-written models) therefore
 * never gets them, and a Modeler file (every node lists them) stays complete.
 * A document created by the CLI (`new`) has no snapshot: every entry the ops
 * maintain is written, like the Modeler does.
 */
import { addTo, indexById, is, parseXml, serialize, walk, type El, type Model } from './model.js';

type Direction = 'incoming' | 'outgoing';

const DIRECTIONS: readonly Direction[] = ['incoming', 'outgoing'];

/** What the mirror lists looked like when the document was read. */
export interface MirrorSnapshot {
  /** the flow nodes that listed at least one entry, with their entries */
  listed: Map<El, { incoming: Set<El>; outgoing: Set<El> }>;
  /** the source and target of every sequence flow */
  ends: Map<El, readonly [unknown, unknown]>;
  /** the flow nodes a sequence flow started or ended at */
  connected: Set<El>;
}

/** An entry of a node's incoming / outgoing list. */
export interface MirrorEntry {
  node: El;
  direction: Direction;
  flow: El;
}

const listOf = (node: El, direction: Direction): El[] => (node.get<El[] | undefined>(direction) ?? []);

/**
 * Adds every sequence flow to `sourceRef.outgoing` / `targetRef.incoming`
 * where it is missing (in memory: what is written decides unkeptEntries).
 * Idempotent; returns the number of entries added. Entries that contradict a
 * flow's endpoints are left alone (validate.ts reports them as E_FLOW_LINKS).
 */
export function completeMirrorLists(definitions: El): number {
  let added = 0;
  const has = (node: El, direction: Direction, flow: El): boolean => {
    const v = (node as unknown as Record<string, unknown>)[direction];
    return Array.isArray(v) && v.includes(flow);
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

/** Records the mirror lists of a document as read (before any repair). */
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
      if (incoming.length || outgoing.length) listed.set(el, { incoming: new Set(incoming), outgoing: new Set(outgoing) });
    }
  }
  return { listed, ends, connected };
}

/** The entries of the document that the file does not keep (see the module header). */
export function unkeptEntries(definitions: El, snapshot: MirrorSnapshot): MirrorEntry[] {
  // a file without sequence flows shows no style: it gets the lists, like a new one
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

/** Serialises a model without the given entries (they are put back afterwards). */
export async function serializeWithout(model: Model, entries: MirrorEntry[]): Promise<string> {
  const removed: Array<{ list: El[]; index: number; flow: El }> = [];
  for (const e of entries) {
    const list = listOf(e.node, e.direction);
    const index = list.indexOf(e.flow);
    if (index < 0) continue;
    list.splice(index, 1);
    removed.push({ list, index, flow: e.flow });
  }
  try {
    return await serialize(model);
  } finally {
    for (const r of removed.reverse()) r.list.splice(r.index, 0, r.flow);
  }
}

/**
 * Removes the given entries (by the ids of node and flow) from a serialised
 * model: the final XML of a mutation may come from another model instance
 * than the document (a redraw, the format ops), with the same ids.
 */
export async function withoutEntries(xml: string, entries: MirrorEntry[]): Promise<string> {
  const keys = new Set(entries.map((e) => `${e.node.get<string>('id')}\u0000${e.direction}\u0000${e.flow.get<string>('id')}`));
  const model = await parseXml(xml);
  let removed = 0;
  for (const [id, node] of indexById(model.definitions, { semanticOnly: true })) {
    if (!is(node, 'bpmn:FlowNode')) continue;
    for (const direction of DIRECTIONS) {
      const list = node.get<El[] | undefined>(direction);
      if (!list?.length) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        if (!keys.has(`${id}\u0000${direction}\u0000${list[i]!.get<string>('id')}`)) continue;
        list.splice(i, 1);
        removed++;
      }
    }
  }
  return removed ? serialize(model) : xml;
}
