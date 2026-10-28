import type { EditSession } from '../../document/EditSession.js';
import { modelError } from '../../document/utils/errors.js';
import { kindOf, synchronises } from '../../document/Kinds.js';
import { is, type El, idOf } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { renamedNote } from '../../document/utils/renames.js';
import { EventGatewayRule } from '../events/EventGatewayRule.js';
import { SequenceFlows } from './SequenceFlows.js';

/** Hints differ per command: `move` has no --no-bridge. */
export type BridgeCommand = 'remove' | 'move';

type CarryPolicy = 'node' | 'group';

/**
 * Reconnects the predecessors of a node that `remove` or `move` takes away to its successor,
 * so the flow keeps running: a single node, a join (all predecessors) or a moved group.
 */
export class FlowBridge {
  constructor(
    private readonly edit: EditSession,
    private readonly changes: ChangeSet,
    private readonly command: BridgeCommand = 'remove',
  ) {}

  /** A plain remove joins a non-synchronising merge and refuses a synchronising one. */
  forRemoval(node: El, bridge: boolean, all: boolean, removing: ReadonlySet<string>): void {
    if (all) this.join(node, removing);
    else if (bridge && this.isMerge(node)) {
      this.refuseSynchronisingJoin(node);
      this.join(node, removing);
    } else this.single(node, bridge, removing);
  }

  single(node: El, bridge: boolean, removing?: ReadonlySet<string>): void {
    const doc = this.edit.doc;
    const incoming = doc.incoming(node);
    const outgoing = doc.outgoing(node);
    if (!bridge || incoming.length !== 1 || outgoing.length !== 1) return this.detach(node, bridge);
    const inFlow = incoming[0]!;
    const outFlow = outgoing[0]!;
    const predecessor = inFlow.get<El>('sourceRef');
    const successor = outFlow.get<El>('targetRef');
    if (predecessor === successor && !FlowBridge.canLoopToItself(predecessor)) {
      this.detach(node, false);
      if (predecessor !== node) this.changes.note(`not bridged: ${idOf(predecessor)} is both predecessor and successor of ${idOf(node)} and cannot loop back to itself`);
      return;
    }
    this.assertAllowed(node, inFlow, outFlow, removing);
    this.detach(node, true);
  }

  /** Exception paths of the group's boundary events are not exits: the move drops them. */
  group(group: El[]): void {
    const doc = this.edit.doc;
    const inside = new Set<El>();
    for (const member of group) {
      inside.add(member);
      if (is(member, 'bpmn:Activity')) for (const boundary of doc.boundaryEventsOf(member)) inside.add(boundary);
    }
    const entries: El[] = [];
    const exits: El[] = [];
    for (const member of inside) {
      for (const flow of doc.incoming(member)) if (!inside.has(flow.get<El>('sourceRef'))) entries.push(flow);
      if (is(member, 'bpmn:BoundaryEvent')) continue;
      for (const flow of doc.outgoing(member)) if (!inside.has(flow.get<El>('targetRef'))) exits.push(flow);
    }
    if (entries.length !== 1 || exits.length !== 1) return;
    const inFlow = entries[0]!;
    const outFlow = exits[0]!;
    const predecessor = inFlow.get<El>('sourceRef');
    const successor = outFlow.get<El>('targetRef');
    if ((predecessor === successor && !FlowBridge.canLoopToItself(predecessor)) || doc.scopeOf(predecessor) !== doc.scopeOf(successor)) return;
    const via = group.map(idOf).join(', ');
    this.assertAllowed(outFlow.get<El>('sourceRef'), inFlow, outFlow, undefined, via);
    this.carry(inFlow, outFlow, via, 'group');
  }

  /** The self-loop rule of `connect`. */
  private static canLoopToItself(node: El): boolean {
    return is(node, 'bpmn:Activity');
  }

  /** Detaches the flows of the node; a self-loop, both incoming and outgoing, is removed and reported once. */
  private detach(node: El, bridge: boolean): void {
    const { changes } = this;
    const doc = this.edit.doc;
    const incoming = doc.incoming(node);
    const outgoing = doc.outgoing(node);
    if (bridge && incoming.length === 1 && outgoing.length === 1) {
      const inFlow = incoming[0]!;
      const outFlow = outgoing[0]!;
      if (outFlow.get<El>('targetRef') !== node && inFlow.get<El>('sourceRef') !== node) {
        this.carry(inFlow, outFlow, idOf(node), 'node');
        return;
      }
    }
    for (const flow of new Set([...incoming, ...outgoing])) {
      changes.remove(ChangeSet.flowEntryOf(flow));
      new SequenceFlows(this.edit).remove(flow, changes);
    }
  }

