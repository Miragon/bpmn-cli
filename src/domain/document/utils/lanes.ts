import type { Doc } from '../Doc.js';
import { is, many, type El } from './moddle.js';

/** Nested lanes included, deepest last. */
export function allLanes(process: El): El[] {
  const out: El[] = [];
  const visit = (laneSet: El | undefined): void => {
    if (!laneSet) return;
    for (const lane of many(laneSet, 'lanes')) {
      out.push(lane);
      visit(lane.get<El | undefined>('childLaneSet'));
    }
  };
  for (const ls of many(process, 'laneSets')) visit(ls);
  return out;
}

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
