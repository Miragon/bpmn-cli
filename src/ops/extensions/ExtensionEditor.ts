import type { Doc } from '../../model/Doc.js';
import { usageError } from '../../shared/utils/errors.js';
import type { ChangeSet } from '../../model/ChangeSet.js';
import { idOf } from '../../model/utils/elements.js';
import { ExtensionInserter } from './ExtensionInserter.js';
import { ExtensionRemover } from './ExtensionRemover.js';
import { NESTED_HOSTS } from '../NestedHosts.js';
import { ZeebeSubscription } from '../events/ZeebeSubscription.js';
import type { ExtOp } from '../types.js';

/**
 * `ext add` / `ext remove`: vendor extension elements inside <bpmn:extensionElements>.
 * Vendor content stays generic in the model; this knows just enough of its structure
 * never to write a file the engines reject or ignore.
 */
export class ExtensionEditor {
  constructor(private readonly doc: Doc) {}

  apply(op: ExtOp): ChangeSet {
    const doc = this.doc;
    let owner = doc.require(op.id);
    if (op.action !== 'add' && op.action !== 'remove') throw usageError(`Unknown ext action "${String(op.action)}"; use add or remove`, { element: op.id });
    const notes: string[] = [];
    // Camunda 8 reads a correlation key on the message, not on the event that waits for it
    const subscription = new ZeebeSubscription(doc);
    const message = subscription.messageFor(owner, op);
    if (message) {
      notes.push(subscription.note(owner, message, `${subscription.addedTypeText(op)}`));
      const split = op.type ? NESTED_HOSTS.splitSlot(op.type) : undefined;
      const { slot: _slot, ...rest } = op;
      op = { ...rest, id: idOf(message), ...(split ? { type: split.rest } : {}) };
      owner = message;
    }
    const { host, op: inner } = NESTED_HOSTS.resolve(doc, owner, NESTED_HOSTS.normalizeIndex(op), notes);
    const cs = inner.action === 'add' ? new ExtensionInserter(doc).add(host, inner) : new ExtensionRemover(doc).remove(host, inner);
    for (const n of notes) cs.note(n);
    return cs;
  }
}
