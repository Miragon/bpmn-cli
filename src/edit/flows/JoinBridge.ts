import { type BpmnElement, BpmnError, ChangeEntries, type ChangeSet, Kinds, FlowEnds } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { FlowBridge } from './FlowBridge.js';
import { SequenceFlows } from './SequenceFlows.js';

export class JoinBridge {
  private readonly single: FlowBridge;

  constructor(
    private readonly edit: EditSession,
    private readonly changes: ChangeSet,
  ) {
    this.single = new FlowBridge(edit, changes);
  }

  bridgeRemoval(node: BpmnElement, bridge: boolean, all: boolean, removing: ReadonlySet<string>): void {
    if (all) {
      this.join(node, removing);
    } else if (bridge && this.isMerge(node)) {
      this.refuseSynchronisingJoin(node);
      this.join(node, removing);
    } else {
      this.single.bridgeNode(node, bridge, removing);
    }
  }

  private join(node: BpmnElement, removing: ReadonlySet<string>): void {
    const { changes } = this;
    const document = this.edit.document;
    const incoming = document.flows.incoming(node);
    const outgoing = document.flows.outgoing(node);
    JoinBridge.assertOneSuccessor(node, outgoing);
    if (incoming.length <= 1 || !outgoing.length) {
      this.single.bridgeNode(node, true, removing);
      return;
    }
    const outFlow = outgoing[0]!;
    const successor = new FlowEnds(outFlow).target;
    for (const inFlow of incoming) {
      this.single.assertAllowed(node, inFlow, outFlow, removing);
    }
    this.warnJoinedOutFlow(node, outFlow, incoming.length);
    new SequenceFlows(this.edit).remove(outFlow, changes);
    changes.remove(ChangeEntries.ofFlow(outFlow));
    const bridged = incoming.flatMap((inFlow) => this.bridgeIncoming(inFlow, node, successor));
    changes.note(`bridged all: ${bridged.join(', ')} -> ${successor.id}`);
    const sync = Kinds.synchronises(node);
    if (sync) {
      changes.note(`${node.id} synchronised ${bridged.join(', ')}; now each of them runs on to ${successor.id} on its own`);
    }
    this.warnImplicitJoin(node, successor, sync);
  }

  private static assertOneSuccessor(node: BpmnElement, outgoing: readonly BpmnElement[]): void {
    if (outgoing.length > 1) {
      throw BpmnError.model('E_AMBIGUOUS_BRIDGE', `${node.id} has ${outgoing.length} outgoing flows (${outgoing.map((element) => element.id).join(', ')}): --bridge all connects the predecessors of a join to its one successor, and here it is not clear which predecessor goes to which successor`, {
        element: node.id,
        candidates: outgoing.map((element) => element.id),
        hint: `Remove the branches you do not need first (\`bpmn remove <file> <firstNodeOfBranch> --with-branch\`), or remove ${node.id} without bridging (\`--bridge none\`) and connect what should stay with \`bpmn connect\`.`,
      });
    }
  }

  private warnJoinedOutFlow(node: BpmnElement, outFlow: BpmnElement, predecessors: number): void {
    const { changes } = this;
    const outName = outFlow.get<string | undefined>('name');
    if (outName) {
      changes.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${outFlow.id} was dropped while bridging ${node.id} from ${predecessors} predecessors`, element: outFlow.id });
    }
    if (outFlow.get<BpmnElement | undefined>('conditionExpression')) {
      changes.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${outFlow.id} was dropped while bridging ${node.id} from ${predecessors} predecessors`, element: outFlow.id });
    }
  }

  private bridgeIncoming(inFlow: BpmnElement, node: BpmnElement, successor: BpmnElement): string[] {
    const { changes } = this;
    const predecessor = new FlowEnds(inFlow).source;
    const already = this.edit.document.flows.outgoing(predecessor).some((flow) => flow !== inFlow && flow.get<BpmnElement | undefined>('targetRef') === successor);
    if (predecessor === successor || already) {
      new SequenceFlows(this.edit).remove(inFlow, changes);
      changes.remove(ChangeEntries.ofFlow(inFlow));
      changes.note(`not bridged: ${predecessor.id} ${predecessor === successor ? 'is the successor itself' : `already flows to ${successor.id}`}`);
      return [];
    }
    const renamed = new SequenceFlows(this.edit).redirect(inFlow, { target: successor });
    changes.change(ChangeEntries.ofFlow(inFlow, `${predecessor.id} -> ${successor.id} (bridged ${node.id})${ChangeEntries.renamedNote(renamed)}`));
    return [predecessor.id];
  }

  private warnImplicitJoin(node: BpmnElement, successor: BpmnElement, sync: boolean): void {
    const count = this.edit.document.flows.incoming(successor).length;
    if (count > 1 && (sync || !successor.is('bpmn:Gateway'))) {
      this.changes.warn({
        code: 'W_IMPLICIT_JOIN',
        message: sync
          ? `${successor.id} now has ${count} incoming flows: the ${JoinBridge.joinKind(node)} join ${node.id} synchronised them, now each path runs on to ${successor.id} on its own`
          : `${successor.id} now has ${count} incoming flows (implicit join)`,
        element: successor.id,
        hint: sync ? `Keep a ${JoinBridge.joinKind(node)} join in front of ${successor.id} if the paths must wait for each other.` : 'Consider joining through a gateway.',
      });
    }
  }

  private isMerge(node: BpmnElement): boolean {
    return this.edit.document.flows.incoming(node).length > 1 && this.edit.document.flows.outgoing(node).length === 1;
  }

  private refuseSynchronisingJoin(node: BpmnElement): void {
    if (!Kinds.synchronises(node)) {
      return;
    }
    const incoming = this.edit.document.flows.incoming(node);
    const successor = new FlowEnds(this.edit.document.flows.outgoing(node)[0]!).target;
    const preds = [...new Set(incoming.map((flow) => new FlowEnds(flow).source.id))];
    throw BpmnError.model(
      'E_AMBIGUOUS_BRIDGE',
      `${node.id} is a ${JoinBridge.joinKind(node)} join of ${incoming.length} paths (${preds.join(', ')}): bridging them to ${successor.id} ends the synchronisation (${successor.id} would run once per path), removing it without a bridge leaves ${successor.id} unconnected`,
      {
        element: node.id,
        candidates: incoming.map((element) => element.id),
        hint: `Say which: \`bpmn remove <file> ${node.id} --bridge all\` (each path runs on to ${successor.id} on its own), or \`bpmn remove <file> ${node.id} --bridge none\` and connect what should stay with \`bpmn connect\`.`,
      },
    );
  }

  private static joinKind(node: BpmnElement): string {
    return Kinds.of(node)!.kind.replace('Gateway', '');
  }
}
