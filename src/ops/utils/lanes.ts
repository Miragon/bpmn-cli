import type { Doc } from '../../model/Doc.js';
import { is, type El } from '../../model/utils/moddle.js';

/** The lane set whose lanes `owner` orders: a process's (first), a participant's process's, a lane's child lanes. */
export function laneSetOf(owner: El): El | undefined {
  if (is(owner, 'bpmn:Lane')) return owner.get<El | undefined>('childLaneSet');
  const process = is(owner, 'bpmn:Participant') ? owner.get<El | undefined>('processRef') : owner;
  if (!process) return undefined;
  return (process.get<El[] | undefined>('laneSets') ?? [])[0];
}

function laneDepth(lane: El): number {
  let depth = 0;
  let p = lane.$parent as El | undefined;
  while (p && !is(p, 'bpmn:Process')) {
    if (is(p, 'bpmn:Lane')) depth++;
    p = p.$parent as El | undefined;
  }
  return depth;
}

/** The deepest lane referencing a node (undefined when it is in no lane). */
export function laneOf(doc: Doc, node: El): El | undefined {
  const lanes = doc.lanesOf(node);
  let best: El | undefined;
  let bestDepth = -1;
  for (const lane of lanes) {
    const depth = laneDepth(lane);
    if (depth > bestDepth) {
      best = lane;
      bestDepth = depth;
    }
  }
  return best;
}
