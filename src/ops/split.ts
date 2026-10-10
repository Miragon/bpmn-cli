/**
 * `split` macro: split gateway + branches + optional join in one operation.
 *
 *  - Expands into addElement()/connectElements() calls:
 *      1. gateway (op.kind, default exclusiveGateway) placed `after: op.after`
 *         (append or splice; when spliced the old successor becomes the
 *         join's successor / the branch target)
 *      2. per branch: first node `after` the gateway with the branch's
 *         flow options (flowName/condition/default), following nodes chained
 *         with `after` the previous one; an empty `nodes` list is a direct
 *         gateway -> join flow
 *      3. join gateway (same kind, id op.joinId or <gatewayId>_join) when
 *         op.join !== false; every branch end connects to it; if the anchor
 *         was spliced, join -> old successor. A branch ending in an end event
 *         terminates there (no flow onward); when every branch terminates no
 *         join is created.
 *  - Returns the merged ChangeSet (notes: which ids were created).
 */
import type { Doc } from '../document.js';
import { modelError, usageError } from '../errors.js';
import { parseKind, KindError } from '../kinds.js';
import { is, type El } from '../model.js';
import { ChangeSet } from '../result.js';
import { labelOf } from '../idstyle.js';
import { addElement } from './add.js';
import { connectElements } from './connect.js';
import { laneOf } from './containers.js';
import { createSequenceFlow, flowChange, insertAfterInScope, redirectFlow, renamedNote } from './flows.js';
import type { AddOp, FlowOptions, SplitBranch, SplitOp } from './types.js';

function idOf(el: El): string {
  return el.get<string>('id');
}

function gatewayKind(token: string | undefined): string {
  const kind = token ?? 'exclusiveGateway';
  let def;
  try {
    def = parseKind(kind).def;
  } catch (err) {
    if (err instanceof KindError) throw modelError('E_UNKNOWN_KIND', err.message, { candidates: err.candidates });
    throw err;
  }
  if (def.family !== 'gateway') {
    throw modelError('E_INVALID_VALUE', `split needs a gateway kind, not ${def.kind}`, {
      hint: 'Use exclusiveGateway (xor), parallelGateway (and), inclusiveGateway (or) or eventBasedGateway.',
    });
  }
  return def.kind;
}

/** Flow options of a branch (branch-level defaults, first node's own options win). */
function branchFlowOptions(branch: SplitBranch): FlowOptions {
  const out: FlowOptions = {};
  if (branch.flowName !== undefined) out.flowName = branch.flowName;
  if (branch.flowId !== undefined) out.flowId = branch.flowId;
  if (branch.condition !== undefined) out.condition = branch.condition;
  if (branch.language !== undefined) out.language = branch.language;
  if (branch.default !== undefined) out.default = branch.default;
  return out;
}

/** The id of the element an addElement() call created (its entry is always first). */
function createdId(cs: ChangeSet): string {
  const first = cs.created[0];
  if (!first) throw modelError('E_INTERNAL', 'add reported no created element');
  return first.id;
}

/**
 * The join gateway's id: op.joinId, else `<gatewayId>_join` (in the file's
 * case: camel `<gatewayId>Join`, pascalSnake `<gatewayId>_Join`).
 */
function joinIdFor(doc: Doc, op: SplitOp, gatewayId: string, cs: ChangeSet): string {
  if (op.joinId) return op.joinId;
  const base = doc.idStyle.joinId(gatewayId);
  let id = base;
  let n = 2;
  while (doc.has(id) || doc.ids.has(id)) id = `${base}_${n++}`;
  if (id !== base) {
    cs.warn({ code: 'W_ID_SUFFIXED', message: `Id ${base} is already taken; using ${id}`, element: id, hint: 'Pass joinId to choose the join id yourself.' });
  }
  return id;
}

/**
 * Splits the flow after `op.after` into branches through a gateway, with an
 * optional join gateway. Every node is created with addElement(), every extra
 * flow with connectElements(), so the usual warnings apply.
 */
