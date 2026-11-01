import { type BpmnElement, BpmnError, ChangeEntries, ChangeSet, ElementLabels, KindParser } from '../model/index.js';
import type { AddOperation, SplitBranch, SplitOperation } from '../operations/index.js';
import { ElementCreation } from './ElementCreation.js';
import { FlowConnector } from './FlowConnector.js';
import { DeclarationOrder } from './flows/DeclarationOrder.js';
import { FlowOptions, type FlowOptionValues } from './flows/FlowOptions.js';
import { SequenceFlows } from './flows/SequenceFlows.js';
import type { EditSession } from './session/EditSession.js';

interface SplitPoint {
  anchor: BpmnElement;
  scope: BpmnElement;
  spliced: BpmnElement | undefined;
  successor: BpmnElement | undefined;
  withJoin: boolean;
  kind: string;
  lane: { lane: string } | Record<string, never>;
}

interface BranchEnd {
  end: string;
  flowOptions: FlowOptionValues;
  direct: boolean;
}

export class BranchSplit {
  constructor(private readonly edit: EditSession) {}

  private static gatewayKind(token: string | undefined): string {
    const { def } = KindParser.parse(token ?? 'exclusiveGateway');
    return def.kind;
  }

  private static createdId(changes: ChangeSet): string {
    return changes.created[0]!.id;
  }

  private static missingJoinReason(withJoin: boolean, continuing: readonly BranchEnd[]): string | undefined {
    if (!withJoin) {
      return 'join is false';
    }
    if (!continuing.length) {
      return 'every branch ends in an end event';
    }
    return continuing.length === 1 ? 'only one branch continues (the others end in an end event), and a join needs two' : undefined;
  }

  split(command: SplitOperation): ChangeSet {
    const changes = new ChangeSet();
    const point = this.pointOf(command);
    const gateway = this.addGateway(command, point, changes);
    const ends = command.branches.flatMap((branch) => this.buildBranch(branch, gateway.id, point, changes));
    const terminating = ends.filter((branchEnd) => !branchEnd.direct && this.edit.require(branchEnd.end).is('bpmn:EndEvent'));
    const continuing = ends.filter((branchEnd) => !terminating.includes(branchEnd));
    const joinId = this.addJoin(command, gateway, point, continuing, changes);
    this.connectEnds(point, joinId, terminating, continuing, changes);
    this.noteSplit(gateway.id, point.successor, ends, terminating, continuing, joinId, changes);
    this.edit.document.tree.invalidate();
    return changes;
  }

  private pointOf(command: SplitOperation): SplitPoint {
    const { document } = this.edit;
    const kind = BranchSplit.gatewayKind(command.kind);
    const anchor = this.edit.require(command.after, 'bpmn:FlowNode');
    const scope = document.scopes.scopeOf(anchor);
    if (!scope) {
      throw BpmnError.model('E_INVALID_PLACEMENT', `${command.after} is not inside a process`, { element: command.after });
    }
    const outgoing = document.flows.outgoing(anchor);
    const isGateway = anchor.is('bpmn:Gateway');
    if (!isGateway && outgoing.length > 1) {
      throw BpmnError.model('E_HAS_SUCCESSOR', `${command.after} already has ${outgoing.length} outgoing flows; split after a node with at most one`, {
        element: command.after,
        candidates: outgoing.map((flow) => flow.id),
        hint: 'Insert a node into the wanted flow first (`add ... --flow <flowId>`) and split after it.',
      });
    }
    const spliced = !isGateway && outgoing.length === 1 ? outgoing[0] : undefined;
    const lane = document.scopes.laneOf(anchor);
    return { anchor, scope, spliced, successor: spliced?.get<BpmnElement>('targetRef'), withJoin: command.join !== false, kind, lane: lane ? { lane: lane.id } : {} };
  }

  private addGateway(command: SplitOperation, point: SplitPoint, changes: ChangeSet): BpmnElement {
    const { anchor, scope, spliced, successor } = point;
    const named = { ...(command.name ? { name: command.name } : {}), ...(command.id ? { id: command.id } : {}) };
    const created = new ElementCreation(this.edit).add({ op: 'add', kind: point.kind, ...named, in: scope.id, ...point.lane }, new ElementLabels(anchor).anchorContext('After'));
    changes.merge(created);
    const gatewayId = BranchSplit.createdId(created);
    const gateway = this.edit.require(gatewayId);
    changes.bind(command.as, gateway);
    if (spliced) {
      const renamed = new SequenceFlows(this.edit).redirect(spliced, { target: gateway });
      new DeclarationOrder(scope).insertAfter(spliced, gateway);
      changes.change(ChangeEntries.ofFlow(spliced, `${command.after} -> ${gatewayId} (was -> ${successor!.id})${ChangeEntries.renamedNote(renamed)}`));
      changes.note(`inserted ${gatewayId} between ${command.after} and ${successor!.id}`);
    } else {
      const flow = new SequenceFlows(this.edit).create(anchor, gateway);
      new DeclarationOrder(scope).insertAfter(flow, gateway);
      changes.create(ChangeEntries.ofFlow(flow));
      changes.note(`appended ${gatewayId} after ${command.after}`);
    }
    const entry = changes.created.find((change) => change.id === gatewayId);
    if (entry) {
      entry.detail = spliced ? `between ${command.after} and ${successor!.id}` : `after ${command.after}`;
    }
    return gateway;
  }

