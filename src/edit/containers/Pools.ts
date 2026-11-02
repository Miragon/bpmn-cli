import { type BpmnElement, BpmnError, type ChangeSet, ElementLabels, IdRequests, Kinds } from '../../model/index.js';
import type { AddOperation } from '../../operations/index.js';
import type { EditSession } from '../session/EditSession.js';

interface ParticipantProcess {
  process?: BpmnElement;
  mode: 'wrap' | 'bind' | 'new' | 'blackBox';
}

export class Pools {
  constructor(private readonly edit: EditSession) {}

  createParticipant(command: AddOperation, changes: ChangeSet): BpmnElement {
    const document = this.edit.document;
    const resolved = this.resolveParticipantProcess(command);
    const context = Pools.contextOf(resolved);
    const id = this.edit.allocator.explicitOr(command.id, IdRequests.kindRequest(Kinds.byName('participant')!, { ...(command.name ? { name: command.name } : {}), context }));
    const collab = this.ensureCollaboration(changes);
    let process = resolved.process;
    if (resolved.mode === 'new') {
      const processId = this.edit.allocator.allocate(IdRequests.typeRequest('bpmn:Process', { ...(command.name ? { name: command.name } : {}), context: id.slice(id.indexOf('_') + 1) })).id;
      process = document.tree.create('bpmn:Process', { id: processId, isExecutable: false });
      this.insertProcess(process);
      changes.create({ id: processId, kind: 'process', detail: `for participant ${id} (not executable)` });
    }
    const participant = document.tree.create('bpmn:Participant', {
      id,
      ...(command.name ? { name: command.name } : {}),
      ...(process ? { processRef: process } : {}),
    });
    collab.add('participants', participant);
    changes.create({ id, kind: 'participant', ...(command.name ? { name: command.name } : {}), detail: Pools.detailOf(resolved.mode, process) });
    if (resolved.mode === 'wrap') {
      changes.note(`collaboration ${collab.id} created; ${id} wraps the existing process ${process!.id}`);
    }
    document.tree.invalidate();
    return participant;
  }

  private static contextOf({ process, mode }: ParticipantProcess): string {
    if (process) {
      return new ElementLabels(process).label();
    }
    return mode === 'blackBox' ? 'Black box' : 'Pool';
  }

  private static detailOf(mode: ParticipantProcess['mode'], process: BpmnElement | undefined): string {
    if (mode === 'blackBox') {
      return 'black box (no process)';
    }
    return mode === 'wrap' ? `wraps process ${process!.id}` : `process ${process!.id}`;
  }

  private ensureCollaboration(changes: ChangeSet): BpmnElement {
    const document = this.edit.document;
    const existing = document.tree.collaboration();
    if (existing) {
      return existing;
    }
    const first = document.tree.processes()[0];
    const collab = document.tree.create('bpmn:Collaboration', { id: this.edit.allocator.allocate(IdRequests.typeRequest('bpmn:Collaboration', { context: first ? new ElementLabels(first).label() : '' })).id });
    document.tree.definitions.insert('rootElements', 0, collab);
    changes.create({ id: collab.id, kind: 'collaboration' });
    document.tree.invalidate();
    return collab;
  }

  private insertProcess(process: BpmnElement): void {
    const roots = this.edit.document.tree.definitions.list('rootElements');
    let idx = -1;
    roots.forEach((root, index) => {
      if (root.is('bpmn:Process') || root.is('bpmn:Collaboration')) {
        idx = index;
      }
    });
    this.edit.document.tree.definitions.insert('rootElements', idx + 1, process);
  }

  private resolveParticipantProcess(command: AddOperation): ParticipantProcess {
    const document = this.edit.document;
    if (command.blackBox) {
      if (command.process) {
        throw BpmnError.model('E_INVALID_VALUE', '--black-box and --process are mutually exclusive', { hint: 'A black box participant has no process.' });
      }
      return { mode: 'blackBox' };
    }
    if (command.process) {
      const process = this.edit.require(command.process, 'bpmn:Process', 'process');
      const bound = document.flows.participantOf(process);
      if (bound) {
        throw BpmnError.model('E_PROCESS_BOUND', `Process ${command.process} is already bound to participant ${bound.id}`, {
          element: command.process,
          related: [bound.id],
          hint: 'Omit --process to create a new process for the participant, or use --black-box.',
        });
      }
      return { process, mode: 'bind' };
    }
    if (!document.tree.collaboration()) {
      const processes = document.tree.processes();
      if (processes.length === 1) {
        return { process: processes[0]!, mode: 'wrap' };
      }
      if (processes.length > 1) {
        throw BpmnError.model('E_AMBIGUOUS_SCOPE', `The file has ${processes.length} processes; say which one the participant wraps with --process <processId>`, {
          candidates: processes.map((element) => element.id),
        });
      }
    }
    return { mode: 'new' };
  }
}
