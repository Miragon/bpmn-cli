import type { Doc } from '../../document/Doc.js';
import { modelError } from '../../document/utils/errors.js';
import { is, walk, type El } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { kindLabel } from '../../document/Kinds.js';
import { definitionsOf } from '../../document/utils/nested-slots.js';
import { idOf } from '../../document/utils/elements.js';
import { ExtensionInserter } from '../extensions/ExtensionInserter.js';
import { NESTED_HOSTS } from '../properties/NestedHosts.js';
import { VendorElements } from '../properties/VendorElements.js';
import type { EditExtensionElements } from '../../commands/types.js';
import { ZEEBE_URI } from '../../document/vendor/ZeebeDescriptor.js';

/**
 * Moves zeebe:subscription and its correlation key to the bpmn:Message: Camunda 8 reads
 * them there, not on the event or receive task that waits for it.
 */
export class ZeebeSubscription {
  private readonly hosts = NESTED_HOSTS;
  private readonly names: VendorElements;

  constructor(private readonly doc: Doc) {
    this.names = new VendorElements(doc, this.hosts);
  }

  /** Undefined when the op is no `ext add zeebe:subscription` and stays where it is. */
  messageFor(owner: El, command: EditExtensionElements): El | undefined {
    if (command.action !== 'add' || this.addedType(command) !== 'zeebe:subscription') {
      return undefined;
    }
    const slot = command.slot ?? (command.type ? this.hosts.splitSlot(command.type)?.slot : undefined);
    if (slot !== undefined && !slot.startsWith('definition')) return undefined;
    const { catching, message } = this.caughtMessage(owner);
    if (!catching) return undefined;
    if (!message) {
      const id = idOf(owner);
      throw modelError('E_WRONG_HOST', `${this.addedTypeText(command)} belongs on the bpmn:Message ${kindLabel(owner)} ${id} waits for (Camunda 8 reads the correlation key there), and ${id} has no message`, {
        element: id,
        hint: `Give it one first: \`bpmn set <file> ${id} message=<MessageName>\` (in an apply batch with "refAs": "$msg" to name the message), then \`bpmn ext add <file> ${id} ${this.addedTypeText(command)} correlationKey==<expression>\`.`,
      });
    }
    return message;
  }

  note(owner: El, message: El, what: string): string {
    const others: string[] = [];
    for (const el of walk(this.doc.definitions, { bpmnOnly: true })) {
      if (el !== owner && this.caughtMessage(el).message === message) {
        others.push(idOf(el));
      }
    }
    const shared = others.length ? ` (${others.join(', ')} wait${others.length === 1 ? 's' : ''} for it ${owner === message ? '' : 'too '}and share${others.length === 1 ? 's' : ''} it)` : '';
    if (owner === message) {
      return `${what} is written to the zeebe:subscription of message ${idOf(message)}${shared}`;
    }
    return `${what} goes to message ${idOf(message)}, which ${idOf(owner)} waits for: Camunda 8 reads the correlation key in the message's zeebe:subscription${shared}`;
  }

  addedTypeText(command: EditExtensionElements): string {
    return command.type ? (this.hosts.splitSlot(command.type)?.rest ?? command.type).split('/')[0]! : 'zeebe:subscription';
  }

  /** False when `key` is no zeebe correlationKey or the element waits for no message. */
  setCorrelationKey(el: El, key: string, value: string, changes: ChangeSet): boolean {
    const doc = this.doc;
    const idx = key.indexOf(':');
    if (idx <= 0 || key.slice(idx + 1) !== 'correlationKey' || doc.namespaceUri(key.slice(0, idx)) !== ZEEBE_URI) {
      return false;
    }
    const message = is(el, 'bpmn:Message') ? el : this.caughtMessage(el).message;
    if (!message) return false;
    const type = `${key.slice(0, idx)}:subscription`;
    const existing = (message.get<El | undefined>('extensionElements')?.get<El[]>('values') ?? []).filter((extension) => this.names.typeOf(extension) === 'zeebe:subscription');
    if (existing.length) {
      const sub = existing[0]! as unknown as Record<string, unknown>;
      if (sub['correlationKey'] !== value) {
        sub['correlationKey'] = value;
        changes.change(ChangeSet.entryOf(message, `${existing[0]!.$type} correlationKey=${value}`));
      }
    } else {
      changes.merge(new ExtensionInserter(doc).add(message, { op: 'ext', id: idOf(message), action: 'add', type, attrs: { correlationKey: value } }));
    }
    changes.note(this.note(el, message, key));
    doc.invalidate();
    return true;
  }

  private caughtMessage(el: El): { catching: boolean; message?: El } {
    if (is(el, 'bpmn:ReceiveTask')) {
      return { catching: true, message: el.get<El | undefined>('messageRef') };
    }
    if (!is(el, 'bpmn:CatchEvent')) return { catching: false };
    const def = definitionsOf(el).find((definition) => is(definition, 'bpmn:MessageEventDefinition'));
    return def ? { catching: true, message: def.get<El | undefined>('messageRef') } : { catching: false };
  }

  private addedType(command: EditExtensionElements): string | undefined {
    if (command.type) {
      return this.names.canonicalName((this.hosts.splitSlot(command.type)?.rest ?? command.type).split('/')[0]!);
    }
    const match = command.xml ? /^\s*<([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)([^>]*)>/.exec(command.xml) : null;
    if (!match) return undefined;
    const inline = new RegExp(`xmlns:${match[1]!.replace(/[.-]/g, '\\$&')}\\s*=\\s*["']([^"']*)["']`).exec(match[3] ?? '')?.[1];
    return this.names.canonicalName(`${match[1]}:${match[2]}`, inline ? { [match[1]!]: inline } : {});
  }
}
