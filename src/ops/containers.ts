/**
 * Pools (participants / collaboration) and lanes.
 *
 *  - createParticipant(): the first participant in a file with exactly one
 *    process and no collaboration WRAPS that process (creates the
 *    bpmn:Collaboration as first root element, participant.processRef = the
 *    process). Further participants get a NEW empty process (id
 *    Process_<Slug>) unless op.process names an existing unbound process or
 *    op.blackBox is set. Participant ids: Participant_<Slug> (unnamed: the
 *    label of its process, or BlackBox). (Ids follow the file's style,
 *    src/idstyle.ts; the bpmn-cli default is given here.)
 *  - createLane(): creates the process' laneSet when missing (id
 *    LaneSet_<Process>), lane id Lane_<Slug>; op.in may be a process, participant or a lane
 *    (-> nested childLaneSet); op.members assigns nodes. The first child lane
 *    of a lane inherits ALL of the parent's members (a lane with child lanes
 *    has no direct members); members beyond op.members -> W_OPTION_IGNORED
 *    with the command that moves them into a sibling lane.
 *  - assignLane(): moves a flow node into `lane` (removing it from every other
 *    lane of the process); `undefined` removes lane membership. Boundary
 *    events follow their host. Nodes inside sub-processes are never lane
 *    members (E_INVALID_LANE_MEMBERSHIP).
 *  - laneOf(): the (deepest) lane referencing a node.
 */
import type { Doc } from '../document.js';
import { modelError } from '../errors.js';
import { kindByName, kindLabel } from '../kinds.js';
import { kindRequest, labelOf, typeRequest, type IdRequest } from '../idstyle.js';
import { addTo, insertInto, is, many, removeFrom, type El } from '../model.js';
import type { ChangeSet } from '../result.js';
import type { AddOp } from './types.js';

function idOf(el: El): string {
  return el.get<string>('id');
}

function nameOf(el: El): string | undefined {
  return el.get<string | undefined>('name');
}

/** Allocates an id: an explicit one is validated and claimed, else one in the file's style. */
function allocateId(doc: Doc, req: IdRequest, explicit: string | undefined): string {
  if (explicit) {
    doc.claimId(explicit);
    return explicit;
  }
  return doc.allocateId(req).id;
}

/* ------------------------------------------------------------------ */
/* participants                                                         */
/* ------------------------------------------------------------------ */

/** The collaboration, created as FIRST root element when missing. */
export function ensureCollaboration(doc: Doc, cs: ChangeSet): El {
  const existing = doc.collaboration();
  if (existing) return existing;
  const first = doc.processes()[0];
  const collab = doc.create('bpmn:Collaboration', { id: doc.allocateId(typeRequest('bpmn:Collaboration', { context: first ? labelOf(first) : '' })).id });
  insertInto(doc.definitions, 'rootElements', 0, collab);
  cs.create({ id: idOf(collab), kind: 'collaboration' });
  doc.invalidate();
  return collab;
}

/** Inserts a new process after the last root process (or after the collaboration). */
function insertProcess(doc: Doc, process: El): void {
  const roots = many(doc.definitions, 'rootElements');
  let idx = -1;
  roots.forEach((r, i) => {
    if (is(r, 'bpmn:Process') || is(r, 'bpmn:Collaboration')) idx = i;
  });
  insertInto(doc.definitions, 'rootElements', idx + 1, process);
}

function resolveParticipantProcess(doc: Doc, op: AddOp): { process?: El; mode: 'wrap' | 'bind' | 'new' | 'blackBox' } {
  if (op.blackBox) {
    if (op.process) {
      throw modelError('E_INVALID_VALUE', '--black-box and --process are mutually exclusive', { hint: 'A black box participant has no process.' });
    }
    return { mode: 'blackBox' };
  }
  if (op.process) {
    const process = doc.require(op.process, 'bpmn:Process', 'process');
    const bound = doc.participantOf(process);
    if (bound) {
      throw modelError('E_PROCESS_BOUND', `Process ${op.process} is already bound to participant ${idOf(bound)}`, {
        element: op.process,
        related: [idOf(bound)],
        hint: 'Omit --process to create a new process for the participant, or use --black-box.',
      });
    }
    return { process, mode: 'bind' };
  }
  if (!doc.collaboration()) {
    const unbound = doc.processes().filter((p) => !doc.participantOf(p));
    if (unbound.length === 1) return { process: unbound[0]!, mode: 'wrap' };
    if (unbound.length > 1) {
      throw modelError('E_AMBIGUOUS_SCOPE', `The file has ${unbound.length} processes; say which one the participant wraps with --process <processId>`, {
        candidates: unbound.map(idOf),
      });
    }
  }
  return { mode: 'new' };
}

