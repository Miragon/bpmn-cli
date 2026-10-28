import type { EditSession } from '../../document/EditSession.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import type { El } from '../../document/utils/moddle.js';
import { kindLabel } from '../../document/Kinds.js';
import { idOf } from '../../document/utils/elements.js';
import { NESTED_SLOTS, parseSlotRef, resolveNested, SLOT_TEXT, slotsOf, type NestedSlot } from '../../document/utils/nested-slots.js';
import { VendorElements } from './VendorElements.js';
import type { EditExtensionElements } from '../../commands/types.js';

/**
 * Extension elements on nested elements without an id (event definition, loop, condition),
 * addressed by a `<slot>.` prefix (`loop.camunda:failedJobRetryTimeCycle`) or op.slot.
 * Messages and hints name them through their owner.
 */
export class NestedHosts {
  private readonly nested = new WeakMap<El, { owner: El; slot: NestedSlot; prefix: string }>();

  ownerOf(host: El): El {
    return this.nested.get(host)?.owner ?? host;
  }

  idOf(host: El): string {
    return idOf(this.ownerOf(host));
  }

  /** `loop.` (`definition[1].`) for a nested host, '' otherwise. */
  slotPrefix(host: El): string {
    const nestedHost = this.nested.get(host);
    return nestedHost ? `${nestedHost.prefix}.` : '';
  }

  /** Its id, or `the loop characteristics of task_x`. */
  labelOf(host: El): string {
    const nestedHost = this.nested.get(host);
    return nestedHost ? `the ${SLOT_TEXT[nestedHost.slot]}${nestedHost.prefix !== nestedHost.slot ? ` ${nestedHost.prefix}` : ''} of ${idOf(nestedHost.owner)}` : idOf(host);
  }

  /** `loop.camunda:x` -> { slot: 'loop', rest: 'camunda:x' } for the known slots. */
  splitSlot(text: string): { slot: string; rest: string } | undefined {
    const match = /^(\w+(?:\[[^\]]*\])?)\.(.+)$/.exec(text.trim());
    if (!match || !parseSlotRef(match[1]!)) return undefined;
    return { slot: match[1]!, rest: match[2]! };
  }

  /** The ops JSON may give the `ext list` index of a remove (`loop.2`) as "type". */
  normalizeIndex(command: EditExtensionElements): EditExtensionElements {
    if (command.action !== 'remove' || command.index !== undefined || command.type === undefined) return command;
    const ref = this.indexRef(command.type);
    if (!ref) return command;
    if (ref.slot !== undefined && command.slot !== undefined && command.slot !== ref.slot) {
      throw usageError(`"slot": "${command.slot}" and the type prefix ${ref.slot}. disagree`, { element: command.id, hint: 'Give the slot once: as the prefix (loop.0) or as "slot".' });
    }
    const { type: _type, ...rest } = command;
    const slot = ref.slot ?? command.slot;
    return { ...rest, index: ref.index, ...(slot !== undefined ? { slot: slot as EditExtensionElements['slot'] } : {}) };
  }

  /**
   * Adding a zeebe:loopCharacteristics to an activity without loop creates a parallel
   * multi-instance loop for it, like `set loop.<key>=` does.
   */
  resolve(edit: EditSession, owner: El, command: EditExtensionElements, notes: string[] = []): { host: El; command: EditExtensionElements } {
    const split = command.type ? this.splitSlot(command.type) : undefined;
    if (split && command.slot && command.slot !== split.slot) {
      throw usageError(`"slot": "${command.slot}" and the type prefix ${split.slot}. disagree`, { element: idOf(owner), hint: 'Give the slot once: as the type prefix (loop.camunda:...) or as "slot".' });
    }
    const slotText: string | undefined = split?.slot ?? command.slot;
    if (slotText === undefined) return { host: owner, command };
    const id = idOf(owner);
    const ref = parseSlotRef(slotText);
    if (!ref) {
      throw usageError(`Unknown slot "${String(slotText)}"; use ${NESTED_SLOTS.join(', ')}`, { element: id });
    }
    const slot = ref.slot;
    if (!slotsOf(owner).includes(slot)) {
      throw modelError('E_WRONG_KIND', `${kindLabel(owner)} ${id} has no ${SLOT_TEXT[slot]} (${slot}.)`, {
        element: id,
        hint: 'definition. addresses the event definition of an event, loop. the loop characteristics of an activity, condition. the condition expression of a sequence flow or conditional event.',
      });
    }
    const what = split?.rest ?? (command.index !== undefined ? String(command.index) : (command.type ?? '<type>'));
    let nested = resolveNested(owner, ref, `${ref.text}.${what}`, (prefix) => `bpmn ext ${command.action} <file> ${id} '${prefix}.${what}'${command.action === 'add' ? ' ...' : ''}`);
    const zeebeLoop = (command.type !== undefined && new VendorElements(edit.doc, this).canonicalName(split?.rest ?? command.type) === 'zeebe:loopCharacteristics') || (command.xml !== undefined && /^\s*<[\w.-]+:loopCharacteristics[\s/>]/.test(command.xml) && command.type === undefined);
    if (!nested && command.action === 'add' && slot === 'loop' && zeebeLoop && !owner.get<El | undefined>('loopCharacteristics')) {
      nested = edit.doc.moddle.create('bpmn:MultiInstanceLoopCharacteristics');
      nested.$parent = owner;
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
      throw modelError(command.action === 'remove' ? 'E_NO_EXTENSION' : 'E_NO_NESTED_ELEMENT', `${kindLabel(owner)} ${id} has no ${SLOT_TEXT[slot]}${command.action === 'remove' ? ', so no extension elements there' : ' to hold extension elements'}`, {
        element: id,
        hint: command.action === 'remove' ? 'Nothing to remove; `bpmn ext list <file> <id>` shows what is there.' : `${first[slot][0]!.toUpperCase()}${first[slot].slice(1)}.`,
      });
    }
    this.nested.set(nested, { owner, slot, prefix: ref.text });
    const { slot: _slot, ...rest } = command;
    return { host: nested, command: { ...rest, ...(split ? { type: split.rest } : {}) } };
  }

  /** `2`, `loop.2`, `definition[1].0`: an index from `ext list`. */
  private indexRef(text: string): { slot?: string; index: number } | undefined {
    const match = /^(?:(\w+(?:\[[^\]]*\])?)\.)?(\d+)$/.exec(text.trim());
    if (!match || (match[1] !== undefined && !parseSlotRef(match[1]))) return undefined;
    return { ...(match[1] !== undefined ? { slot: match[1] } : {}), index: Number(match[2]) };
  }
}

export const NESTED_HOSTS = new NestedHosts();
