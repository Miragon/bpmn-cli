import type { Doc } from '../../document/Doc.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import type { CliError } from '../../document/CliError.js';
import { gatewayKindList, parseKind } from '../../document/utils/kinds.js';
import { KindError } from '../../document/KindError.js';
import { is, type El, idOf } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { IdStyle } from '../../document/ids/IdStyle.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { BRANCH_FIELDS, NODE_FIELDS } from '../../commands/utils/op-fields.js';
import { laneOf } from '../../document/utils/lanes.js';
import { renamedNote } from '../../document/utils/renames.js';
import { insertAfterInScope } from '../utils/declaration-order.js';
import { FlowOptions } from './FlowOptions.js';
import type { AddElement, FlowOptions as FlowOptionValues, SplitIntoBranches } from '../../commands/types.js';
import { SequenceFlowService } from './SequenceFlowService.js';
import { ElementCreationService } from '../ElementCreationService.js';
import { ConnectionService } from '../ConnectionService.js';

/**
 * The `split` macro: a split gateway, its branches and an optional join, built from
 * ElementCreationService / ConnectionService calls so the usual warnings apply. A branch ending in an
 * end event terminates there; a join needs two branches that reach it.
 */
export class BranchSplitService {
  constructor(private readonly doc: Doc) {}