/**
 * Creates a participant (pool). See module header for the wrapping rules.
 * Reports the participant, a created collaboration and a created process.
 */
export function createParticipant(doc: Doc, op: AddOp, cs: ChangeSet): El {
  const resolved = resolveParticipantProcess(doc, op);
  const context = resolved.process ? labelOf(resolved.process) : resolved.mode === 'blackBox' ? 'Black box' : 'Pool';
  const id = allocateId(doc, kindRequest(kindByName('participant')!, { ...(op.name ? { name: op.name } : {}), context }), op.id);
  const collab = ensureCollaboration(doc, cs);
  let process = resolved.process;
  if (resolved.mode === 'new') {
    const processId = doc.allocateId(typeRequest('bpmn:Process', { ...(op.name ? { name: op.name } : {}), context: id.slice(id.indexOf('_') + 1) })).id;
    process = doc.create('bpmn:Process', { id: processId, isExecutable: false });
    insertProcess(doc, process);
    cs.create({ id: processId, kind: 'process', detail: `for participant ${id} (not executable)` });
  }
  const participant = doc.create('bpmn:Participant', {
    id,
    ...(op.name ? { name: op.name } : {}),
    ...(process ? { processRef: process } : {}),
  });
  addTo(collab, 'participants', participant);
  const detail =
    resolved.mode === 'blackBox' ? 'black box (no process)' : resolved.mode === 'wrap' ? `wraps process ${idOf(process!)}` : `process ${idOf(process!)}`;
  cs.create({ id, kind: 'participant', ...(op.name ? { name: op.name } : {}), detail });
  if (resolved.mode === 'wrap') cs.note(`collaboration ${idOf(collab)} created; ${id} wraps the existing process ${idOf(process!)}`);
  doc.invalidate();
  return participant;
}

/* ------------------------------------------------------------------ */
/* lanes                                                                */
/* ------------------------------------------------------------------ */

function ensureLaneSet(doc: Doc, process: El, cs: ChangeSet): El {
  const sets = many(process, 'laneSets');
  if (sets[0]) return sets[0];
  const laneSet = doc.create('bpmn:LaneSet', { id: doc.allocateId(typeRequest('bpmn:LaneSet', { context: labelOf(process) })).id });
  addTo(process, 'laneSets', laneSet);
  cs.note(`created laneSet ${idOf(laneSet)} in ${idOf(process)}`);
  return laneSet;
}

function ensureChildLaneSet(doc: Doc, lane: El, cs: ChangeSet): El {
  const existing = lane.get<El | undefined>('childLaneSet');
  if (existing) return existing;
  const laneSet = doc.create('bpmn:LaneSet', { id: doc.allocateId(typeRequest('bpmn:LaneSet', { context: labelOf(lane) })).id });
  lane.set('childLaneSet', laneSet);
  laneSet.$parent = lane;
  cs.note(`created nested laneSet ${idOf(laneSet)} in lane ${idOf(lane)}`);
  return laneSet;
}

function resolveLaneContainer(doc: Doc, op: AddOp): { process: El; parentLane?: El } {
  if (!op.in) return { process: doc.defaultScope() };
  const container = doc.require(op.in, ['bpmn:Process', 'bpmn:Participant', 'bpmn:Lane', 'bpmn:SubProcess'], 'lane container');
  if (is(container, 'bpmn:SubProcess')) {
    throw modelError('E_INVALID_SCOPE', `Lanes can only be created at process level, not inside sub-process ${op.in}`, {
      element: op.in,
      hint: 'Use --in <processId|participantId|laneId>.',
    });
  }
  if (is(container, 'bpmn:Lane')) {
    const process = doc.processOf(container);
    if (!process) throw modelError('E_INVALID_SCOPE', `Lane ${op.in} is not inside a process`, { element: op.in });
    return { process, parentLane: container };
  }
  return { process: doc.requireScope(op.in) };
}

/**
 * Creates a lane in a process (or nested inside another lane). The first
 * child lane of a lane inherits the parent's members.
 */
