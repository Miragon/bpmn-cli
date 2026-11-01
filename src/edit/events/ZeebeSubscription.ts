import { type BpmnDocument, type BpmnElement, BpmnError, ChangeEntries, type ChangeSet, ElementSlots, ElementWalk, Kinds, ZeebeDescriptor } from '../../model/index.js';
import type { ExtOperation } from '../../operations/index.js';
import { ExtensionInserter } from '../extensions/ExtensionInserter.js';
import { NestedHosts } from '../extensions/NestedHosts.js';
import { VendorElements } from '../extensions/VendorElements.js';

export class ZeebeSubscription {
  private readonly hosts = NestedHosts.INSTANCE;
  private readonly names: VendorElements;

  constructor(private readonly document: BpmnDocument) {
    this.names = new VendorElements(document, this.hosts);
  }

  messageFor(owner: BpmnElement, command: ExtOperation): BpmnElement | undefined {
    if (command.action !== 'add' || this.addedType(command) !== 'zeebe:subscription') {
      return undefined;
    }
    const slot = command.slot ?? (command.type ? this.hosts.splitSlot(command.type)?.slot : undefined);
    if (slot !== undefined && !slot.startsWith('definition')) {
      return undefined;
    }
    const { catching, message } = this.caughtMessage(owner);
    if (!catching) {
      return undefined;
    }
    if (!message) {
      const id = owner.id;
      throw BpmnError.model('E_WRONG_HOST', `${this.addedTypeText(command)} belongs on the bpmn:Message ${Kinds.label(owner)} ${id} waits for (Camunda 8 reads the correlation key there), and ${id} has no message`, {
        element: id,
        hint: `Give it one first: \`bpmn set <file> ${id} message=<MessageName>\` (in an apply batch with "refAs": "$msg" to name the message), then \`bpmn ext add <file> ${id} ${this.addedTypeText(command)} correlationKey==<expression>\`.`,
      });
    }
    return message;
  }

  note(owner: BpmnElement, message: BpmnElement, what: string): string {
    const others: string[] = [];
    for (const el of new ElementWalk(this.document.tree.definitions).depthFirst({ bpmnOnly: true })) {
      if (el !== owner && this.caughtMessage(el).message === message) {
        others.push(el.id);
      }
    }
    const shared = others.length ? ` (${others.join(', ')} wait${others.length === 1 ? 's' : ''} for it ${owner === message ? '' : 'too '}and share${others.length === 1 ? 's' : ''} it)` : '';
    if (owner === message) {
      return `${what} is written to the zeebe:subscription of message ${message.id}${shared}`;
    }
    return `${what} goes to message ${message.id}, which ${owner.id} waits for: Camunda 8 reads the correlation key in the message's zeebe:subscription${shared}`;
  }

  addedTypeText(command: ExtOperation): string {
    return command.type ? (this.hosts.splitSlot(command.type)?.rest ?? command.type).split('/')[0]! : 'zeebe:subscription';
  }

  setCorrelationKey(el: BpmnElement, key: string, value: string, changes: ChangeSet): boolean {
    const document = this.document;
    const idx = key.indexOf(':');
    if (idx <= 0 || key.slice(idx + 1) !== 'correlationKey' || document.namespaces.uriOf(key.slice(0, idx)) !== ZeebeDescriptor.URI) {
      return false;
    }
    const message = el.is('bpmn:Message') ? el : this.caughtMessage(el).message;
    if (!message) {
      return false;
    }
    const type = `${key.slice(0, idx)}:subscription`;
    const existing = (message.get<BpmnElement | undefined>('extensionElements')?.get<BpmnElement[]>('values') ?? []).filter((extension) => this.names.typeOf(extension) === 'zeebe:subscription');
    if (existing.length) {
      const subscription = existing[0]!;
      if (subscription.peek('correlationKey') !== value) {
        subscription.set('correlationKey', value);
        changes.change(ChangeEntries.of(message, `${existing[0]!.type} correlationKey=${value}`));
      }
    } else {
      changes.merge(new ExtensionInserter(document).add(message, { op: 'ext', id: message.id, action: 'add', type, attrs: { correlationKey: value } }));
    }
    changes.note(this.note(el, message, key));
    document.tree.invalidate();
    return true;
  }

  private caughtMessage(el: BpmnElement): { catching: boolean; message?: BpmnElement } {
    if (el.is('bpmn:ReceiveTask')) {
      return { catching: true, message: el.get<BpmnElement | undefined>('messageRef') };
    }
    if (!el.is('bpmn:CatchEvent')) {
      return { catching: false };
    }
    const def = ElementSlots.definitionsOf(el).find((definition) => definition.is('bpmn:MessageEventDefinition'));
    return def ? { catching: true, message: def.get<BpmnElement | undefined>('messageRef') } : { catching: false };
  }

  private addedType(command: ExtOperation): string | undefined {
    if (command.type) {
      return this.names.canonicalName((this.hosts.splitSlot(command.type)?.rest ?? command.type).split('/')[0]!);
    }
    const match = command.xml ? /^\s*<([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)([^>]*)>/.exec(command.xml) : null;
    if (!match) {
      return undefined;
    }
    const inline = new RegExp(`xmlns:${match[1]!.replace(/[.-]/g, '\\$&')}\\s*=\\s*["']([^"']*)["']`).exec(match[3] ?? '')?.[1];
    return this.names.canonicalName(`${match[1]}:${match[2]}`, inline ? { [match[1]!]: inline } : {});
  }
}
