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
 *         terminates there (no flow onward); a join needs two branches that
 *         reach it: when one continues, its end connects to the old
 *         successor directly (no pass-through gateway), when none does no
 *         join is created either.
 *  - Typed ops of the library skip parseOps (src/ops/batch.ts): before the split
 *    changes anything, `branches` must be an array of objects, each with a
 *    `nodes` array (empty allowed) of objects with a string `kind`, else
 *    E_USAGE in parseOps' words (the path starts with `split`, not
 *    `ops[i] (split)`). The rest of a node (an unknown kind, its options)
 *    is checked when addElement creates it.
 *  - Returns the merged ChangeSet (notes: which ids were created).
 */
import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { type CliError } from '../shared/CliError.js';
import { gatewayKindList, parseKind, KindError } from '../model/kinds.js';
import { is, type El, idOf } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { anchorContext, keyRequest, labelOf } from '../ids/style.js';
import { BRANCH_FIELDS, NODE_FIELDS } from './batch.js';
import { withSuffix } from '../ids/slugs.js';
import { addElement } from './add.js';
import { connectElements } from './connect.js';
import { laneOf } from './containers.js';
import { createSequenceFlow, flowChange, insertAfterInScope, redirectFlow, renamedNote } from './flows.js';
import type { AddOp, FlowOptions, SplitBranch, SplitOp } from './types.js';


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
      hint: `Use ${gatewayKindList()}.`,
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
 * case: camel `<gatewayId>Join`, pascalSnake `<gatewayId>_Join`; a declared
 * camelCase / PascalCase: `<gatewayId>Join`, snake_case `<gatewayId>_join`;
 * a split id the declared prefix does not start: that prefix and the
 * gateway's label, gateway_checkJoin); a taken one gets `_2` (a declared
 * camelCase / PascalCase: `2`), cut so that it stays within MAX_ID (the
 * join kept); with the id it wanted (`base`), which a generated one has
 * (Doc.markGenerated: a retype in the same batch gives it the new prefix).
 */