  /** Carries the in-flow on to the out-flow's target; under the group policy the out-flow's id stays claimed, so a flow the move creates afterwards does not reuse it. */
  private carry(inFlow: El, outFlow: El, via: string, policy: CarryPolicy): void {
    const { changes } = this;
    const doc = this.edit.doc;
    const predecessor = inFlow.get<El>('sourceRef');
    const successor = outFlow.get<El>('targetRef');
    const outName = outFlow.get<string | undefined>('name');
    const outCond = outFlow.get<El | undefined>('conditionExpression');
    if (outName && !inFlow.get<string | undefined>('name')) {
      inFlow.set('name', outName);
    } else if (outName) changes.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${idOf(outFlow)} was dropped while bridging ${via}`, element: idOf(outFlow) });
    const ontoDefault = predecessor.get<El | undefined>('default') === inFlow;
    if (outCond && !inFlow.get<El | undefined>('conditionExpression') && ontoDefault && policy === 'node') {
      changes.warn({
        code: 'W_CONDITION_DROPPED',
        message: `Condition of ${idOf(outFlow)} was dropped while bridging ${via}: ${idOf(inFlow)} is the default flow of ${idOf(predecessor)}`,
        element: idOf(outFlow),
        related: [idOf(inFlow)],
        hint: `A default flow has no condition; use \`bpmn set <file> ${idOf(inFlow)} condition=...\` if the condition should replace the default marker.`,
      });
    } else if (outCond && !inFlow.get<El | undefined>('conditionExpression') && !(ontoDefault && policy === 'group')) {
      inFlow.set('conditionExpression', outCond);
      if (policy === 'group') outCond.$parent = inFlow;
    } else if (outCond) changes.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(outFlow)} was dropped while bridging ${via}`, element: idOf(outFlow) });
    new SequenceFlows(this.edit).carryAssociations(outFlow, inFlow, changes);
    new SequenceFlows(this.edit).remove(outFlow, changes);
    changes.remove(ChangeSet.flowEntryOf(outFlow));
    if (policy === 'group' && idOf(outFlow) && !doc.has(idOf(outFlow))) doc.ids.claim(idOf(outFlow));
    const renamed = new SequenceFlows(this.edit).redirect(inFlow, { target: successor });
    changes.change(ChangeSet.flowEntryOf(inFlow, `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${via})${renamedNote(renamed)}`));
    changes.note(`bridged: ${idOf(predecessor)} -> ${idOf(successor)}`);
  }

  private join(node: El, removing: ReadonlySet<string>): void {
    const { changes } = this;
    const doc = this.edit.doc;
    const incoming = doc.incoming(node);
    const outgoing = doc.outgoing(node);
    if (outgoing.length > 1) {
      throw modelError('E_AMBIGUOUS_BRIDGE', `${idOf(node)} has ${outgoing.length} outgoing flows (${outgoing.map(idOf).join(', ')}): --bridge-all connects the predecessors of a join to its one successor, and here it is not clear which predecessor goes to which successor`, {
        element: idOf(node),
        candidates: outgoing.map(idOf),
        hint: `Remove the branches you do not need first (\`bpmn remove <file> <firstNodeOfBranch> --with-branch\`), or remove ${idOf(node)} without bridging (\`--no-bridge\`) and connect what should stay with \`bpmn connect\`.`,
      });
    }
    if (incoming.length <= 1 || !outgoing.length) {
      this.single(node, true, removing);
      return;
    }
    const outFlow = outgoing[0]!;
    const successor = outFlow.get<El>('targetRef');
    for (const inFlow of incoming) this.assertAllowed(node, inFlow, outFlow, removing);
    const outName = outFlow.get<string | undefined>('name');
    if (outName) changes.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${idOf(outFlow)} was dropped while bridging ${idOf(node)} from ${incoming.length} predecessors`, element: idOf(outFlow) });
    if (outFlow.get<El | undefined>('conditionExpression')) changes.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(outFlow)} was dropped while bridging ${idOf(node)} from ${incoming.length} predecessors`, element: idOf(outFlow) });
    new SequenceFlows(this.edit).remove(outFlow, changes);
    changes.remove(ChangeSet.flowEntryOf(outFlow));
    const bridged: string[] = [];
    for (const inFlow of incoming) {
      const predecessor = inFlow.get<El>('sourceRef');
      const already = doc.outgoing(predecessor).some((flow) => flow !== inFlow && flow.get<El | undefined>('targetRef') === successor);
      if (predecessor === successor || predecessor === node || already) {
        new SequenceFlows(this.edit).remove(inFlow, changes);
        changes.remove(ChangeSet.flowEntryOf(inFlow));
        changes.note(`not bridged: ${idOf(predecessor)} ${predecessor === successor ? 'is the successor itself' : predecessor === node ? 'is the removed node' : `already flows to ${idOf(successor)}`}`);
        continue;
      }
      const renamed = new SequenceFlows(this.edit).redirect(inFlow, { target: successor });
      changes.change(ChangeSet.flowEntryOf(inFlow, `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${idOf(node)})${renamedNote(renamed)}`));
      bridged.push(idOf(predecessor));
    }
    changes.note(`bridged all: ${bridged.join(', ')} -> ${idOf(successor)}`);
    const sync = synchronises(node);
    if (sync) changes.note(`${idOf(node)} synchronised ${bridged.join(', ')}; now each of them runs on to ${idOf(successor)} on its own`);
    const count = doc.incoming(successor).length;
    if (count > 1 && (sync || !is(successor, 'bpmn:Gateway'))) {
      changes.warn({
        code: 'W_IMPLICIT_JOIN',
        message: sync
          ? `${idOf(successor)} now has ${count} incoming flows: the ${FlowBridge.joinKind(node)} join ${idOf(node)} synchronised them, now each path runs on to ${idOf(successor)} on its own`
          : `${idOf(successor)} now has ${count} incoming flows (implicit join)`,
        element: idOf(successor),
        hint: sync ? `Keep a ${FlowBridge.joinKind(node)} join in front of ${idOf(successor)} if the paths must wait for each other.` : 'Consider joining through a gateway.',
      });
    }
  }

  private isMerge(node: El): boolean {
    return this.edit.doc.incoming(node).length > 1 && this.edit.doc.outgoing(node).length === 1;
  }

  /** Bridging ends the synchronisation, not bridging disconnects the successor: ask which. */
  private refuseSynchronisingJoin(node: El): void {
    if (!synchronises(node)) return;
    const incoming = this.edit.doc.incoming(node);
    const successor = this.edit.doc.outgoing(node)[0]!.get<El>('targetRef');
    const preds = [...new Set(incoming.map((flow) => idOf(flow.get<El>('sourceRef'))))];
    throw modelError(
      'E_AMBIGUOUS_BRIDGE',
      `${idOf(node)} is a ${FlowBridge.joinKind(node)} join of ${incoming.length} paths (${preds.join(', ')}): bridging them to ${idOf(successor)} ends the synchronisation (${idOf(successor)} would run once per path), removing it without a bridge leaves ${idOf(successor)} unconnected`,
      {
        element: idOf(node),
        candidates: incoming.map(idOf),
        hint: `Say which: \`bpmn remove <file> ${idOf(node)} --bridge-all\` (each path runs on to ${idOf(successor)} on its own), or \`bpmn remove <file> ${idOf(node)} --no-bridge\` and connect what should stay with \`bpmn connect\`.`,
      },
    );
  }

  private static joinKind(node: El): string {
    return kindOf(node)!.kind.replace('Gateway', '');
  }

  /**
   * Refuses giving an event-based gateway a target its rule rejects. A successor the same
   * command removes is not checked: its own removal decides.
   */
  private assertAllowed(node: El, inFlow: El, outFlow: El, removing?: ReadonlySet<string>, via: string = idOf(node)): void {
    const predecessor = inFlow.get<El>('sourceRef');
    const successor = outFlow.get<El>('targetRef');
    if (!is(predecessor, 'bpmn:EventBasedGateway') || successor === node) return;
    if (removing?.has(idOf(successor))) return;
    const problem = new EventGatewayRule(this.edit).targetProblem(predecessor, successor, [outFlow, inFlow]);
    if (!problem) return;
    const catchFirst = `put an intermediate catch event (message / timer / signal / conditional) in front of ${idOf(successor)} first (\`bpmn add <file> intermediateCatchEvent:timer "<name>" --flow ${idOf(outFlow)} --timer PT1H\`)`;
    const rejectedBy = new EventGatewayRule(this.edit).rule === 'engines' ? 'which the engines reject' : 'which BPMN 2.0 does not allow';
    throw modelError('E_INVALID_BRIDGE', `${this.command === 'move' ? 'Moving' : 'Bridging'} ${via} would connect the event-based gateway ${idOf(predecessor)} to ${idOf(successor)}, ${rejectedBy}: ${problem}`, {
      element: idOf(node),
      related: [idOf(predecessor), idOf(successor)],
      hint:
        this.command === 'move'
          ? `A move always bridges its old place: ${catchFirst}, or take ${via} out without a bridge (\`bpmn remove <file> ${via.split(', ').join(' ')} --no-bridge\`) and add it again at the new place.`
          : `Remove without bridging (\`bpmn remove <file> ${idOf(node)} --no-bridge\`; the gateway loses that branch) and wire the gateway yourself, or ${catchFirst}, or remove ${idOf(successor)} in the same command.`,
    });
  }
}
