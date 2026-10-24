/**
 * Detaching a node from its sequence flows (ops/remove.ts, ops/move.ts).
 */
import type { Doc } from '../model/Doc.js';
import { type El, idOf } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { renamedNote } from '../model/utils/renames.js';
import { SequenceFlows } from './SequenceFlows.js';

/**
 * A bridge detachNode made: the node's in-flow (`flow`), now running to the
 * successor, the out-flow it replaced (`from`, removed) and what it took
 * over from that one: the name and the condition where it had none, the
 * associations of its annotations.
 */
export interface Bridge {
  flow: El;
  from: El;
  took: { name?: string; condition?: El; associations: El[] };
}

/**
 * Removes every sequence flow of `node`. With `bridge`, a node with exactly
 * one incoming and one outgoing flow is bypassed: the incoming flow is
 * retargeted to the successor (label/condition of the outgoing flow are
 * carried over when the incoming flow has none). Returns the bridge, or
 * undefined when it did not bridge.
 */
export function detachNode(doc: Doc, node: El, bridge: boolean, cs: ChangeSet): Bridge | undefined {
  const incoming = doc.incoming(node);
  const outgoing = doc.outgoing(node);
  if (bridge && incoming.length === 1 && outgoing.length === 1) {
    const inFlow = incoming[0]!;
    const outFlow = outgoing[0]!;
    const successor = outFlow.get<El>('targetRef');
    const predecessor = inFlow.get<El>('sourceRef');
    if (successor !== node && predecessor !== node) {
      const outName = outFlow.get<string | undefined>('name');
      const outCond = outFlow.get<El | undefined>('conditionExpression');
      const took: Bridge['took'] = { associations: [] };
      if (outName && !inFlow.get<string | undefined>('name')) {
        inFlow.set('name', outName);
        took.name = outName;
      } else if (outName) cs.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${idOf(outFlow)} was dropped while bridging ${idOf(node)}`, element: idOf(outFlow) });
      if (outCond && !inFlow.get<El | undefined>('conditionExpression')) {
        inFlow.set('conditionExpression', outCond);
        took.condition = outCond;
      } else if (outCond) cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(outFlow)} was dropped while bridging ${idOf(node)}`, element: idOf(outFlow) });
      took.associations = new SequenceFlows(doc).carryAssociations(outFlow, inFlow, cs);
      new SequenceFlows(doc).remove(outFlow, cs);
      cs.remove(ChangeSet.flowEntryOf(outFlow));
      const renamed = new SequenceFlows(doc).redirect(inFlow, { target: successor });
      cs.change(ChangeSet.flowEntryOf(inFlow, `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${idOf(node)})${renamedNote(renamed)}`));
      cs.note(`bridged: ${idOf(predecessor)} -> ${idOf(successor)}`);
      return { flow: inFlow, from: outFlow, took };
    }
  }
  // a self-loop is both incoming and outgoing: remove and report it once
  for (const f of new Set([...incoming, ...outgoing])) {
    cs.remove(ChangeSet.flowEntryOf(f));
    new SequenceFlows(doc).remove(f, cs);
  }
  return undefined;
}
