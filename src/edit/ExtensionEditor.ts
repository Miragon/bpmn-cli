import type { ChangeSet } from '../model/index.js';
import type { ExtOperation } from '../operations/index.js';
import { ZeebeSubscription } from './events/ZeebeSubscription.js';
import { ExtensionInserter } from './extensions/ExtensionInserter.js';
import { ExtensionRemover } from './extensions/ExtensionRemover.js';
import { NestedHosts } from './extensions/NestedHosts.js';
import type { EditSession } from './session/EditSession.js';

export class ExtensionEditor {
  constructor(private readonly edit: EditSession) {}

  apply(command: ExtOperation): ChangeSet {
    const document = this.edit.document;
    let owner = this.edit.require(command.id);
    const notes: string[] = [];
    const subscription = new ZeebeSubscription(document);
    const message = subscription.messageFor(owner, command);
    if (message) {
      notes.push(subscription.note(owner, message, subscription.addedTypeText(command)));
      const split = command.type ? NestedHosts.INSTANCE.splitSlot(command.type) : undefined;
      const { slot: _slot, ...rest } = command;
      command = { ...rest, id: message.id, ...(split ? { type: split.rest } : {}) };
      owner = message;
    }
    const { host, command: inner } = NestedHosts.INSTANCE.resolve(this.edit, owner, NestedHosts.INSTANCE.normalizeIndex(command), notes);
    const changes = inner.action === 'add' ? new ExtensionInserter(document).add(host, inner) : new ExtensionRemover(document).remove(host, inner);
    for (const note of notes) {
      changes.note(note);
    }
    return changes;
  }
}
