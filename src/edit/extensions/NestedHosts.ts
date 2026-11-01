import { type BpmnElement, BpmnError, ElementSlots, Kinds, type NestedSlot } from '../../model/index.js';
import type { ExtOperation } from '../../operations/index.js';
import { NestedResolution } from '../properties/NestedResolution.js';
import type { EditSession } from '../session/EditSession.js';
import { VendorElements } from './VendorElements.js';

export class NestedHosts {
  static readonly INSTANCE = new NestedHosts();

  private readonly nested = new WeakMap<BpmnElement, { owner: BpmnElement; slot: NestedSlot; prefix: string }>();

  ownerOf(host: BpmnElement): BpmnElement {
    return this.nested.get(host)?.owner ?? host;
  }

  idOf(host: BpmnElement): string {
    return this.ownerOf(host).id;
  }

  slotPrefix(host: BpmnElement): string {
    const nestedHost = this.nested.get(host);
    return nestedHost ? `${nestedHost.prefix}.` : '';
  }

  labelOf(host: BpmnElement): string {
    const nestedHost = this.nested.get(host);
    return nestedHost ? `the ${ElementSlots.TEXT[nestedHost.slot]}${nestedHost.prefix !== nestedHost.slot ? ` ${nestedHost.prefix}` : ''} of ${nestedHost.owner.id}` : host.id;
  }

  splitSlot(text: string): { slot: string; rest: string } | undefined {
    const match = /^(\w+(?:\[[^\]]*\])?)\.(.+)$/.exec(text.trim());
    if (!match || !ElementSlots.parseRef(match[1]!)) {
      return undefined;
    }
    return { slot: match[1]!, rest: match[2]! };
  }

  normalizeIndex(command: ExtOperation): ExtOperation {
    if (command.action !== 'remove' || command.index !== undefined || command.type === undefined) {
      return command;
    }
    const ref = this.indexRef(command.type);
    if (!ref) {
      return command;
    }
    if (ref.slot !== undefined && command.slot !== undefined && command.slot !== ref.slot) {
      throw BpmnError.usage(`"slot": "${command.slot}" and the type prefix ${ref.slot}. disagree`, { element: command.id, hint: 'Give the slot once: as the prefix (loop.0) or as "slot".' });
    }
    const { type: _type, ...rest } = command;
    const slot = ref.slot ?? command.slot;
    return { ...rest, index: ref.index, ...(slot !== undefined ? { slot: slot as ExtOperation['slot'] } : {}) };
  }

  resolve(edit: EditSession, owner: BpmnElement, command: ExtOperation, notes: string[] = []): { host: BpmnElement; command: ExtOperation } {
    const split = command.type ? this.splitSlot(command.type) : undefined;
    if (split && command.slot && command.slot !== split.slot) {
      throw BpmnError.usage(`"slot": "${command.slot}" and the type prefix ${split.slot}. disagree`, { element: owner.id, hint: 'Give the slot once: as the type prefix (loop.camunda:...) or as "slot".' });
    }
    const slotText: string | undefined = split?.slot ?? command.slot;
    if (slotText === undefined) {
      return { host: owner, command };
    }
    const id = owner.id;
    const ref = ElementSlots.parseRef(slotText);
    if (!ref) {
      throw BpmnError.usage(`Unknown slot "${String(slotText)}"; use ${ElementSlots.NAMES.join(', ')}`, { element: id });
    }
    const slot = ref.slot;
    if (!ElementSlots.slotsOf(owner).includes(slot)) {
      throw BpmnError.model('E_WRONG_KIND', `${Kinds.label(owner)} ${id} has no ${ElementSlots.TEXT[slot]} (${slot}.)`, {
        element: id,
        hint: 'definition. addresses the event definition of an event, loop. the loop characteristics of an activity, condition. the condition expression of a sequence flow or conditional event.',
      });
    }
    const what = split?.rest ?? (command.index !== undefined ? String(command.index) : (command.type ?? '<type>'));
    let nested = NestedResolution.resolve(owner, ref, `${ref.text}.${what}`, (prefix) => `bpmn ext ${command.action} <file> ${id} '${prefix}.${what}'${command.action === 'add' ? ' ...' : ''}`);
    const zeebeLoop = (command.type !== undefined && new VendorElements(edit.document, this).canonicalName(split?.rest ?? command.type) === 'zeebe:loopCharacteristics') || (command.xml !== undefined && /^\s*<[\w.-]+:loopCharacteristics[\s/>]/.test(command.xml) && command.type === undefined);
    if (!nested && command.action === 'add' && slot === 'loop' && zeebeLoop && !owner.get<BpmnElement | undefined>('loopCharacteristics')) {
      nested = edit.document.tree.build('bpmn:MultiInstanceLoopCharacteristics');
      nested.parent = owner;
      owner.set('loopCharacteristics', nested);
      notes.push(`${id}: created a parallel multi-instance loop for loop.${split?.rest ?? 'zeebe:loopCharacteristics'} (\`bpmn set <file> ${id} loop=sequential\` runs the items one after the other)`);
    }
    if (!nested) {
      const first: Record<NestedSlot, string> = {
        definition: `give it a trigger first: \`bpmn set <file> ${id} trigger=<message|timer|error|signal|...>\``,
        loop:
          edit.platform() === 'c8'
            ? `make it a multi-instance first: \`bpmn ext add <file> ${id} loop.zeebe:loopCharacteristics inputCollection==<items> inputElement=<item>\` (creates a parallel loop; \`bpmn set <file> ${id} loop=sequential\` for one after the other)`
            : `make it a loop first: \`bpmn set <file> ${id} loop=parallel\` (or sequential, or 'loop.camunda:collection=\${items}')`,
        condition: `give it a condition first: \`bpmn set <file> ${id} 'condition=\${...}'\` (conditional events: when=)`,
      };
      throw BpmnError.model(command.action === 'remove' ? 'E_NO_EXTENSION' : 'E_NO_NESTED_ELEMENT', `${Kinds.label(owner)} ${id} has no ${ElementSlots.TEXT[slot]}${command.action === 'remove' ? ', so no extension elements there' : ' to hold extension elements'}`, {
        element: id,
        hint: command.action === 'remove' ? 'Nothing to remove; `bpmn ext list <file> <id>` shows what is there.' : `${first[slot][0]!.toUpperCase()}${first[slot].slice(1)}.`,
      });
    }
    this.nested.set(nested, { owner, slot, prefix: ref.text });
    const { slot: _slot, ...rest } = command;
    return { host: nested, command: { ...rest, ...(split ? { type: split.rest } : {}) } };
  }

  private indexRef(text: string): { slot?: string; index: number } | undefined {
    const match = /^(?:(\w+(?:\[[^\]]*\])?)\.)?(\d+)$/.exec(text.trim());
    if (!match || (match[1] !== undefined && !ElementSlots.parseRef(match[1]))) {
      return undefined;
    }
    return { ...(match[1] !== undefined ? { slot: match[1] } : {}), index: Number(match[2]) };
  }
}