export function splitFlow(doc: Doc, op: SplitOp): ChangeSet {
  const cs = new ChangeSet();
  const kind = gatewayKind(op.kind);
  if (!op.branches?.length) {
    throw modelError('E_INVALID_VALUE', 'split needs at least one branch', { hint: 'Pass branches: [{ nodes: [...] }, ...].' });
  }
  const anchor = doc.require(op.after, 'bpmn:FlowNode');
  const scope = doc.scopeOf(anchor);
  if (!scope) throw modelError('E_INVALID_PLACEMENT', `${op.after} is not inside a process`, { element: op.after });
  const outgoing = doc.outgoing(anchor);
  const isGateway = is(anchor, 'bpmn:Gateway');
  if (!isGateway && outgoing.length > 1) {
    throw modelError('E_HAS_SUCCESSOR', `${op.after} already has ${outgoing.length} outgoing flows; split after a node with at most one`, {
      element: op.after,
      candidates: outgoing.map(idOf),
      hint: 'Insert a node into the wanted flow first (`add ... --flow <flowId>`) and split after it.',
    });
  }
  const spliced = !isGateway && outgoing.length === 1 ? outgoing[0]! : undefined;
  const successor = spliced?.get<El>('targetRef');
  const withJoin = op.join !== false;
  const lane = laneOf(doc, anchor);
  const laneOpt = lane ? { lane: idOf(lane) } : {};

  // 1. split gateway
  const gwCs = addElement(doc, { op: 'add', kind, ...(op.name ? { name: op.name } : {}), ...(op.id ? { id: op.id } : {}), in: idOf(scope), ...laneOpt }, `After ${labelOf(anchor)}`);
  cs.merge(gwCs);
  const gatewayId = createdId(gwCs);
  const gateway = doc.require(gatewayId);
  cs.bind(op.as, gateway);
  if (spliced) {
    const renamed = redirectFlow(doc, spliced, { target: gateway });
    insertAfterInScope(scope, spliced, gateway);
    cs.change({ ...flowChange(spliced), detail: `${op.after} -> ${gatewayId} (was -> ${idOf(successor!)})${renamedNote(renamed)}` });
    cs.note(`inserted ${gatewayId} between ${op.after} and ${idOf(successor!)}`);
  } else {
    const flow = createSequenceFlow(doc, anchor, gateway);
    insertAfterInScope(scope, flow, gateway);
    cs.create(flowChange(flow));
    cs.note(`appended ${gatewayId} after ${op.after}`);
  }
  const gwEntry = cs.created.find((c) => c.id === gatewayId);
  if (gwEntry) gwEntry.detail = spliced ? `between ${op.after} and ${idOf(successor!)}` : `after ${op.after}`;

  // 2. branches
  const ends: Array<{ end: string; flowOptions: FlowOptions; direct: boolean }> = [];
  for (const branch of op.branches) {
    const flowOptions = branchFlowOptions(branch);
    if (!branch.nodes?.length) {
      if (!withJoin && !spliced) {
        throw modelError('E_INVALID_VALUE', 'An empty branch needs a join gateway or a successor to connect to', {
          element: gatewayId,
          hint: 'Give the branch at least one node, or keep join enabled.',
        });
      }
      ends.push({ end: gatewayId, flowOptions, direct: true });
      continue;
    }
    let prev = gatewayId;
    branch.nodes.forEach((node, i) => {
      const own: FlowOptions = {};
      for (const key of ['flowName', 'flowId', 'condition', 'language', 'default'] as const) {
        if (node[key] !== undefined) (own as Record<string, unknown>)[key] = node[key];
      }
      const addOp: AddOp = { ...node, ...(i === 0 ? { ...flowOptions, ...own } : own), op: 'add', after: prev };
      const nodeCs = addElement(doc, addOp);
      cs.merge(nodeCs);
      prev = createdId(nodeCs);
    });
    ends.push({ end: prev, flowOptions, direct: false });
  }

  // 3. join (branches ending in an end event terminate there)
  const terminating = ends.filter((e) => !e.direct && is(doc.require(e.end), 'bpmn:EndEvent'));
  const continuing = ends.filter((e) => !terminating.includes(e));
  let joinId: string | undefined;
  if (op.joinAs && (!withJoin || !continuing.length)) {
    throw usageError(`joinAs ${op.joinAs}: split ${gatewayId} creates no join gateway (${withJoin ? 'every branch ends in an end event' : 'join is false'})`, { element: gatewayId, hint: 'Drop joinAs, or give a branch that continues.' });
  }
  if (withJoin && !continuing.length) {
    cs.note('every branch ends in an end event; no join gateway created');
  } else if (withJoin) {
    const wanted = joinIdFor(doc, op, gatewayId, cs);
    const joinCs = addElement(doc, { op: 'add', kind, ...(op.joinName ? { name: op.joinName } : {}), id: wanted, in: idOf(scope), ...laneOpt });
    cs.merge(joinCs);
    joinId = createdId(joinCs);
    cs.bind(op.joinAs, doc.get(joinId));
    const joinEntry = cs.created.find((c) => c.id === joinId);
    if (joinEntry) joinEntry.detail = `join of ${gatewayId}`;
  }
  const target = joinId ?? (successor ? idOf(successor) : undefined);
  for (const { end } of terminating) cs.note(`branch ending at ${end} terminates (end event)${target ? `; not connected to ${target}` : ''}`);
  if (successor && !continuing.length) {
    cs.note(`${idOf(successor)} is no longer reached: every branch terminates (connect it with \`bpmn connect <id> ${idOf(successor)}\` or remove it)`);
  }
  if (target) {
    for (const { end, flowOptions, direct } of continuing) {
      const opts = direct ? flowOptions : {};
      cs.merge(
        connectElements(doc, {
          op: 'connect',
          source: end,
          target,
          ...(opts.flowId ? { id: opts.flowId } : {}),
          ...(opts.flowName ? { name: opts.flowName } : {}),
          ...(opts.condition !== undefined ? { condition: opts.condition } : {}),
          ...(opts.language ? { language: opts.language } : {}),
          ...(opts.default ? { default: true } : {}),
        }),
      );
    }
  }
  if (joinId && successor) {
    cs.merge(connectElements(doc, { op: 'connect', source: joinId, target: idOf(successor) }));
  }

  const branchIds = ends.map((e) => (e.direct ? '(direct)' : e.end));
  cs.note(`split ${gatewayId}: ${ends.length} branch(es) ending at ${branchIds.join(', ')}${joinId ? `, joined at ${joinId}` : ''}${successor ? `, continues to ${idOf(successor)}` : ''}`);
  doc.invalidate();
  return cs;
}
