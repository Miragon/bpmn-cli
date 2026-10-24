/**
 * zeebe:subscription: on the message, not on the event that waits. Camunda 8
 * reads a correlation key on the bpmn:Message, not on the event or receive
 * task that waits for it.
 */
import type { Doc } from '../model/Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { is, walk, type El } from '../model/utils/moddle.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { kindLabel } from '../model/kinds.js';
import { changeOf, definitionsOf, idOf } from './set.js';
import { ExtensionInserter } from './ExtensionInserter.js';
import { NESTED_HOSTS } from './NestedHosts.js';
import { VendorElements } from './VendorElements.js';
import type { ExtOp } from './types.js';
import { ZEEBE_URI } from '../platform/ZeebeDescriptor.js';

export class ZeebeSubscription {
  private readonly hosts = NESTED_HOSTS;
  private readonly names: VendorElements;

  constructor(private readonly doc: Doc) {
    this.names = new VendorElements(doc, this.hosts);
  }

  /**
   * `ext add <event|receiveTask> zeebe:subscription ...`: Camunda 8 reads the
   * subscription (the correlation key) on the bpmn:Message the element waits
   * for, so the op goes to that message (returned); a catching element without
   * a message is E_WRONG_HOST. Anything else: undefined (the op stays as it is).
   */
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

  /** `zeebe:subscription goes to message Message_X, which Event_Y waits for ...` */
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

  /**
   * `set <event|receiveTask|message> zeebe:correlationKey=<value>`: the
   * correlation key is an attribute of the message's zeebe:subscription, so the
   * value goes there (an existing subscription keeps everything else, a missing
   * one is added). False when `key` is no zeebe correlationKey or the element
   * waits for no message (set then refuses it with E_WRONG_HOST).
   */
  setCorrelationKey(el: El, key: string, value: string, cs: ChangeSet): boolean {
    const doc = this.doc;
    const idx = key.indexOf(':');
    if (idx <= 0 || key.slice(idx + 1) !== 'correlationKey' || doc.namespaceUri(key.slice(0, idx)) !== ZEEBE_URI) return false;
    const message = is(el, 'bpmn:Message') ? el : this.caughtMessage(el).message;
    if (!message) return false;
    const type = `${key.slice(0, idx)}:subscription`;
    const existing = (message.get<El | undefined>('extensionElements')?.get<El[]>('values') ?? []).filter((v) => this.names.typeOf(v) === 'zeebe:subscription');
    if (existing.length) {
      const sub = existing[0]! as unknown as Record<string, unknown>;
      if (sub['correlationKey'] !== value) {
        sub['correlationKey'] = value;
        cs.change(changeOf(message, `${existing[0]!.$type} correlationKey=${value}`));
      }
    } else {
      cs.merge(new ExtensionInserter(doc).add(message, { op: 'ext', id: idOf(message), action: 'add', type, attrs: { correlationKey: value } }));
    }
    cs.note(this.note(el, message, key));
    doc.invalidate();
    return true;
  }

  /**
   * The bpmn:Message a catching element waits for: a receive task's message,
   * the message of a catch / boundary / start event's message event definition.
   * undefined for anything else (a throw event, a send task, a timer event).
   */
  private caughtMessage(el: El): { catching: boolean; message?: El } {
    if (is(el, 'bpmn:ReceiveTask')) return { catching: true, message: el.get<El | undefined>('messageRef') };
    if (!is(el, 'bpmn:CatchEvent')) return { catching: false };
    const def = definitionsOf(el).find((d) => is(d, 'bpmn:MessageEventDefinition'));
    return def ? { catching: true, message: def.get<El | undefined>('messageRef') } : { catching: false };
  }

  /** The canonical type an `ext add` adds: its type (without a slot prefix, first step of a path) or the root of its --xml. */
  private addedType(op: ExtOp): string | undefined {
    if (op.type) return this.names.canonicalName((this.hosts.splitSlot(op.type)?.rest ?? op.type).split('/')[0]!);
    const m = op.xml ? /^\s*<([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)([^>]*)>/.exec(op.xml) : null;
    if (!m) return undefined;
    const inline = new RegExp(`xmlns:${m[1]!.replace(/[.-]/g, '\\$&')}\\s*=\\s*["']([^"']*)["']`).exec(m[3] ?? '')?.[1];
    return this.names.canonicalName(`${m[1]}:${m[2]}`, inline ? { [m[1]!]: inline } : {});
  }
}
