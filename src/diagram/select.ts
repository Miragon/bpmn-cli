/**
 * Selectors of the format ops: which elements `--path`, `--kind` and
 * `--branch` name, so an agent can colour the happy path, align every end
 * event or move a branch in one call (elements are always addressed by id).
 *
 * CONTRACT
 *  - pathOf(doc, from, to, via): the elements on a sequence-flow path from
 *    `from` to `to`, in path order (node, flow, node, ...): the shortest one
 *    (fewest flows), ties broken by the default flow of a node first, then
 *    the declaration order of its outgoing flows (the straight continuation
 *    of the drawing conventions). A host leads to its boundary events too
 *    (without a flow). `via` flows must lie on the path, in the given order:
 *    the path runs from `from` to the first via flow's source, over it, on
 *    to the next, and from the last one's target to `to`. E_NO_MATCH when
 *    there is no such path.
 *  - branchOf(doc, flowId, below): the branch a sequence flow starts: every
 *    node reachable from its target (sequence flows, host -> boundary event)
 *    that no other outgoing flow of the flow's source reaches, following
 *    only flows that run forward in the drawing (`below` says where a node
 *    is drawn: a flow whose target lies left of its source is a loop back
 *    and ends the walk), the source itself never; in walk order (breadth
 *    first), with the flows between them and the flows leaving them (into
 *    the join). E_NO_MATCH when nothing lies on it (the flow leads straight
 *    to the join).
 *  - kindOfElements(doc, kind): the elements of a kind (`find --kind`
 *    grammar: `endEvent`, `userTask`, `startEvent:message`, `sequenceFlow`,
 *    ...), in document order. E_NO_MATCH when there is none.
 *  - selection(doc, sel, drawn): explicit ids first, then the branch, the
 *    path and the kind, each in its own order, without repeats; with
 *    `shapesOnly` the connections are left out (place, align, tidy move
 *    shapes), and elements that are not drawn are left out of what the
 *    selectors found (explicit ids stay, the op reports them).
 */
import type { Doc } from '../document.js';
import { modelError, usageError } from '../errors.js';
import { is, type El } from '../model.js';
import { kindFilter } from '../view.js';

export interface Selection {
  ids?: string[];
  /** [from, to] */
  path?: string[];
  via?: string[];
  kind?: string;
  branch?: string;
}

const idOf = (el: El | undefined): string | undefined => el?.get<string | undefined>('id');

function noMatch(message: string, hint: string, element?: string): Error {
  return modelError('E_NO_MATCH', message, { ...(element ? { element } : {}), hint });
}

/** A node's next steps: its outgoing sequence flows (default first, then declared order) and its boundary events. */
function steps(doc: Doc, node: El): Array<{ flow?: El; to: El }> {
  const out = doc.outgoing(node);
  const def = node.get<El | undefined>('default');
  const ordered = def && out.includes(def) ? [def, ...out.filter((f) => f !== def)] : out;
  const flows = ordered.map((f) => ({ flow: f, to: f.get<El>('targetRef') })).filter((s) => !!s.to);
  const boundaries = is(node, 'bpmn:Activity') ? doc.boundaryEventsOf(node).map((b) => ({ to: b })) : [];
  return [...flows, ...boundaries];
}

/** Shortest walk from `a` to `b` (elements after `a`, `b` included), undefined when there is none. */
function shortest(doc: Doc, a: El, b: El): El[] | undefined {
  if (a === b) return [];
  const prev = new Map<El, { from: El; flow?: El }>();
  const queue = [a];
  const seen = new Set([a]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const s of steps(doc, cur)) {
      if (seen.has(s.to)) continue;
      seen.add(s.to);
      prev.set(s.to, { from: cur, ...(s.flow ? { flow: s.flow } : {}) });
      if (s.to === b) {
        const out: El[] = [];
        for (let n: El = b; n !== a; ) {
          const p = prev.get(n)!;
          out.unshift(n);
          if (p.flow) out.unshift(p.flow);
          n = p.from;
        }
        return out;
      }
      queue.push(s.to);
    }
  }
  return undefined;
}

