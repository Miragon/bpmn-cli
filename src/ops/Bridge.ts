/**
 * Bridging: reconnecting the predecessors of a node that `remove` takes out
 * or `move` takes away to its successor, so the flow keeps running.
 *
 *  - single: a node with one incoming and one outgoing flow; its in-flow
 *    runs on to the successor and takes over the out-flow's name, condition
 *    and annotations where it has none (W_LABEL_DROPPED / W_CONDITION_DROPPED
 *    otherwise). No bridge when predecessor and successor are the same
 *    non-activity (a self-loop `connect` would refuse; activities may loop to
 *    themselves); a condition that would land on the predecessor's default
 *    flow is dropped instead (W_CONDITION_DROPPED), a default flow has no
 *    condition.
 *  - join (`remove --bridge-all`, and a plain remove of a merge that does
 *    not synchronise): every predecessor of a node with several incoming
 *    flows and one outgoing flow goes to the successor (each incoming flow is
 *    re-pointed, keeping its id unless it named its ends, its label and
 *    condition; a predecessor already connected to the successor, or the
 *    successor itself, gets no second flow); a parallel / inclusive / complex
 *    join loses its synchronisation (W_IMPLICIT_JOIN says so), a plain remove
 *    refuses that (E_AMBIGUOUS_BRIDGE). Several outgoing flows are refused
 *    (E_AMBIGUOUS_BRIDGE: which predecessor to which successor?).
 *  - group (`move --in`): the one flow entering a group of nodes from outside
 *    and the one leaving it, like single for the group; the out-flow's id
 *    stays claimed for the rest of the command.
 *
 * A bridge from an event-based gateway to a target the file's rule does not
 * allow fails with E_INVALID_BRIDGE (EventGatewayRule), unless the successor
 * is removed by the same command.
 */
import type { Doc } from '../model/Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { kindOf, synchronises } from '../model/kinds.js';
import { is, type El, idOf } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { renamedNote } from '../model/utils/renames.js';
import { EventGatewayRule } from './EventGatewayRule.js';
import { SequenceFlows } from './SequenceFlows.js';

/**
 * A bridge single made: the node's in-flow (`flow`), now running to the
 * successor, the out-flow it replaced (`from`, removed) and what it took
 * over from that one: the name and the condition where it had none, the
 * associations of its annotations.
 */
export interface BridgedFlow {
  flow: El;
  from: El;
  took: { name?: string; condition?: El; associations: El[] };
}

/** The command that detaches (its hint differs: `move` has no --no-bridge). */
export type BridgeCommand = 'remove' | 'move';

/**
 * How a bridge carries the out-flow over: `node` (single) drops a condition
 * that would land on a default flow with a warning that says so; `group`
 * drops it with the plain W_CONDITION_DROPPED, re-parents a carried
 * condition and keeps the out-flow's id claimed.
 */
type CarryPolicy = 'node' | 'group';

export class Bridge {
  private readonly flows: SequenceFlows;

  constructor(
    private readonly doc: Doc,
    private readonly cs: ChangeSet,
    private readonly command: BridgeCommand = 'remove',
  ) {
    this.flows = new SequenceFlows(doc);
  }

  /**
   * The bridge of a flow node `remove` takes out: `all` (--bridge-all) joins
   * its predecessors, a plain remove (`bridge`) joins those of a merge that
   * does not synchronise and refuses a synchronising one, else single.
   * `removing`: the ids the command removes.
   */
  forRemoval(node: El, bridge: boolean, all: boolean, removing: ReadonlySet<string>): void {
    if (all) this.join(node, removing);
    else if (bridge && this.isMerge(node)) {
      this.refuseSynchronisingJoin(node);
      this.join(node, removing);
    } else this.single(node, bridge, removing);
  }

  /**
   * Removes every sequence flow of `node`; with `bridge` a node with one
   * incoming and one outgoing flow is bridged (see the class contract).
   * Returns the bridge (what it carried), or undefined when it did not bridge.
   */
  single(node: El, bridge: boolean, removing?: ReadonlySet<string>): BridgedFlow | undefined {
    const doc = this.doc;
    const incoming = doc.incoming(node);
    const outgoing = doc.outgoing(node);
    if (!bridge || incoming.length !== 1 || outgoing.length !== 1) return this.detach(node, bridge);
    const inFlow = incoming[0]!;
    const outFlow = outgoing[0]!;
    const predecessor = inFlow.get<El>('sourceRef');
    const successor = outFlow.get<El>('targetRef');
    if (predecessor === successor && !Bridge.canLoopToItself(predecessor)) {
      this.detach(node, false);
      if (predecessor !== node) this.cs.note(`not bridged: ${idOf(predecessor)} is both predecessor and successor of ${idOf(node)} and cannot loop back to itself`);
      return undefined;
    }
    this.assertAllowed(node, inFlow, outFlow, removing);
    return this.detach(node, true);
  }