  private buildBranch(branch: SplitBranch, gatewayId: string, point: SplitPoint, changes: ChangeSet): BranchEnd {
    const flowOptions = FlowOptions.of(branch);
    if (!branch.nodes.length) {
      if (!point.withJoin && !point.spliced) {
        throw BpmnError.model('E_INVALID_VALUE', 'An empty branch needs a join gateway or a successor to connect to', {
          element: gatewayId,
          hint: 'Give the branch at least one node, or keep join enabled.',
        });
      }
      return { end: gatewayId, flowOptions, direct: true };
    }
    let previous = gatewayId;
    branch.nodes.forEach((node, index) => {
      const own = FlowOptions.of(node);
      const add: AddOperation = { ...node, ...(index === 0 ? { ...flowOptions, ...own } : own), op: 'add', after: previous };
      const created = new ElementCreation(this.edit).add(add);
      changes.merge(created);
      previous = BranchSplit.createdId(created);
    });
    return { end: previous, flowOptions, direct: false };
  }

  private addJoin(command: SplitOperation, gateway: BpmnElement, point: SplitPoint, continuing: readonly BranchEnd[], changes: ChangeSet): string | undefined {
    const { withJoin, successor } = point;
    const why = BranchSplit.missingJoinReason(withJoin, continuing);
    if (command.joinAs && why) {
      throw BpmnError.usage(`joinAs ${command.joinAs}: split ${gateway.id} creates no join gateway (${why})`, { element: gateway.id, hint: 'Drop joinAs, or give another branch that continues.' });
    }
    if (!withJoin) {
      return undefined;
    }
    const lone = continuing.length === 1 ? continuing[0]! : undefined;
    if (lone?.direct && !successor) {
      throw BpmnError.model('E_INVALID_VALUE', 'An empty branch needs another branch that continues or a successor to connect to', {
        element: gateway.id,
        hint: 'Give the branch at least one node, or split after a node that has a successor.',
      });
    }
    if (!continuing.length) {
      changes.note('every branch ends in an end event; no join gateway created');
      return undefined;
    }
    if (lone) {
      changes.note(`only the branch ending at ${lone.direct ? gateway.id : lone.end} continues; no join gateway created${successor ? ` (it runs on to ${successor.id})` : ''}`);
      return undefined;
    }
    return this.createJoin(command, gateway, point, changes);
  }

  private createJoin(command: SplitOperation, gateway: BpmnElement, point: SplitPoint, changes: ChangeSet): string {
    const wanted = this.joinIdFor(command, gateway, point.kind, changes);
    const created = new ElementCreation(this.edit).add({ op: 'add', kind: point.kind, ...(command.joinName ? { name: command.joinName } : {}), id: wanted.id, in: point.scope.id, ...point.lane });
    changes.merge(created);
    const joinId = BranchSplit.createdId(created);
    if (wanted.base !== undefined) {
      this.edit.allocator.markGenerated(joinId, wanted.base);
    }
    changes.bind(command.joinAs, this.edit.document.tree.byId(joinId));
    const entry = changes.created.find((change) => change.id === joinId);
    if (entry) {
      entry.detail = `join of ${gateway.id}`;
    }
    return joinId;
  }

  private joinIdFor(command: SplitOperation, gateway: BpmnElement, kind: string, changes: ChangeSet): { id: string; base?: string } {
    if (command.joinId) {
      return { id: command.joinId };
    }
    const { idStyle } = this.edit;
    const base = idStyle.joinId(gateway.id, kind, new ElementLabels(gateway).label());
    const id = this.edit.allocator.suffixed(base, idStyle.suffixSep());
    if (id !== base) {
      changes.warn({ code: 'W_ID_SUFFIXED', message: `Id ${base} is already taken; using ${id}`, element: id, hint: 'Pass joinId to choose the join id yourself.' });
    }
    return { id, base };
  }

  private connectEnds({ successor }: SplitPoint, joinId: string | undefined, terminating: readonly BranchEnd[], continuing: readonly BranchEnd[], changes: ChangeSet): void {
    const target = joinId ?? successor?.id;
    for (const { end } of terminating) {
      changes.note(`branch ending at ${end} terminates (end event)${target ? `; not connected to ${target}` : ''}`);
    }
    if (successor && !continuing.length) {
      changes.note(`${successor.id} is no longer reached: every branch terminates (connect it with \`bpmn connect <file> <id> ${successor.id}\` or remove it)`);
    }
    if (target) {
      for (const { end, flowOptions, direct } of continuing) {
        const options = new FlowOptions(direct ? flowOptions : {}).toConnect();
        changes.merge(new FlowConnector(this.edit).connect({ op: 'connect', source: end, target, ...options }));
      }
    }
    if (joinId && successor) {
      changes.merge(new FlowConnector(this.edit).connect({ op: 'connect', source: joinId, target: successor.id }));
    }
  }

  private noteSplit(gatewayId: string, successor: BpmnElement | undefined, ends: readonly BranchEnd[], terminating: readonly BranchEnd[], continuing: readonly BranchEnd[], joinId: string | undefined, changes: ChangeSet): void {
    const shown = (branchEnd: BranchEnd): string => {
      if (branchEnd.direct) {
        return '(direct)';
      }
      return terminating.includes(branchEnd) ? `${branchEnd.end} (end event)` : branchEnd.end;
    };
    const joined = joinId ? `, joined at ${joinId}` : '';
    const onward = successor && continuing.length ? `, continues to ${successor.id}` : '';
    changes.note(`split ${gatewayId}: ${ends.length} branch(es) ending at ${ends.map(shown).join(', ')}${joined}${onward}`);
  }
}
