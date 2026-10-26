import type { Doc } from '../Doc.js';
import { is, type El } from './moddle.js';

export function laneSetOf(owner: El): El | undefined {
  if (is(owner, 'bpmn:Lane')) return owner.get<El | undefined>('childLaneSet');
  const process = is(owner, 'bpmn:Participant') ? owner.get<El | undefined>('processRef') : owner;
  if (!process) return undefined;
  return (process.get<El[] | undefined>('laneSets') ?? [])[0];
}

function laneDepth(lane: El): number {
  let depth = 0;
  let ancestor = lane.$parent as El | undefined;
  while (ancestor && !is(ancestor, 'bpmn:Process')) {
    if (is(ancestor, 'bpmn:Lane')) depth++;
    ancestor = ancestor.$parent as El | undefined;
  }
  return depth;
}

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
