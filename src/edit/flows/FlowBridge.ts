import { type BpmnElement, BpmnError, ChangeEntries, type ChangeSet, FlowEnds } from '../../model/index.js';
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

  bridgeNode(node: BpmnElement, bridge: boolean, removing?: ReadonlySet<string>): void {
    const document = this.edit.document;
    const incoming = document.flows.incoming(node);
    const outgoing = document.flows.outgoing(node);
    if (!bridge || incoming.length !== 1 || outgoing.length !== 1) {
      return this.detach(node, bridge);
    }
    const inFlow = incoming[0]!;
    const outFlow = outgoing[0]!;
    const predecessor = new FlowEnds(inFlow).source;
    const successor = new FlowEnds(outFlow).target;
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
    const predecessor = new FlowEnds(inFlow).source;
    const successor = new FlowEnds(outFlow).target;
    if ((predecessor === successor && !FlowBridge.canLoopToItself(predecessor)) || document.scopes.scopeOf(predecessor) !== document.scopes.scopeOf(successor)) {
      return;
    }
    const via = group.map((element) => element.id).join(', ');
    this.assertAllowed(new FlowEnds(outFlow).source, inFlow, outFlow, undefined, via);
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
      entries.push(...flows.incoming(member).filter((flow) => !inside.has(new FlowEnds(flow).source)));
      if (!member.is('bpmn:BoundaryEvent')) {
        exits.push(...flows.outgoing(member).filter((flow) => !inside.has(new FlowEnds(flow).target)));
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
      if (new FlowEnds(outFlow).target !== node && new FlowEnds(inFlow).source !== node) {
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
    const predecessor = new FlowEnds(inFlow).source;
    const successor = new FlowEnds(outFlow).target;
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

  assertAllowed(node: BpmnElement, inFlow: BpmnElement, outFlow: BpmnElement, removing?: ReadonlySet<string>, via: string = node.id): void {
    const predecessor = new FlowEnds(inFlow).source;
    const successor = new FlowEnds(outFlow).target;
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
    const catchFirst = `put an intermediate catch event (message / timer / signal / conditional) in front of ${successor.id} first (\`bpmn add <file> intermediateCatchEvent:timer "<name>" --flow ${outFlow.id} timer=PT1H\`)`;
    const rejectedBy = new EventGatewayRule(this.edit).rule === 'engines' ? 'which the engines reject' : 'which BPMN 2.0 does not allow';
    throw BpmnError.model('E_INVALID_BRIDGE', `${this.command === 'move' ? 'Moving' : 'Bridging'} ${via} would connect the event-based gateway ${predecessor.id} to ${successor.id}, ${rejectedBy}: ${problem}`, {
      element: node.id,
      related: [predecessor.id, successor.id],
      hint:
        this.command === 'move'
          ? `A move always bridges its old place: ${catchFirst}, or take ${via} out without a bridge (\`bpmn remove <file> ${via.split(', ').join(' ')} --bridge none\`) and add it again at the new place.`
          : `Remove without bridging (\`bpmn remove <file> ${node.id} --bridge none\`; the gateway loses that branch) and wire the gateway yourself, or ${catchFirst}, or remove ${successor.id} in the same command.`,
    });
  }
}
