import type { Doc } from '../../model/Doc.js';
import { modelError } from '../../shared/utils/errors.js';
import { is, walk, type El } from '../../model/utils/moddle.js';
import { ChangeSet } from '../../model/ChangeSet.js';
import { kindLabel } from '../../model/utils/kinds.js';
import { definitionsOf } from '../../model/utils/nested-slots.js';
import { idOf } from '../../model/utils/elements.js';
import { ExtensionInserter } from '../extensions/ExtensionInserter.js';
import { NESTED_HOSTS } from '../NestedHosts.js';
import { VendorElements } from '../VendorElements.js';
import type { ExtOp } from '../types.js';
import { ZEEBE_URI } from '../../platform/ZeebeDescriptor.js';

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
  messageFor(owner: El, op: ExtOp): El | undefined {
    if (op.action !== 'add' || this.addedType(op) !== 'zeebe:subscription') return undefined;
    const slot = op.slot ?? (op.type ? this.hosts.splitSlot(op.type)?.slot : undefined);
    if (slot !== undefined && !slot.startsWith('definition')) return undefined;
    const { catching, message } = this.caughtMessage(owner);
    if (!catching) return undefined;
    if (!message) {
      const id = idOf(owner);
      throw modelError('E_WRONG_HOST', `${this.addedTypeText(op)} belongs on the bpmn:Message ${kindLabel(owner)} ${id} waits for (Camunda 8 reads the correlation key there), and ${id} has no message`, {
        element: id,
        hint: `Give it one first: \`bpmn set <file> ${id} message=<MessageName>\` (in an apply batch with "refAs": "$msg" to name the message), then \`bpmn ext add <file> ${id} ${this.addedTypeText(op)} correlationKey==<expression>\`.`,
      });
    }
    return message;
  }

  note(owner: El, message: El, what: string): string {
    const others: string[] = [];
    for (const el of walk(this.doc.definitions, { bpmnOnly: true })) {
      if (el !== owner && this.caughtMessage(el).message === message) others.push(idOf(el));
    }
    const shared = others.length ? ` (${others.join(', ')} wait${others.length === 1 ? 's' : ''} for it ${owner === message ? '' : 'too '}and share${others.length === 1 ? 's' : ''} it)` : '';
    if (owner === message) return `${what} is written to the zeebe:subscription of message ${idOf(message)}${shared}`;
    return `${what} goes to message ${idOf(message)}, which ${idOf(owner)} waits for: Camunda 8 reads the correlation key in the message's zeebe:subscription${shared}`;
  }

  addedTypeText(op: ExtOp): string {
    return op.type ? (this.hosts.splitSlot(op.type)?.rest ?? op.type).split('/')[0]! : 'zeebe:subscription';
  }

  /** False when `key` is no zeebe correlationKey or the element waits for no message. */
  setCorrelationKey(el: El, key: string, value: string, cs: ChangeSet): boolean {
    const doc = this.doc;
    const idx = key.indexOf(':');
    if (idx <= 0 || key.slice(idx + 1) !== 'correlationKey' || doc.namespaceUri(key.slice(0, idx)) !== ZEEBE_URI) return false;
    const message = is(el, 'bpmn:Message') ? el : this.caughtMessage(el).message;
    if (!message) return false;
    const type = `${key.slice(0, idx)}:subscription`;
    const existing = (message.get<El | undefined>('extensionElements')?.get<El[]>('values') ?? []).filter((extension) => this.names.typeOf(extension) === 'zeebe:subscription');
    if (existing.length) {
      const sub = existing[0]! as unknown as Record<string, unknown>;
      if (sub['correlationKey'] !== value) {
        sub['correlationKey'] = value;
        cs.change(ChangeSet.entryOf(message, `${existing[0]!.$type} correlationKey=${value}`));
      }
    } else {
      cs.merge(new ExtensionInserter(doc).add(message, { op: 'ext', id: idOf(message), action: 'add', type, attrs: { correlationKey: value } }));
    }
    cs.note(this.note(el, message, key));
    doc.invalidate();
    return true;
  }

  private caughtMessage(el: El): { catching: boolean; message?: El } {
    if (is(el, 'bpmn:ReceiveTask')) return { catching: true, message: el.get<El | undefined>('messageRef') };
    if (!is(el, 'bpmn:CatchEvent')) return { catching: false };
    const def = definitionsOf(el).find((definition) => is(definition, 'bpmn:MessageEventDefinition'));
    return def ? { catching: true, message: def.get<El | undefined>('messageRef') } : { catching: false };
  }

  private addedType(op: ExtOp): string | undefined {
    if (op.type) return this.names.canonicalName((this.hosts.splitSlot(op.type)?.rest ?? op.type).split('/')[0]!);
    const match = op.xml ? /^\s*<([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)([^>]*)>/.exec(op.xml) : null;
    if (!match) return undefined;
    const inline = new RegExp(`xmlns:${match[1]!.replace(/[.-]/g, '\\$&')}\\s*=\\s*["']([^"']*)["']`).exec(match[3] ?? '')?.[1];
    return this.names.canonicalName(`${match[1]}:${match[2]}`, inline ? { [match[1]!]: inline } : {});
  }
}