function joinIdFor(doc: Doc, op: SplitOp, gateway: El, cs: ChangeSet, kind: string): { id: string; base?: string } {
  if (op.joinId) return { id: op.joinId };
  const gatewayId = idOf(gateway);
  const base = doc.idStyle.joinId(gatewayId, kind, labelOf(gateway));
  const sep = doc.idStyle.suffixSep(kind);
  let id = base;
  for (let n = 2; doc.has(id) || doc.ids.has(id); n++) id = withSuffix(base, sep, n);
  if (id !== base) {
    cs.warn({ code: 'W_ID_SUFFIXED', message: `Id ${base} is already taken; using ${id}`, element: id, hint: 'Pass joinId to choose the join id yourself.' });
  }
  // the result's `conventions:` line: a join under a prefix the declared conventions name, other than the file's style gives
  const style = doc.idStyle;
  if (style.declared && style.explain(keyRequest(kind)).source === 'lint' && base !== style.learnedOnly().joinId(gatewayId, kind)) doc.edit.recordDeclaredId(id);
  return { id, base };
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'object') return 'an object';
  return `${typeof v} ${JSON.stringify(v)}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The shape parseOps checks, in its words, for typed ops that skip it
 * (mutateDoc, runOps): `branches` (when given) an array of objects, each with
 * a `nodes` array of objects with a string `kind`. A branch without `nodes`
 * is no empty branch: the CLI refuses it too.
 */
function checkShape(branches: unknown): void {
  if (branches === undefined || branches === null) return;
  if (!Array.isArray(branches)) {
    throw usageError(`split: "branches" must be an array of branch objects, got ${describe(branches)}`, { hint: 'Write "branches": [{"flowName": "yes", "nodes": [{"kind": "userTask", "name": "..."}]}].' });
  }
  const missing = (path: string, key: string, description: string): CliError => usageError(`${path}: missing required key "${key}" (${description})`);
  branches.forEach((branch: unknown, i) => {
    if (!isObject(branch)) throw usageError(`split branches[${i}]: expected an object, got ${describe(branch)}`);
    const nodes = branch['nodes'];
    if (nodes === undefined || nodes === null) throw missing(`split branches[${i}]`, 'nodes', BRANCH_FIELDS.nodes.description);
    if (!Array.isArray(nodes)) throw usageError(`split branches[${i}]: "nodes" must be an array of node objects, got ${describe(nodes)}`, { hint: 'An empty array is allowed: the branch is then a direct gateway -> join flow.' });
    nodes.forEach((node: unknown, j) => {
      const path = `split branches[${i}].nodes[${j}]`;
      if (!isObject(node)) throw usageError(`${path}: expected an object, got ${describe(node)}`);
      const kind = node['kind'];
      if (kind === undefined || kind === null) throw missing(path, 'kind', NODE_FIELDS.kind.description);
      if (typeof kind !== 'string') throw usageError(`${path}: "kind" must be a string, got ${describe(kind)}`, { hint: 'Write it as a JSON string, e.g. "kind": "...".' });
    });
  });
}

/**
 * Splits the flow after `op.after` into branches through a gateway, with an
 * optional join gateway. Every node is created with addElement(), every extra
 * flow with connectElements(), so the usual warnings apply.
 */
export function splitFlow(doc: Doc, op: SplitOp): ChangeSet {
  const cs = new ChangeSet();
  const kind = gatewayKind(op.kind);
  checkShape(op.branches);
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
  const gwCs = addElement(doc, { op: 'add', kind, ...(op.name ? { name: op.name } : {}), ...(op.id ? { id: op.id } : {}), in: idOf(scope), ...laneOpt }, anchorContext('After', anchor));
  cs.merge(gwCs);
  const gatewayId = createdId(gwCs);
  const gateway = doc.require(gatewayId);
  cs.bind(op.as, gateway);
  if (spliced) {
    const renamed = redirectFlow(doc, spliced, { target: gateway });
    insertAfterInScope(scope, spliced, gateway);
    cs.change(flowChange(spliced, `${op.after} -> ${gatewayId} (was -> ${idOf(successor!)})${renamedNote(renamed)}`));
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
  const why = !withJoin ? 'join is false' : !continuing.length ? 'every branch ends in an end event' : continuing.length === 1 ? `only one branch continues (the others end in an end event), and a join needs two` : undefined;
  if (op.joinAs && why) {
    throw usageError(`joinAs ${op.joinAs}: split ${gatewayId} creates no join gateway (${why})`, { element: gatewayId, hint: 'Drop joinAs, or give another branch that continues.' });
  }
  const lone = continuing.length === 1 ? continuing[0]! : undefined;
  if (withJoin && lone?.direct && !successor) {
    throw modelError('E_INVALID_VALUE', 'An empty branch needs another branch that continues or a successor to connect to', {
      element: gatewayId,
      hint: 'Give the branch at least one node, or split after a node that has a successor.',
    });
  }
  if (withJoin && !continuing.length) {
    cs.note('every branch ends in an end event; no join gateway created');
  } else if (withJoin && lone) {
    cs.note(`only the branch ending at ${lone.direct ? gatewayId : lone.end} continues; no join gateway created${successor ? ` (it runs on to ${idOf(successor)})` : ''}`);
  } else if (withJoin) {
    const wanted = joinIdFor(doc, op, gateway, cs, kind);
    const joinCs = addElement(doc, { op: 'add', kind, ...(op.joinName ? { name: op.joinName } : {}), id: wanted.id, in: idOf(scope), ...laneOpt });
    cs.merge(joinCs);
    joinId = createdId(joinCs);
    // generated, not the caller's (addElement claimed it as given)
    if (wanted.base !== undefined) doc.edit.markGenerated(joinId, wanted.base);
    cs.bind(op.joinAs, doc.get(joinId));
    const joinEntry = cs.created.find((c) => c.id === joinId);
    if (joinEntry) joinEntry.detail = `join of ${gatewayId}`;
  }
  const target = joinId ?? (successor ? idOf(successor) : undefined);
  for (const { end } of terminating) cs.note(`branch ending at ${end} terminates (end event)${target ? `; not connected to ${target}` : ''}`);
  if (successor && !continuing.length) {
    cs.note(`${idOf(successor)} is no longer reached: every branch terminates (connect it with \`bpmn connect <file> <id> ${idOf(successor)}\` or remove it)`);
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

  const branchIds = ends.map((e) => (e.direct ? '(direct)' : terminating.includes(e) ? `${e.end} (end event)` : e.end));
  cs.note(`split ${gatewayId}: ${ends.length} branch(es) ending at ${branchIds.join(', ')}${joinId ? `, joined at ${joinId}` : ''}${successor && continuing.length ? `, continues to ${idOf(successor)}` : ''}`);
  doc.invalidate();
  return cs;
}
