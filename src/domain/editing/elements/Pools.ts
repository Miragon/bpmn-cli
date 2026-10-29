import type { EditSession } from '../../document/EditSession.js';
import { modelError } from '../../document/utils/errors.js';
import { kindByName } from '../../document/Kinds.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { kindRequest, typeRequest } from '../../document/utils/requests.js';
import { addTo, insertInto, is, many, type El, idOf } from '../../document/utils/moddle.js';
import type { ChangeSet } from '../../document/ChangeSet.js';
import type { AddElement } from '../../commands/types.js';

/**
 * Creates pools. The first participant in a file with one process and no collaboration
 * wraps that process; further ones get a new empty process unless bound or black-box.
 */
export class Pools {
  constructor(private readonly edit: EditSession) {}

  createParticipant(command: AddElement, changes: ChangeSet): El {
    const doc = this.edit.doc;
    const resolved = this.resolveParticipantProcess(command);
    const context = resolved.process ? new ElementLabels(resolved.process).label() : resolved.mode === 'blackBox' ? 'Black box' : 'Pool';
    const id = this.edit.allocator.explicitOr(command.id, kindRequest(kindByName('participant')!, { ...(command.name ? { name: command.name } : {}), context }));
    const collab = this.ensureCollaboration(changes);
    let process = resolved.process;
    if (resolved.mode === 'new') {
      const processId = this.edit.allocator.allocate(typeRequest('bpmn:Process', { ...(command.name ? { name: command.name } : {}), context: id.slice(id.indexOf('_') + 1) })).id;
      process = doc.create('bpmn:Process', { id: processId, isExecutable: false });
      this.insertProcess(process);
      changes.create({ id: processId, kind: 'process', detail: `for participant ${id} (not executable)` });
    }
    const participant = doc.create('bpmn:Participant', {
      id,
      ...(command.name ? { name: command.name } : {}),
      ...(process ? { processRef: process } : {}),
    });
    addTo(collab, 'participants', participant);
    const detail =
      resolved.mode === 'blackBox' ? 'black box (no process)' : resolved.mode === 'wrap' ? `wraps process ${idOf(process!)}` : `process ${idOf(process!)}`;
    changes.create({ id, kind: 'participant', ...(command.name ? { name: command.name } : {}), detail });
    if (resolved.mode === 'wrap') {
      changes.note(`collaboration ${idOf(collab)} created; ${id} wraps the existing process ${idOf(process!)}`);
    }
    doc.invalidate();
    return participant;
  }

  /** Created as the first root element when missing. */
  private ensureCollaboration(changes: ChangeSet): El {
    const doc = this.edit.doc;
    const existing = doc.collaboration();
    if (existing) return existing;
    const first = doc.processes()[0];
    const collab = doc.create('bpmn:Collaboration', { id: this.edit.allocator.allocate(typeRequest('bpmn:Collaboration', { context: first ? new ElementLabels(first).label() : '' })).id });
    insertInto(doc.definitions, 'rootElements', 0, collab);
    changes.create({ id: idOf(collab), kind: 'collaboration' });
    doc.invalidate();
    return collab;
  }

  private insertProcess(process: El): void {
    const roots = many(this.edit.doc.definitions, 'rootElements');
    let idx = -1;
    roots.forEach((root, index) => {
      if (is(root, 'bpmn:Process') || is(root, 'bpmn:Collaboration')) idx = index;
    });
    insertInto(this.edit.doc.definitions, 'rootElements', idx + 1, process);
  }

  private resolveParticipantProcess(command: AddElement): { process?: El; mode: 'wrap' | 'bind' | 'new' | 'blackBox' } {
    const doc = this.edit.doc;
    if (command.blackBox) {
      if (command.process) {
        throw modelError('E_INVALID_VALUE', '--black-box and --process are mutually exclusive', { hint: 'A black box participant has no process.' });
      }
      return { mode: 'blackBox' };
    }
    if (command.process) {
      const process = this.edit.require(command.process, 'bpmn:Process', 'process');
      const bound = doc.participantOf(process);
      if (bound) {
        throw modelError('E_PROCESS_BOUND', `Process ${command.process} is already bound to participant ${idOf(bound)}`, {
          element: command.process,
          related: [idOf(bound)],
          hint: 'Omit --process to create a new process for the participant, or use --black-box.',
        });
      }
      return { process, mode: 'bind' };
    }
    if (!doc.collaboration()) {
      const unbound = doc.processes().filter((process) => !doc.participantOf(process));
      if (unbound.length === 1) return { process: unbound[0]!, mode: 'wrap' };
      if (unbound.length > 1) {
        throw modelError('E_AMBIGUOUS_SCOPE', `The file has ${unbound.length} processes; say which one the participant wraps with --process <processId>`, {
          candidates: unbound.map(idOf),
        });
      }
    }
    return { mode: 'new' };
  }
}
