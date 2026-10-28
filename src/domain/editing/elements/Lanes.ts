import type { EditSession } from '../../document/EditSession.js';
import { modelError } from '../../document/utils/errors.js';
import { kindByName, kindLabel } from '../../document/Kinds.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { kindRequest, typeRequest } from '../../document/utils/requests.js';
import { addTo, is, many, type El, idOf, nameOf, removeFrom } from '../../document/utils/moddle.js';
import type { ChangeSet } from '../../document/ChangeSet.js';
import type { AddElement } from '../../commands/types.js';

/**
 * Creates lanes and assigns flow nodes to them. A lane with child lanes has no direct
 * members, and nodes inside sub-processes are never lane members.
 */
export class Lanes {
  constructor(private readonly edit: EditSession) {}

  /** The first child lane of a lane inherits all of the parent's members. */
  createLane(command: AddElement, changes: ChangeSet): El {
    const doc = this.edit.doc;
    const { process, parentLane } = this.resolveLaneContainer(command);
    const id = this.edit.allocator.explicitOr(command.id, kindRequest(kindByName('lane')!, { ...(command.name ? { name: command.name } : {}), context: new ElementLabels(parentLane ?? process).context('In') }));
    const laneSet = parentLane ? this.ensureChildLaneSet(parentLane, changes) : this.ensureLaneSet(process, changes);
    const lane = doc.create('bpmn:Lane', { id, ...(command.name ? { name: command.name } : {}) });
    addTo(laneSet, 'lanes', lane);
    changes.create({ id, kind: 'lane', ...(command.name ? { name: command.name } : {}), detail: parentLane ? `in lane ${idOf(parentLane)}` : `in ${idOf(process)}` });
    let extra: El[] = [];
    if (parentLane && many(laneSet, 'lanes').length === 1) {
      const inherited = [...many(parentLane, 'flowNodeRef')];
      if (inherited.length) {
        for (const node of inherited) {
          removeFrom(parentLane, 'flowNodeRef', node);
          addTo(lane, 'flowNodeRef', node);
        }
        changes.note(`moved ${inherited.length} member(s) of ${idOf(parentLane)} into its first child lane ${id}`);
        if (command.members?.length) extra = inherited.filter((node) => !command.members!.includes(idOf(node)));
      }
    }
    if (!doc.participantOf(process)) {
      changes.warn({
        code: 'W_LANES_WITHOUT_POOL',
        message: `Process ${idOf(process)} has lanes but no participant; lanes are only drawn inside a pool`,
        element: id,
        hint: `Add a pool with \`add participant "<name>"\` (it wraps the existing process).`,
      });
    }
    for (const memberId of command.members ?? []) {
      this.assign(this.edit.require(memberId, 'bpmn:FlowNode', 'flow node'), lane, changes);
    }
    if (extra.length && parentLane) {
      const extraIds = extra.map(idOf);
      changes.warn({
        code: 'W_OPTION_IGNORED',
        message: `--members ${command.members!.join(',')}: ${id} also received the other ${extra.length} member(s) of ${idOf(parentLane)} (${extraIds.join(', ')}), because a lane with child lanes has no direct members`,
        element: id,
        related: extraIds,
        hint: `Move them into a sibling lane: \`bpmn add <file> lane "<name>" --in ${idOf(parentLane)} --members ${extraIds.join(',')}\`.`,
      });
    }
    doc.invalidate();
    return lane;
  }

  /** `undefined` removes the lane membership; attached boundary events follow. */
  assign(node: El, lane: El | undefined, changes: ChangeSet): void {
    const doc = this.edit.doc;
    const process = this.assertLaneMember(node);
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
      changes.change({ id: idOf(node), kind: kindLabel(node), ...(name ? { name } : {}), detail: lane ? `lane ${idOf(lane)}` : 'removed from lanes' });
    }
    if (is(node, 'bpmn:Activity')) {
      for (const boundary of doc.boundaryEventsOf(node)) this.assign(boundary, lane, changes);
    }
    doc.invalidate();
  }

  private ensureLaneSet(process: El, changes: ChangeSet): El {
    const sets = many(process, 'laneSets');
    if (sets[0]) return sets[0];
    const laneSet = this.edit.doc.create('bpmn:LaneSet', { id: this.edit.allocator.allocate(typeRequest('bpmn:LaneSet', { context: new ElementLabels(process).label() })).id });
    addTo(process, 'laneSets', laneSet);
    changes.note(`created laneSet ${idOf(laneSet)} in ${idOf(process)}`);
    return laneSet;
  }

  private ensureChildLaneSet(lane: El, changes: ChangeSet): El {
    const existing = lane.get<El | undefined>('childLaneSet');
    if (existing) return existing;
    const laneSet = this.edit.doc.create('bpmn:LaneSet', { id: this.edit.allocator.allocate(typeRequest('bpmn:LaneSet', { context: new ElementLabels(lane).label() })).id });
    lane.set('childLaneSet', laneSet);
    laneSet.$parent = lane;
    changes.note(`created nested laneSet ${idOf(laneSet)} in lane ${idOf(lane)}`);
    return laneSet;
  }

  private resolveLaneContainer(command: AddElement): { process: El; parentLane?: El } {
    const doc = this.edit.doc;
    if (!command.in) return { process: doc.defaultScope() };
    const container = this.edit.require(command.in, ['bpmn:Process', 'bpmn:Participant', 'bpmn:Lane', 'bpmn:SubProcess'], 'lane container');
    if (is(container, 'bpmn:SubProcess')) {
      throw modelError('E_INVALID_SCOPE', `Lanes can only be created at process level, not inside sub-process ${command.in}`, {
        element: command.in,
        hint: 'Use --in <processId|participantId|laneId>.',
      });
    }
    if (is(container, 'bpmn:Lane')) {
      const process = doc.processOf(container);
      if (!process) throw modelError('E_INVALID_SCOPE', `Lane ${command.in} is not inside a process`, { element: command.in });
      return { process, parentLane: container };
    }
    return { process: this.edit.requireScope(command.in) };
  }

  private assertLaneMember(node: El): El {
    if (!is(node, 'bpmn:FlowNode')) {
      throw modelError('E_INVALID_LANE_MEMBERSHIP', `${idOf(node)} is a ${kindLabel(node)}; only flow nodes can be lane members`, { element: idOf(node) });
    }
    const scope = this.edit.doc.scopeOf(node);
    if (!scope || !is(scope, 'bpmn:Process')) {
      throw modelError('E_INVALID_LANE_MEMBERSHIP', `${idOf(node)} is inside sub-process ${scope ? idOf(scope) : '?'}; nodes inside sub-processes cannot be lane members`, {
        element: idOf(node),
        hint: 'Only nodes directly in the process can be assigned to lanes; the sub-process itself can.',
      });
    }
    return scope;
  }
}
