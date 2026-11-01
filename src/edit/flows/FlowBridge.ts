import { type BpmnElement, BpmnError, ChangeEntries, type ChangeSet, Kinds } from '../../model/index.js';
import { EventGatewayRule } from '../events/EventGatewayRule.js';
import type { EditSession } from '../session/EditSession.js';
import { SequenceFlows } from './SequenceFlows.js';

export type BridgeCommand = 'remove' | 'move';

type CarryPolicy = 'node' | 'group';

export class FlowBridge {
  constructor(
    private readonly edit: EditSession,
    private readonly changes: ChangeSet,
    private readonly command: BridgeCommand = 'remove',
  ) {}

  bridgeRemoval(node: BpmnElement, bridge: boolean, all: boolean, removing: ReadonlySet<string>): void {
    if (all) {
      this.join(node, removing);
    } else if (bridge && this.isMerge(node)) {
      this.refuseSynchronisingJoin(node);
      this.join(node, removing);
    } else {
      this.bridgeNode(node, bridge, removing);
    }
  }

  bridgeNode(node: BpmnElement, bridge: boolean, removing?: ReadonlySet<string>): void {
    const document = this.edit.document;
    const incoming = document.flows.incoming(node);
    const outgoing = document.flows.outgoing(node);
    if (!bridge || incoming.length !== 1 || outgoing.length !== 1) {
      return this.detach(node, bridge);
    }
    const inFlow = incoming[0]!;
    const outFlow = outgoing[0]!;
    const predecessor = inFlow.get<BpmnElement>('sourceRef');
    const successor = outFlow.get<BpmnElement>('targetRef');
    if (predecessor === successor && !FlowBridge.canLoopToItself(predecessor)) {
      this.detach(node, false);
      if (predecessor !== node) {
        this.changes.note(`not bridged: ${predecessor.id} is both predecessor and successor of ${node.id} and cannot loop back to itself`);
      }
      return;
    }
    this.assertAllowed(node, inFlow, outFlow, removing);
    this.detach(node, true);
  }

  bridgeGroup(group: BpmnElement[]): void {
    const document = this.edit.document;
    const { entries, exits } = this.crossingFlows(this.withBoundaries(group));
    if (entries.length !== 1 || exits.length !== 1) {
      return;
    }
    const inFlow = entries[0]!;
    const outFlow = exits[0]!;
    const predecessor = inFlow.get<BpmnElement>('sourceRef');
    const successor = outFlow.get<BpmnElement>('targetRef');
    if ((predecessor === successor && !FlowBridge.canLoopToItself(predecessor)) || document.scopes.scopeOf(predecessor) !== document.scopes.scopeOf(successor)) {
      return;
    }
    const via = group.map((element) => element.id).join(', ');
    this.assertAllowed(outFlow.get<BpmnElement>('sourceRef'), inFlow, outFlow, undefined, via);
    this.carry(inFlow, outFlow, via, 'group');
  }

  private withBoundaries(group: BpmnElement[]): Set<BpmnElement> {
    const inside = new Set<BpmnElement>();
    for (const member of group) {
      inside.add(member);
      if (member.is('bpmn:Activity')) {
        for (const boundary of this.edit.document.scopes.boundaryEventsOf(member)) {
          inside.add(boundary);
        }
      }
    }
    return inside;
  }

  private crossingFlows(inside: Set<BpmnElement>): { entries: BpmnElement[]; exits: BpmnElement[] } {
    const { flows } = this.edit.document;
    const entries: BpmnElement[] = [];
    const exits: BpmnElement[] = [];
    for (const member of inside) {
      entries.push(...flows.incoming(member).filter((flow) => !inside.has(flow.get<BpmnElement>('sourceRef'))));
      if (!member.is('bpmn:BoundaryEvent')) {
        exits.push(...flows.outgoing(member).filter((flow) => !inside.has(flow.get<BpmnElement>('targetRef'))));
      }
    }
    return { entries, exits };
  }