  private static gatewayKind(token: string | undefined): string {
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

  /** An add's created entry is always first. */
  private static createdId(cs: ChangeSet): string {
    const first = cs.created[0];
    if (!first) throw modelError('E_INTERNAL', 'add reported no created element');
    return first.id;
  }

  /**
   * op.joinId, else `<gatewayId>_join` in the file's id style. `base` (the id it wanted)
   * marks it generated, so a retype in the same batch gives it the new prefix.
   */
  private joinIdFor(op: SplitIntoBranches, gateway: El, cs: ChangeSet, kind: string): { id: string; base?: string } {
    if (op.joinId) return { id: op.joinId };
    const gatewayId = idOf(gateway);
    const base = this.doc.idStyle.joinId(gatewayId, kind, new ElementLabels(gateway).label());
    const sep = this.doc.idStyle.suffixSep(kind);
    const id = this.doc.edit.allocator.suffixed(base, sep);
    if (id !== base) {
      cs.warn({ code: 'W_ID_SUFFIXED', message: `Id ${base} is already taken; using ${id}`, element: id, hint: 'Pass joinId to choose the join id yourself.' });
    }
    // the result's `conventions:` line: a join named by declared conventions, not the file's style
    const style = this.doc.idStyle;
    if (style.declared && style.explain(IdStyle.keyRequest(kind)).source === 'lint' && base !== style.learnedOnly().joinId(gatewayId, kind)) this.doc.edit.allocator.recordDeclared(id);
    return { id, base };
  }

  private static describe(input: unknown): string {
    if (input === null) return 'null';
    if (Array.isArray(input)) return 'an array';
    if (typeof input === 'object') return 'an object';
    return `${typeof input} ${JSON.stringify(input)}`;
  }

  private static isObject(candidate: unknown): candidate is Record<string, unknown> {
    return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
  }

  /**
   * The shape parseOps checks, in its words, for typed library ops that skip it.
   * A branch without `nodes` is no empty branch: the CLI refuses it too.
   */
  private static checkShape(branches: unknown): void {
    if (branches === undefined || branches === null) return;
    if (!Array.isArray(branches)) {
      throw usageError(`split: "branches" must be an array of branch objects, got ${BranchSplitService.describe(branches)}`, { hint: 'Write "branches": [{"flowName": "yes", "nodes": [{"kind": "userTask", "name": "..."}]}].' });
    }
    const missing = (path: string, key: string, description: string): CliError => usageError(`${path}: missing required key "${key}" (${description})`);
    branches.forEach((branch: unknown, branchIndex) => {
      if (!BranchSplitService.isObject(branch)) throw usageError(`split branches[${branchIndex}]: expected an object, got ${BranchSplitService.describe(branch)}`);
      const nodes = branch['nodes'];
      if (nodes === undefined || nodes === null) throw missing(`split branches[${branchIndex}]`, 'nodes', BRANCH_FIELDS.nodes.description);
      if (!Array.isArray(nodes)) throw usageError(`split branches[${branchIndex}]: "nodes" must be an array of node objects, got ${BranchSplitService.describe(nodes)}`, { hint: 'An empty array is allowed: the branch is then a direct gateway -> join flow.' });
      nodes.forEach((node: unknown, nodeIndex) => {
        const path = `split branches[${branchIndex}].nodes[${nodeIndex}]`;
        if (!BranchSplitService.isObject(node)) throw usageError(`${path}: expected an object, got ${BranchSplitService.describe(node)}`);
        const kind = node['kind'];
        if (kind === undefined || kind === null) throw missing(path, 'kind', NODE_FIELDS.kind.description);
        if (typeof kind !== 'string') throw usageError(`${path}: "kind" must be a string, got ${BranchSplitService.describe(kind)}`, { hint: 'Write it as a JSON string, e.g. "kind": "...".' });
      });
    });
  }

  split(op: SplitIntoBranches): ChangeSet {
    const cs = new ChangeSet();
    const kind = BranchSplitService.gatewayKind(op.kind);
    BranchSplitService.checkShape(op.branches);
    if (!op.branches?.length) {
      throw modelError('E_INVALID_VALUE', 'split needs at least one branch', { hint: 'Pass branches: [{ nodes: [...] }, ...].' });
    }
    const anchor = this.doc.require(op.after, 'bpmn:FlowNode');
    const scope = this.doc.scopeOf(anchor);
    if (!scope) throw modelError('E_INVALID_PLACEMENT', `${op.after} is not inside a process`, { element: op.after });
    const outgoing = this.doc.outgoing(anchor);
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
    const lane = laneOf(this.doc, anchor);
    const laneOpt = lane ? { lane: idOf(lane) } : {};

    // 1. split gateway
    const gwCs = new ElementCreationService(this.doc).add({ op: 'add', kind, ...(op.name ? { name: op.name } : {}), ...(op.id ? { id: op.id } : {}), in: idOf(scope), ...laneOpt }, new ElementLabels(anchor).anchorContext('After'));
    cs.merge(gwCs);
    const gatewayId = BranchSplitService.createdId(gwCs);
    const gateway = this.doc.require(gatewayId);
    cs.bind(op.as, gateway);
    if (spliced) {
      const renamed = new SequenceFlowService(this.doc).redirect(spliced, { target: gateway });
      insertAfterInScope(scope, spliced, gateway);
      cs.change(ChangeSet.flowEntryOf(spliced, `${op.after} -> ${gatewayId} (was -> ${idOf(successor!)})${renamedNote(renamed)}`));
      cs.note(`inserted ${gatewayId} between ${op.after} and ${idOf(successor!)}`);
    } else {
      const flow = new SequenceFlowService(this.doc).create(anchor, gateway);
      insertAfterInScope(scope, flow, gateway);
      cs.create(ChangeSet.flowEntryOf(flow));
      cs.note(`appended ${gatewayId} after ${op.after}`);
    }
    const gwEntry = cs.created.find((change) => change.id === gatewayId);
    if (gwEntry) gwEntry.detail = spliced ? `between ${op.after} and ${idOf(successor!)}` : `after ${op.after}`;

    // 2. branches
    const ends: Array<{ end: string; flowOptions: FlowOptionValues; direct: boolean }> = [];
    for (const branch of op.branches) {
      const flowOptions = FlowOptions.of(branch);
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
      branch.nodes.forEach((node, index) => {
        const own = FlowOptions.of(node);
        const addOp: AddElement = { ...node, ...(index === 0 ? { ...flowOptions, ...own } : own), op: 'add', after: prev };
        const nodeCs = new ElementCreationService(this.doc).add(addOp);
        cs.merge(nodeCs);
        prev = BranchSplitService.createdId(nodeCs);
      });
      ends.push({ end: prev, flowOptions, direct: false });
    }

    // 3. join (branches ending in an end event terminate there)
    const terminating = ends.filter((branchEnd) => !branchEnd.direct && is(this.doc.require(branchEnd.end), 'bpmn:EndEvent'));
    const continuing = ends.filter((branchEnd) => !terminating.includes(branchEnd));
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
      const wanted = this.joinIdFor(op, gateway, cs, kind);
      const joinCs = new ElementCreationService(this.doc).add({ op: 'add', kind, ...(op.joinName ? { name: op.joinName } : {}), id: wanted.id, in: idOf(scope), ...laneOpt });
      cs.merge(joinCs);
      joinId = BranchSplitService.createdId(joinCs);
      // generated, not the caller's (ElementCreationService.add claimed it as given)
      if (wanted.base !== undefined) this.doc.edit.allocator.markGenerated(joinId, wanted.base);
      cs.bind(op.joinAs, this.doc.get(joinId));
      const joinEntry = cs.created.find((change) => change.id === joinId);
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
          new ConnectionService(this.doc).connect({ op: 'connect', source: end, target, ...new FlowOptions(opts).toConnect() }),
        );
      }
    }
    if (joinId && successor) {
      cs.merge(new ConnectionService(this.doc).connect({ op: 'connect', source: joinId, target: idOf(successor) }));
    }

    const branchIds = ends.map((branchEnd) => (branchEnd.direct ? '(direct)' : terminating.includes(branchEnd) ? `${branchEnd.end} (end event)` : branchEnd.end));
    cs.note(`split ${gatewayId}: ${ends.length} branch(es) ending at ${branchIds.join(', ')}${joinId ? `, joined at ${joinId}` : ''}${successor && continuing.length ? `, continues to ${idOf(successor)}` : ''}`);
    this.doc.invalidate();
    return cs;
  }
}
