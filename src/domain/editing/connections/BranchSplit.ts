import { BpmnError } from '../../document/BpmnError.js';
import type { EditSession } from '../../document/EditSession.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import { gatewayKindList, parseKind } from '../../document/Kinds.js';
import { is, type El, idOf } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { CommandParser } from '../../commands/CommandParser.js';
import { laneOf } from '../../document/utils/lanes.js';
import { renamedNote } from '../../document/utils/renames.js';
import { insertAfterInScope } from '../utils/declaration-order.js';
import { FlowOptions } from './FlowOptions.js';
import type { AddElement, FlowOptions as FlowOptionValues, SplitIntoBranches } from '../../commands/types.js';
import { SequenceFlows } from './SequenceFlows.js';
import { ElementCreation } from '../elements/ElementCreation.js';
import { Connections } from './Connections.js';

/**
 * The `split` macro: a split gateway, its branches and an optional join, built from
 * ElementCreation / Connections calls so the usual warnings apply. A branch ending in an
 * end event terminates there; a join needs two branches that reach it.
 */
export class BranchSplit {
  constructor(private readonly edit: EditSession) {}

  private static gatewayKind(token: string | undefined): string {
    const kind = token ?? 'exclusiveGateway';
    let def;
    try {
      def = parseKind(kind).def;
    } catch (err) {
      if (err instanceof BpmnError) {
        throw modelError('E_UNKNOWN_KIND', err.message, { candidates: err.details.candidates ?? [] });
      }
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
  private static createdId(changes: ChangeSet): string {
    const first = changes.created[0];
    if (!first) throw modelError('E_INTERNAL', 'add reported no created element');
    return first.id;
  }

  /**
   * op.joinId, else `<gatewayId>Join` in the id conventions. `base` (the id it wanted)
   * marks it generated, so a retype in the same batch gives it the new prefix.
   */
  private joinIdFor(command: SplitIntoBranches, gateway: El, changes: ChangeSet, kind: string): { id: string; base?: string } {
    if (command.joinId) return { id: command.joinId };
    const gatewayId = idOf(gateway);
    const base = this.edit.idStyle.joinId(gatewayId, kind, new ElementLabels(gateway).label());
    const sep = this.edit.idStyle.suffixSep();
    const id = this.edit.allocator.suffixed(base, sep);
    if (id !== base) {
      changes.warn({ code: 'W_ID_SUFFIXED', message: `Id ${base} is already taken; using ${id}`, element: id, hint: 'Pass joinId to choose the join id yourself.' });
    }
    return { id, base };
  }

  /**
   * Splits after op.after into a gateway, its branches and a join. Branches ending in an end
   * event terminate there instead of reaching the join; a generated join id is marked generated,
   * not the caller's (ElementCreation claimed it as given).
   */
  split(command: SplitIntoBranches): ChangeSet {
    const changes = new ChangeSet();
    const kind = BranchSplit.gatewayKind(command.kind);
    if (command.branches !== undefined && command.branches !== null) {
      new CommandParser().parseBranches(command.branches);
    }
    if (!command.branches?.length) {
      throw modelError('E_INVALID_VALUE', 'split needs at least one branch', { hint: 'Pass branches: [{ nodes: [...] }, ...].' });
    }
    const anchor = this.edit.require(command.after, 'bpmn:FlowNode');
    const scope = this.edit.doc.scopeOf(anchor);
    if (!scope) {
      throw modelError('E_INVALID_PLACEMENT', `${command.after} is not inside a process`, { element: command.after });
    }
    const outgoing = this.edit.doc.outgoing(anchor);
    const isGateway = is(anchor, 'bpmn:Gateway');
    if (!isGateway && outgoing.length > 1) {
      throw modelError('E_HAS_SUCCESSOR', `${command.after} already has ${outgoing.length} outgoing flows; split after a node with at most one`, {
        element: command.after,
        candidates: outgoing.map(idOf),
        hint: 'Insert a node into the wanted flow first (`add ... --flow <flowId>`) and split after it.',
      });
    }
    const spliced = !isGateway && outgoing.length === 1 ? outgoing[0]! : undefined;
    const successor = spliced?.get<El>('targetRef');
    const withJoin = command.join !== false;
    const lane = laneOf(this.edit.doc, anchor);
    const laneOpt = lane ? { lane: idOf(lane) } : {};

    const gwCs = new ElementCreation(this.edit).add({ op: 'add', kind, ...(command.name ? { name: command.name } : {}), ...(command.id ? { id: command.id } : {}), in: idOf(scope), ...laneOpt }, new ElementLabels(anchor).anchorContext('After'));
    changes.merge(gwCs);
    const gatewayId = BranchSplit.createdId(gwCs);
    const gateway = this.edit.require(gatewayId);
    changes.bind(command.as, gateway);
    if (spliced) {
      const renamed = new SequenceFlows(this.edit).redirect(spliced, { target: gateway });
      insertAfterInScope(scope, spliced, gateway);
      changes.change(ChangeSet.flowEntryOf(spliced, `${command.after} -> ${gatewayId} (was -> ${idOf(successor!)})${renamedNote(renamed)}`));
      changes.note(`inserted ${gatewayId} between ${command.after} and ${idOf(successor!)}`);
    } else {
      const flow = new SequenceFlows(this.edit).create(anchor, gateway);
      insertAfterInScope(scope, flow, gateway);
      changes.create(ChangeSet.flowEntryOf(flow));
      changes.note(`appended ${gatewayId} after ${command.after}`);
    }
    const gwEntry = changes.created.find((change) => change.id === gatewayId);
    if (gwEntry) {
      gwEntry.detail = spliced ? `between ${command.after} and ${idOf(successor!)}` : `after ${command.after}`;
    }

    const ends: Array<{ end: string; flowOptions: FlowOptionValues; direct: boolean }> = [];
    for (const branch of command.branches) {
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
        const addCommand: AddElement = { ...node, ...(index === 0 ? { ...flowOptions, ...own } : own), op: 'add', after: prev };
        const nodeCs = new ElementCreation(this.edit).add(addCommand);
        changes.merge(nodeCs);
        prev = BranchSplit.createdId(nodeCs);
      });
      ends.push({ end: prev, flowOptions, direct: false });
    }

    const terminating = ends.filter((branchEnd) => !branchEnd.direct && is(this.edit.require(branchEnd.end), 'bpmn:EndEvent'));
    const continuing = ends.filter((branchEnd) => !terminating.includes(branchEnd));
    let joinId: string | undefined;
    const why = !withJoin ? 'join is false' : !continuing.length ? 'every branch ends in an end event' : continuing.length === 1 ? `only one branch continues (the others end in an end event), and a join needs two` : undefined;
    if (command.joinAs && why) {
      throw usageError(`joinAs ${command.joinAs}: split ${gatewayId} creates no join gateway (${why})`, { element: gatewayId, hint: 'Drop joinAs, or give another branch that continues.' });
    }
    const lone = continuing.length === 1 ? continuing[0]! : undefined;
    if (withJoin && lone?.direct && !successor) {
      throw modelError('E_INVALID_VALUE', 'An empty branch needs another branch that continues or a successor to connect to', {
        element: gatewayId,
        hint: 'Give the branch at least one node, or split after a node that has a successor.',
      });
    }
    if (withJoin && !continuing.length) {
      changes.note('every branch ends in an end event; no join gateway created');
    } else if (withJoin && lone) {
      changes.note(`only the branch ending at ${lone.direct ? gatewayId : lone.end} continues; no join gateway created${successor ? ` (it runs on to ${idOf(successor)})` : ''}`);
    } else if (withJoin) {
      const wanted = this.joinIdFor(command, gateway, changes, kind);
      const joinCs = new ElementCreation(this.edit).add({ op: 'add', kind, ...(command.joinName ? { name: command.joinName } : {}), id: wanted.id, in: idOf(scope), ...laneOpt });
      changes.merge(joinCs);
      joinId = BranchSplit.createdId(joinCs);
      if (wanted.base !== undefined) {
        this.edit.allocator.markGenerated(joinId, wanted.base);
      }
      changes.bind(command.joinAs, this.edit.doc.get(joinId));
      const joinEntry = changes.created.find((change) => change.id === joinId);
      if (joinEntry) joinEntry.detail = `join of ${gatewayId}`;
    }
    const target = joinId ?? (successor ? idOf(successor) : undefined);
    for (const { end } of terminating) {
      changes.note(`branch ending at ${end} terminates (end event)${target ? `; not connected to ${target}` : ''}`);
    }
    if (successor && !continuing.length) {
      changes.note(`${idOf(successor)} is no longer reached: every branch terminates (connect it with \`bpmn connect <file> <id> ${idOf(successor)}\` or remove it)`);
    }
    if (target) {
      for (const { end, flowOptions, direct } of continuing) {
        const opts = direct ? flowOptions : {};
        changes.merge(
          new Connections(this.edit).connect({ op: 'connect', source: end, target, ...new FlowOptions(opts).toConnect() }),
        );
      }
    }
    if (joinId && successor) {
      changes.merge(new Connections(this.edit).connect({ op: 'connect', source: joinId, target: idOf(successor) }));
    }

    const branchIds = ends.map((branchEnd) => (branchEnd.direct ? '(direct)' : terminating.includes(branchEnd) ? `${branchEnd.end} (end event)` : branchEnd.end));
    changes.note(`split ${gatewayId}: ${ends.length} branch(es) ending at ${branchIds.join(', ')}${joinId ? `, joined at ${joinId}` : ''}${successor && continuing.length ? `, continues to ${idOf(successor)}` : ''}`);
    this.edit.doc.invalidate();
    return changes;
  }
}