  /**
   * Before a group of nodes leaves its scope: when exactly one flow enters the
   * group from outside and exactly one leaves it, the outer predecessor is
   * connected straight to the outer successor. Exception paths of the group's
   * boundary events are not exits (the move drops them).
   */
  group(group: El[]): void {
    const doc = this.doc;
    const inside = new Set<El>();
    for (const n of group) {
      inside.add(n);
      if (is(n, 'bpmn:Activity')) for (const b of doc.boundaryEventsOf(n)) inside.add(b);
    }
    const entries: El[] = [];
    const exits: El[] = [];
    for (const n of inside) {
      for (const f of doc.incoming(n)) if (!inside.has(f.get<El>('sourceRef'))) entries.push(f);
      if (is(n, 'bpmn:BoundaryEvent')) continue;
      for (const f of doc.outgoing(n)) if (!inside.has(f.get<El>('targetRef'))) exits.push(f);
    }
    if (entries.length !== 1 || exits.length !== 1) return;
    const inFlow = entries[0]!;
    const outFlow = exits[0]!;
    const predecessor = inFlow.get<El>('sourceRef');
    const successor = outFlow.get<El>('targetRef');
    if ((predecessor === successor && !Bridge.canLoopToItself(predecessor)) || doc.scopeOf(predecessor) !== doc.scopeOf(successor)) return;
    const via = group.map(idOf).join(', ');
    this.assertAllowed(outFlow.get<El>('sourceRef'), inFlow, outFlow, undefined, via);
    this.carry(inFlow, outFlow, via, 'group');
  }

  /** The self-loop rule of `connect`: only activities may loop back to themselves with a sequence flow. */
  private static canLoopToItself(node: El): boolean {
    return is(node, 'bpmn:Activity');
  }

  /** Removes every sequence flow of `node`, or (`bridge`) bridges one with one incoming and one outgoing flow. */
  private detach(node: El, bridge: boolean): BridgedFlow | undefined {
    const { doc, cs } = this;
    const incoming = doc.incoming(node);
    const outgoing = doc.outgoing(node);
    if (bridge && incoming.length === 1 && outgoing.length === 1) {
      const inFlow = incoming[0]!;
      const outFlow = outgoing[0]!;
      if (outFlow.get<El>('targetRef') !== node && inFlow.get<El>('sourceRef') !== node) return this.carry(inFlow, outFlow, idOf(node), 'node');
    }
    // a self-loop is both incoming and outgoing: remove and report it once
    for (const f of new Set([...incoming, ...outgoing])) {
      cs.remove(ChangeSet.flowEntryOf(f));
      this.flows.remove(f, cs);
    }
    return undefined;
  }