  private static canLoopToItself(node: BpmnElement): boolean {
    return node.is('bpmn:Activity');
  }

  private detach(node: BpmnElement, bridge: boolean): void {
    const { changes } = this;
    const document = this.edit.document;
    const incoming = document.flows.incoming(node);
    const outgoing = document.flows.outgoing(node);
    if (bridge && incoming.length === 1 && outgoing.length === 1) {
      const inFlow = incoming[0]!;
      const outFlow = outgoing[0]!;
      if (outFlow.get<BpmnElement>('targetRef') !== node && inFlow.get<BpmnElement>('sourceRef') !== node) {
        this.carry(inFlow, outFlow, node.id, 'node');
        return;
      }
    }
    for (const flow of new Set([...incoming, ...outgoing])) {
      changes.remove(ChangeEntries.ofFlow(flow));
      new SequenceFlows(this.edit).remove(flow, changes);
    }
  }

  private carry(inFlow: BpmnElement, outFlow: BpmnElement, via: string, policy: CarryPolicy): void {
    const { changes } = this;
    const document = this.edit.document;
    const predecessor = inFlow.get<BpmnElement>('sourceRef');
    const successor = outFlow.get<BpmnElement>('targetRef');
    const outName = outFlow.get<string | undefined>('name');
    const outCond = outFlow.get<BpmnElement | undefined>('conditionExpression');
    if (outName && !inFlow.get<string | undefined>('name')) {
      inFlow.set('name', outName);
    } else if (outName) {
      changes.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${outFlow.id} was dropped while bridging ${via}`, element: outFlow.id });
    }
    const ontoDefault = predecessor.get<BpmnElement | undefined>('default') === inFlow;
    if (outCond && !inFlow.get<BpmnElement | undefined>('conditionExpression') && ontoDefault && policy === 'node') {
      changes.warn({
        code: 'W_CONDITION_DROPPED',
        message: `Condition of ${outFlow.id} was dropped while bridging ${via}: ${inFlow.id} is the default flow of ${predecessor.id}`,
        element: outFlow.id,
        related: [inFlow.id],
        hint: `A default flow has no condition; use \`bpmn set <file> ${inFlow.id} condition=...\` if the condition should replace the default marker.`,
      });
    } else if (outCond && !inFlow.get<BpmnElement | undefined>('conditionExpression') && !(ontoDefault && policy === 'group')) {
      inFlow.set('conditionExpression', outCond);
      if (policy === 'group') {
        outCond.parent = inFlow;
      }
    } else if (outCond) {
      changes.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${outFlow.id} was dropped while bridging ${via}`, element: outFlow.id });
    }
    new SequenceFlows(this.edit).carryAssociations(outFlow, inFlow, changes);
    new SequenceFlows(this.edit).remove(outFlow, changes);
    changes.remove(ChangeEntries.ofFlow(outFlow));
    if (policy === 'group') {
      document.ids.registry.claim(outFlow.id);
    }
    const renamed = new SequenceFlows(this.edit).redirect(inFlow, { target: successor });
    changes.change(ChangeEntries.ofFlow(inFlow, `${predecessor.id} -> ${successor.id} (bridged ${via})${ChangeEntries.renamedNote(renamed)}`));
    changes.note(`bridged: ${predecessor.id} -> ${successor.id}`);
  }

  private join(node: BpmnElement, removing: ReadonlySet<string>): void {
    const { changes } = this;
    const document = this.edit.document;
    const incoming = document.flows.incoming(node);
    const outgoing = document.flows.outgoing(node);
    FlowBridge.assertOneSuccessor(node, outgoing);
    if (incoming.length <= 1 || !outgoing.length) {
      this.bridgeNode(node, true, removing);
      return;
    }
    const outFlow = outgoing[0]!;
    const successor = outFlow.get<BpmnElement>('targetRef');
    for (const inFlow of incoming) {
      this.assertAllowed(node, inFlow, outFlow, removing);
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
      throw BpmnError.model('E_AMBIGUOUS_BRIDGE', `${node.id} has ${outgoing.length} outgoing flows (${outgoing.map((element) => element.id).join(', ')}): --bridge-all connects the predecessors of a join to its one successor, and here it is not clear which predecessor goes to which successor`, {
        element: node.id,
        candidates: outgoing.map((element) => element.id),
        hint: `Remove the branches you do not need first (\`bpmn remove <file> <firstNodeOfBranch> --with-branch\`), or remove ${node.id} without bridging (\`--no-bridge\`) and connect what should stay with \`bpmn connect\`.`,
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
    const predecessor = inFlow.get<BpmnElement>('sourceRef');
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
          ? `${successor.id} now has ${count} incoming flows: the ${FlowBridge.joinKind(node)} join ${node.id} synchronised them, now each path runs on to ${successor.id} on its own`
          : `${successor.id} now has ${count} incoming flows (implicit join)`,
        element: successor.id,
        hint: sync ? `Keep a ${FlowBridge.joinKind(node)} join in front of ${successor.id} if the paths must wait for each other.` : 'Consider joining through a gateway.',
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
    const successor = this.edit.document.flows.outgoing(node)[0]!.get<BpmnElement>('targetRef');
    const preds = [...new Set(incoming.map((flow) => flow.get<BpmnElement>('sourceRef').id))];
    throw BpmnError.model(
      'E_AMBIGUOUS_BRIDGE',
      `${node.id} is a ${FlowBridge.joinKind(node)} join of ${incoming.length} paths (${preds.join(', ')}): bridging them to ${successor.id} ends the synchronisation (${successor.id} would run once per path), removing it without a bridge leaves ${successor.id} unconnected`,
      {
        element: node.id,
        candidates: incoming.map((element) => element.id),
        hint: `Say which: \`bpmn remove <file> ${node.id} --bridge-all\` (each path runs on to ${successor.id} on its own), or \`bpmn remove <file> ${node.id} --no-bridge\` and connect what should stay with \`bpmn connect\`.`,
      },
    );
  }

  private static joinKind(node: BpmnElement): string {
    return Kinds.of(node)!.kind.replace('Gateway', '');
  }

  private assertAllowed(node: BpmnElement, inFlow: BpmnElement, outFlow: BpmnElement, removing?: ReadonlySet<string>, via: string = node.id): void {
    const predecessor = inFlow.get<BpmnElement>('sourceRef');
    const successor = outFlow.get<BpmnElement>('targetRef');
    if (!predecessor.is('bpmn:EventBasedGateway') || successor === node) {
      return;
    }
    if (removing?.has(successor.id)) {
      return;
    }
    const problem = new EventGatewayRule(this.edit).targetProblem(predecessor, successor, [outFlow, inFlow]);
    if (!problem) {
      return;
    }
    const catchFirst = `put an intermediate catch event (message / timer / signal / conditional) in front of ${successor.id} first (\`bpmn add <file> intermediateCatchEvent:timer "<name>" --flow ${outFlow.id} --timer PT1H\`)`;
    const rejectedBy = new EventGatewayRule(this.edit).rule === 'engines' ? 'which the engines reject' : 'which BPMN 2.0 does not allow';
    throw BpmnError.model('E_INVALID_BRIDGE', `${this.command === 'move' ? 'Moving' : 'Bridging'} ${via} would connect the event-based gateway ${predecessor.id} to ${successor.id}, ${rejectedBy}: ${problem}`, {
      element: node.id,
      related: [predecessor.id, successor.id],
      hint:
        this.command === 'move'
          ? `A move always bridges its old place: ${catchFirst}, or take ${via} out without a bridge (\`bpmn remove <file> ${via.split(', ').join(' ')} --no-bridge\`) and add it again at the new place.`
          : `Remove without bridging (\`bpmn remove <file> ${node.id} --no-bridge\`; the gateway loses that branch) and wire the gateway yourself, or ${catchFirst}, or remove ${successor.id} in the same command.`,
    });
  }
}