export function createLane(doc: Doc, op: AddOp, cs: ChangeSet): El {
  const { process, parentLane } = resolveLaneContainer(doc, op);
  const id = allocateId(doc, kindRequest(kindByName('lane')!, { ...(op.name ? { name: op.name } : {}), context: `In ${labelOf(parentLane ?? process)}` }), op.id);
  const laneSet = parentLane ? ensureChildLaneSet(doc, parentLane, cs) : ensureLaneSet(doc, process, cs);
  const lane = doc.create('bpmn:Lane', { id, ...(op.name ? { name: op.name } : {}) });
  addTo(laneSet, 'lanes', lane);
  cs.create({ id, kind: 'lane', ...(op.name ? { name: op.name } : {}), detail: parentLane ? `in lane ${idOf(parentLane)}` : `in ${idOf(process)}` });
  let extra: El[] = [];
  if (parentLane && many(laneSet, 'lanes').length === 1) {
    const inherited = [...many(parentLane, 'flowNodeRef')];
    if (inherited.length) {
      for (const node of inherited) {
        removeFrom(parentLane, 'flowNodeRef', node);
        addTo(lane, 'flowNodeRef', node);
      }
      cs.note(`moved ${inherited.length} member(s) of ${idOf(parentLane)} into its first child lane ${id}`);
      if (op.members?.length) extra = inherited.filter((node) => !op.members!.includes(idOf(node)));
    }
  }
  if (!doc.participantOf(process)) {
    cs.warn({
      code: 'W_LANES_WITHOUT_POOL',
      message: `Process ${idOf(process)} has lanes but no participant; lanes are only drawn inside a pool`,
      element: id,
      hint: `Add a pool with \`add participant "<name>"\` (it wraps the existing process).`,
    });
  }
  for (const memberId of op.members ?? []) {
    assignLane(doc, doc.require(memberId, 'bpmn:FlowNode', 'flow node'), lane, cs);
  }
  if (extra.length && parentLane) {
    const extraIds = extra.map(idOf);
    cs.warn({
      code: 'W_OPTION_IGNORED',
      message: `--members ${op.members!.join(',')}: ${id} also received the other ${extra.length} member(s) of ${idOf(parentLane)} (${extraIds.join(', ')}), because a lane with child lanes has no direct members`,
      element: id,
      related: extraIds,
      hint: `Move them into a sibling lane: \`bpmn add lane "<name>" --in ${idOf(parentLane)} --members ${extraIds.join(',')}\`.`,
    });
  }
  doc.invalidate();
  return lane;
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

function assertLaneMember(doc: Doc, node: El): El {
  if (!is(node, 'bpmn:FlowNode')) {
    throw modelError('E_INVALID_LANE_MEMBERSHIP', `${idOf(node)} is a ${kindLabel(node)}; only flow nodes can be lane members`, { element: idOf(node) });
  }
  const scope = doc.scopeOf(node);
  if (!scope || !is(scope, 'bpmn:Process')) {
    throw modelError('E_INVALID_LANE_MEMBERSHIP', `${idOf(node)} is inside sub-process ${scope ? idOf(scope) : '?'}; nodes inside sub-processes cannot be lane members`, {
      element: idOf(node),
      hint: 'Only nodes directly in the process can be assigned to lanes; the sub-process itself can.',
    });
  }
  return scope;
}

/**
 * Assigns a node to `lane` (or to no lane with `undefined`). The node leaves
 * every other lane of its process; attached boundary events follow.
 */
export function assignLane(doc: Doc, node: El, lane: El | undefined, cs: ChangeSet): void {
  const process = assertLaneMember(doc, node);
  if (lane) {
    if (!is(lane, 'bpmn:Lane')) {
      throw modelError('E_WRONG_KIND', `${idOf(lane)} is a ${kindLabel(lane)}, expected a lane`, { element: idOf(lane) });
    }
    if (doc.processOf(lane) !== process) {
      throw modelError('E_INVALID_LANE_MEMBERSHIP', `Lane ${idOf(lane)} belongs to another process than ${idOf(node)} (${idOf(process)})`, {
        element: idOf(node),
        related: [idOf(lane)],
        hint: 'Nodes can only join lanes of their own process.',
      });
    }
    const childSet = lane.get<El | undefined>('childLaneSet');
    const children = childSet ? many(childSet, 'lanes') : [];
    if (children.length) {
      throw modelError('E_INVALID_LANE_MEMBERSHIP', `Lane ${idOf(lane)} has child lanes; assign ${idOf(node)} to one of them`, {
        element: idOf(node),
        related: [idOf(lane)],
        candidates: children.map(idOf),
      });
    }
  }
  const current = doc.lanesOf(node);
  const unchanged = lane ? current.length === 1 && current[0] === lane : current.length === 0;
  if (!unchanged) {
    for (const other of current) removeFrom(other, 'flowNodeRef', node);
    if (lane) addTo(lane, 'flowNodeRef', node);
    const name = nameOf(node);
    cs.change({ id: idOf(node), kind: kindLabel(node), ...(name ? { name } : {}), detail: lane ? `lane ${idOf(lane)}` : 'removed from lanes' });
  }
  if (is(node, 'bpmn:Activity')) {
    for (const boundary of doc.boundaryEventsOf(node)) assignLane(doc, boundary, lane, cs);
  }
  doc.invalidate();
}