/** The elements on a path (see module contract). */
export function pathOf(doc: Doc, fromId: string, toId: string, via: readonly string[] = []): El[] {
  const from = doc.require(fromId, 'bpmn:FlowNode', 'flow node');
  const to = doc.require(toId, 'bpmn:FlowNode', 'flow node');
  const out: El[] = [from];
  let cur = from;
  for (const fid of via) {
    const flow = doc.require(fid, 'bpmn:SequenceFlow', 'sequence flow');
    const leg = shortest(doc, cur, flow.get<El>('sourceRef'));
    if (!leg) throw noMatch(`No sequence-flow path leads from ${idOf(cur)} to ${fid}`, `Check the direction (--path <fromId> <toId>) and the order of --via; \`bpmn show <file>\` lists the flows of every node.`, fid);
    out.push(...leg, flow, flow.get<El>('targetRef'));
    cur = flow.get<El>('targetRef');
  }
  const last = shortest(doc, cur, to);
  if (!last) throw noMatch(`No sequence-flow path leads from ${idOf(cur)} to ${toId}`, `Check the direction (--path <fromId> <toId>)${via.length ? ' and the --via flows' : ''}; \`bpmn show <file>\` lists the flows of every node.`, toId);
  out.push(...last);
  return out.filter((el, i) => out.indexOf(el) === i);
}

/** Every node reachable from `start` along steps that `forward` allows. */
function reach(doc: Doc, start: El, stop: El, forward: (from: El, to: El) => boolean): El[] {
  const seen = new Set<El>([start]);
  const order = [start];
  for (let i = 0; i < order.length; i++) {
    for (const s of steps(doc, order[i]!)) {
      if (s.to === stop || seen.has(s.to) || !forward(order[i]!, s.to)) continue;
      seen.add(s.to);
      order.push(s.to);
    }
  }
  return order;
}

/** The branch a flow starts (see module contract); `centreX` gives a node's drawn centre (undefined: not drawn). */
export function branchOf(doc: Doc, flowId: string, centreX: (id: string) => number | undefined): El[] {
  const flow = doc.require(flowId, 'bpmn:SequenceFlow', 'sequence flow');
  const source = flow.get<El>('sourceRef');
  const target = flow.get<El>('targetRef');
  const forward = (a: El, b: El): boolean => {
    const xa = centreX(idOf(a) ?? '');
    const xb = centreX(idOf(b) ?? '');
    return xa === undefined || xb === undefined || xb >= xa - 1;
  };
  const mine = reach(doc, target, source, forward);
  const others = new Set(doc.outgoing(source).filter((f) => f !== flow).flatMap((f) => reach(doc, f.get<El>('targetRef'), source, forward)));
  const nodes = mine.filter((n) => !others.has(n));
  if (!nodes.length) {
    throw noMatch(`Nothing lies on the branch of ${flowId}: it leads to ${idOf(target)}, which the other branches of ${idOf(source)} reach too`, 'Name a flow that starts a branch with its own nodes (`bpmn show <file>` lists the outgoing flows of the gateway).', flowId);
  }
  const flows = nodes.flatMap((n) => doc.outgoing(n));
  return [flow, ...nodes, ...flows.filter((f, i) => flows.indexOf(f) === i)];
}

/** The elements of a kind, in document order (see module contract). */
export function kindOfElements(doc: Doc, kind: string): El[] {
  const match = kindFilter(kind);
  const out = [...doc.byId().values()].filter((el) => match(el));
  if (!out.length) throw noMatch(`No element of kind ${kind} in the file`, '`bpmn find <file> "" --kind <kind>` lists the elements of a kind; `bpmn kinds` the kind names.');
  return out;
}

/** The ids a format op works on (see module contract). */
export function selection(doc: Doc, sel: Selection, opts: { shapesOnly: boolean; drawn: (id: string) => boolean; centreX: (id: string) => number | undefined }): string[] {
  if (sel.path && sel.path.length !== 2) throw usageError(`--path takes exactly two ids (from and to), got ${sel.path.length}`, { hint: 'Example: --path Event_Start Event_Done (with --via <flowId> to choose a branch).' });
  if (sel.via?.length && !sel.path) throw usageError('--via needs --path', { hint: 'Example: --path Event_Start Event_Done --via Flow_Yes.' });
  const found: El[] = [];
  if (sel.branch) found.push(...branchOf(doc, sel.branch, opts.centreX));
  if (sel.path) found.push(...pathOf(doc, sel.path[0]!, sel.path[1]!, sel.via ?? []));
  if (sel.kind) found.push(...kindOfElements(doc, sel.kind));
  const connection = (el: El): boolean => is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association') || is(el, 'bpmn:DataAssociation');
  const picked = found
    .filter((el) => !opts.shapesOnly || !connection(el))
    .map((el) => idOf(el)!)
    .filter((id) => !!id && opts.drawn(id));
  const all = [...(sel.ids ?? []), ...picked];
  const out = all.filter((id, i) => all.indexOf(id) === i);
  if (!out.length) {
    throw noMatch('The selection names no drawn element', 'Name ids, or a --path / --kind / --branch that reaches drawn elements (`bpmn show <file> --layout` lists what is drawn).');
  }
  return out;
}
