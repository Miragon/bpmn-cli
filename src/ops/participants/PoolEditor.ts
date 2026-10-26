import type { Doc } from '../../model/Doc.js';
import { modelError } from '../../shared/utils/errors.js';
import { kindByName } from '../../model/utils/kinds.js';
import { ElementLabels } from '../../ids/ElementLabels.js';
import { kindRequest, typeRequest } from '../../ids/utils/requests.js';
import { addTo, insertInto, is, many, type El, idOf } from '../../model/utils/moddle.js';
import type { ChangeSet } from '../../model/ChangeSet.js';
import { allocateId } from '../utils/allocate-id.js';
import type { AddOp } from '../types.js';

/**
 * Creates pools. The first participant in a file with one process and no collaboration
 * wraps that process; further ones get a new empty process unless bound or black-box.
 */
export class PoolEditor {
  constructor(private readonly doc: Doc) {}

  createParticipant(op: AddOp, cs: ChangeSet): El {
    const doc = this.doc;
    const resolved = this.resolveParticipantProcess(op);
    const context = resolved.process ? new ElementLabels(resolved.process).label() : resolved.mode === 'blackBox' ? 'Black box' : 'Pool';
    const id = allocateId(doc, kindRequest(kindByName('participant')!, { ...(op.name ? { name: op.name } : {}), context }), op.id);
    const collab = this.ensureCollaboration(cs);
    let process = resolved.process;
    if (resolved.mode === 'new') {
      const processId = doc.allocateId(typeRequest('bpmn:Process', { ...(op.name ? { name: op.name } : {}), context: id.slice(id.indexOf('_') + 1) })).id;
      process = doc.create('bpmn:Process', { id: processId, isExecutable: false });
      this.insertProcess(process);
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

  /** Created as the first root element when missing. */
  private ensureCollaboration(cs: ChangeSet): El {
    const doc = this.doc;
    const existing = doc.collaboration();
    if (existing) return existing;
    const first = doc.processes()[0];
    const collab = doc.create('bpmn:Collaboration', { id: doc.allocateId(typeRequest('bpmn:Collaboration', { context: first ? new ElementLabels(first).label() : '' })).id });
    insertInto(doc.definitions, 'rootElements', 0, collab);
    cs.create({ id: idOf(collab), kind: 'collaboration' });
    doc.invalidate();
    return collab;
  }

  private insertProcess(process: El): void {
    const roots = many(this.doc.definitions, 'rootElements');
    let idx = -1;
    roots.forEach((root, index) => {
      if (is(root, 'bpmn:Process') || is(root, 'bpmn:Collaboration')) idx = index;
    });
    insertInto(this.doc.definitions, 'rootElements', idx + 1, process);
  }

  private resolveParticipantProcess(op: AddOp): { process?: El; mode: 'wrap' | 'bind' | 'new' | 'blackBox' } {
    const doc = this.doc;
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
