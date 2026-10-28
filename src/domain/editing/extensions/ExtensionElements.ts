import type { EditSession } from '../../document/EditSession.js';
import { usageError } from '../../document/utils/errors.js';
import type { ChangeSet } from '../../document/ChangeSet.js';
import { idOf } from '../../document/utils/elements.js';
import { ExtensionInserter } from './ExtensionInserter.js';
import { ExtensionRemover } from './ExtensionRemover.js';
import { NESTED_HOSTS } from '../properties/NestedHosts.js';
import { ZeebeSubscription } from '../events/ZeebeSubscription.js';
import type { EditExtensionElements } from '../../commands/types.js';

/**
 * `ext add` / `ext remove`: vendor extension elements inside <bpmn:extensionElements>.
 * Vendor content stays generic in the model; this knows just enough of its structure
 * never to write a file the engines reject or ignore.
 */
export class ExtensionElements {
  constructor(private readonly edit: EditSession) {}

  /** Adds or removes extension elements; a correlation key goes to the message the event waits for, where Camunda 8 reads it. */
  apply(command: EditExtensionElements): ChangeSet {
    const doc = this.edit.doc;
    let owner = this.edit.require(command.id);
    if (command.action !== 'add' && command.action !== 'remove') throw usageError(`Unknown ext action "${String(command.action)}"; use add or remove`, { element: command.id });
    const notes: string[] = [];
    const subscription = new ZeebeSubscription(doc);
    const message = subscription.messageFor(owner, command);
    if (message) {
      notes.push(subscription.note(owner, message, `${subscription.addedTypeText(command)}`));
      const split = command.type ? NESTED_HOSTS.splitSlot(command.type) : undefined;
      const { slot: _slot, ...rest } = command;
      command = { ...rest, id: idOf(message), ...(split ? { type: split.rest } : {}) };
      owner = message;
    }
    const { host, command: inner } = NESTED_HOSTS.resolve(this.edit, owner, NESTED_HOSTS.normalizeIndex(command), notes);
    const changes = inner.action === 'add' ? new ExtensionInserter(doc).add(host, inner) : new ExtensionRemover(doc).remove(host, inner);
    for (const note of notes) changes.note(note);
    return changes;
  }
}