  /** `inFlow` takes over `outFlow` (removed) and runs on to its target; `via` names what is bridged. */
  private carry(inFlow: El, outFlow: El, via: string, policy: CarryPolicy): BridgedFlow {
    const { doc, cs } = this;
    const predecessor = inFlow.get<El>('sourceRef');
    const successor = outFlow.get<El>('targetRef');
    const outName = outFlow.get<string | undefined>('name');
    const outCond = outFlow.get<El | undefined>('conditionExpression');
    const took: BridgedFlow['took'] = { associations: [] };
    if (outName && !inFlow.get<string | undefined>('name')) {
      inFlow.set('name', outName);
      took.name = outName;
    } else if (outName) cs.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${idOf(outFlow)} was dropped while bridging ${via}`, element: idOf(outFlow) });
    const ontoDefault = predecessor.get<El | undefined>('default') === inFlow;
    if (outCond && !inFlow.get<El | undefined>('conditionExpression') && ontoDefault && policy === 'node') {
      cs.warn({
        code: 'W_CONDITION_DROPPED',
        message: `Condition of ${idOf(outFlow)} was dropped while bridging ${via}: ${idOf(inFlow)} is the default flow of ${idOf(predecessor)}`,
        element: idOf(outFlow),
        related: [idOf(inFlow)],
        hint: `A default flow has no condition; use \`bpmn set <file> ${idOf(inFlow)} condition=...\` if the condition should replace the default marker.`,
      });
    } else if (outCond && !inFlow.get<El | undefined>('conditionExpression') && !(ontoDefault && policy === 'group')) {
      inFlow.set('conditionExpression', outCond);
      if (policy === 'group') outCond.$parent = inFlow;
      else took.condition = outCond;
    } else if (outCond) cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(outFlow)} was dropped while bridging ${via}`, element: idOf(outFlow) });
    took.associations = this.flows.carryAssociations(outFlow, inFlow, cs);
    this.flows.remove(outFlow, cs);
    cs.remove(ChangeSet.flowEntryOf(outFlow));
    // the out-flow's id stays claimed for the rest of the move: a flow it creates afterwards must not reuse it
    if (policy === 'group' && idOf(outFlow) && !doc.has(idOf(outFlow))) doc.ids.claim(idOf(outFlow));
    const renamed = this.flows.redirect(inFlow, { target: successor });
    cs.change(ChangeSet.flowEntryOf(inFlow, `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${via})${renamedNote(renamed)}`));
    cs.note(`bridged: ${idOf(predecessor)} -> ${idOf(successor)}`);
    return { flow: inFlow, from: outFlow, took };
  }

  /**
   * --bridge-all: every predecessor of a join gets the join's successor. One
   * incoming flow is the ordinary bridge.
   */
  private join(node: El, removing: ReadonlySet<string>): void {
    const { doc, cs } = this;
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
    if (outName) cs.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${idOf(outFlow)} was dropped while bridging ${idOf(node)} from ${incoming.length} predecessors`, element: idOf(outFlow) });
    if (outFlow.get<El | undefined>('conditionExpression')) cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(outFlow)} was dropped while bridging ${idOf(node)} from ${incoming.length} predecessors`, element: idOf(outFlow) });
    this.flows.remove(outFlow, cs);
    cs.remove(ChangeSet.flowEntryOf(outFlow));
    const bridged: string[] = [];
    for (const inFlow of incoming) {
      const predecessor = inFlow.get<El>('sourceRef');
      const already = doc.outgoing(predecessor).some((f) => f !== inFlow && f.get<El | undefined>('targetRef') === successor);
      if (predecessor === successor || predecessor === node || already) {
        this.flows.remove(inFlow, cs);
        cs.remove(ChangeSet.flowEntryOf(inFlow));
        cs.note(`not bridged: ${idOf(predecessor)} ${predecessor === successor ? 'is the successor itself' : predecessor === node ? 'is the removed node' : `already flows to ${idOf(successor)}`}`);
        continue;
      }
      const renamed = this.flows.redirect(inFlow, { target: successor });
      cs.change(ChangeSet.flowEntryOf(inFlow, `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${idOf(node)})${renamedNote(renamed)}`));
      bridged.push(idOf(predecessor));
    }
    cs.note(`bridged all: ${bridged.join(', ')} -> ${idOf(successor)}`);
    const sync = synchronises(node);
    if (sync) cs.note(`${idOf(node)} synchronised ${bridged.join(', ')}; now each of them runs on to ${idOf(successor)} on its own`);
    const count = doc.incoming(successor).length;
    if (count > 1 && (sync || !is(successor, 'bpmn:Gateway'))) {
      cs.warn({
        code: 'W_IMPLICIT_JOIN',
        message: sync
          ? `${idOf(successor)} now has ${count} incoming flows: the ${Bridge.joinKind(node)} join ${idOf(node)} synchronised them, now each path runs on to ${idOf(successor)} on its own`
          : `${idOf(successor)} now has ${count} incoming flows (implicit join)`,
        element: idOf(successor),
        hint: sync ? `Keep a ${Bridge.joinKind(node)} join in front of ${idOf(successor)} if the paths must wait for each other.` : 'Consider joining through a gateway.',
      });
    }
  }

  /** A join or merge: several incoming flows, one outgoing (what join bridges). */
  private isMerge(node: El): boolean {
    return this.doc.incoming(node).length > 1 && this.doc.outgoing(node).length === 1;
  }

  /** A plain remove of a synchronising join: E_AMBIGUOUS_BRIDGE (bridging ends the synchronisation, not bridging disconnects the successor). */
  private refuseSynchronisingJoin(node: El): void {
    if (!synchronises(node)) return;
    const incoming = this.doc.incoming(node);
    const successor = this.doc.outgoing(node)[0]!.get<El>('targetRef');
    const preds = [...new Set(incoming.map((f) => idOf(f.get<El>('sourceRef'))))];
    throw modelError(
      'E_AMBIGUOUS_BRIDGE',
      `${idOf(node)} is a ${Bridge.joinKind(node)} join of ${incoming.length} paths (${preds.join(', ')}): bridging them to ${idOf(successor)} ends the synchronisation (${idOf(successor)} would run once per path), removing it without a bridge leaves ${idOf(successor)} unconnected`,
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
   * Refuses a bridge that would give an event-based gateway a target the
   * engines reject (EventGatewayRule.targetProblem): E_INVALID_BRIDGE. A successor
   * that the same command removes as well is not checked (its own removal
   * decides). `via` names what is bridged (the node, or a moved group).
   */
  private assertAllowed(node: El, inFlow: El, outFlow: El, removing?: ReadonlySet<string>, via: string = idOf(node)): void {
    const predecessor = inFlow.get<El>('sourceRef');
    const successor = outFlow.get<El>('targetRef');
    if (!is(predecessor, 'bpmn:EventBasedGateway') || successor === node) return;
    if (removing?.has(idOf(successor))) return;
    const rule = new EventGatewayRule(this.doc);
    const problem = rule.targetProblem(predecessor, successor, [outFlow, inFlow]);
    if (!problem) return;
    const catchFirst = `put an intermediate catch event (message / timer / signal / conditional) in front of ${idOf(successor)} first (\`bpmn add <file> intermediateCatchEvent:timer "<name>" --flow ${idOf(outFlow)} --timer PT1H\`)`;
    const rejectedBy = rule.rule === 'engines' ? 'which the engines reject' : 'which BPMN 2.0 does not allow';
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
