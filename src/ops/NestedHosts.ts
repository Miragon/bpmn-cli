/**
 * Nested elements without an id of their own (the event definition, the loop
 * characteristics, the condition expression) hold extension elements too
 * (camunda:failedJobRetryTimeCycle on a multi-instance loop, camunda:field /
 * camunda:connector on a message event definition, camunda:in on a signal
 * event definition). They are addressed like the nested keys of `set`: a
 * `<slot>.` prefix on the type / selector (`loop.camunda:failedJobRetryTimeCycle`)
 * or op.slot. Messages and hints name them through their owner.
 */
import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import type { El } from '../model/utils/moddle.js';
import { kindLabel } from '../model/utils/kinds.js';
import { idOf } from './utils/elements.js';
import { NESTED_SLOTS, parseSlotRef, resolveNested, SLOT_TEXT, slotsOf, type NestedSlot } from './utils/nested-slots.js';
import { VendorElements } from './VendorElements.js';
import type { ExtOp } from './types.js';

export class NestedHosts {
  private readonly nested = new WeakMap<El, { owner: El; slot: NestedSlot; prefix: string }>();

  /** The element results and hints name: the owner of a nested host, else the host. */
  ownerOf(host: El): El {
    return this.nested.get(host)?.owner ?? host;
  }

  /** The id commands take for this host (the owner's id for a nested host). */
  idOf(host: El): string {
    return idOf(this.ownerOf(host));
  }

  /** The prefix a type / selector needs in a command for this host: `loop.` (`definition[1].`) for a nested host, '' otherwise. */
  slotPrefix(host: El): string {
    const n = this.nested.get(host);
    return n ? `${n.prefix}.` : '';
  }

  /** How messages name the host: its id, or `the loop characteristics of Activity_X`. */
  labelOf(host: El): string {
    const n = this.nested.get(host);
    return n ? `the ${SLOT_TEXT[n.slot]}${n.prefix !== n.slot ? ` ${n.prefix}` : ''} of ${idOf(n.owner)}` : idOf(host);
  }

  /**
   * `loop.camunda:x` -> { slot: 'loop', rest: 'camunda:x' } for the known slots
   * (`definition[timer].camunda:x` -> slot 'definition[timer]'); undefined otherwise.
   */
  splitSlot(text: string): { slot: string; rest: string } | undefined {
    const m = /^(\w+(?:\[[^\]]*\])?)\.(.+)$/.exec(text.trim());
    if (!m || !parseSlotRef(m[1]!)) return undefined;
    return { slot: m[1]!, rest: m[2]! };
  }

  /**
   * An ext remove whose type is an index from `ext list` (`2`, `loop.2`,
   * `definition[1].0`) is the index form, as on the command line (the ops JSON
   * may give it as "type").
   */
  normalizeIndex(op: ExtOp): ExtOp {
    if (op.action !== 'remove' || op.index !== undefined || op.type === undefined) return op;
    const ref = this.indexRef(op.type);
    if (!ref) return op;
    if (ref.slot !== undefined && op.slot !== undefined && op.slot !== ref.slot) {
      throw usageError(`"slot": "${op.slot}" and the type prefix ${ref.slot}. disagree`, { element: op.id, hint: 'Give the slot once: as the prefix (loop.0) or as "slot".' });
    }
    const { type: _type, ...rest } = op;
    const slot = ref.slot ?? op.slot;
    return { ...rest, index: ref.index, ...(slot !== undefined ? { slot: slot as ExtOp['slot'] } : {}) };
  }

  /**
   * The element the op works on: `owner`, or its nested element named by op.slot
   * / a `<slot>.` prefix of op.type. Adding a zeebe:loopCharacteristics to an
   * activity without loop creates a parallel multi-instance loop for it (what
   * the element configures; `notes` says so), like `set loop.<key>=` does.
   */
  resolve(doc: Doc, owner: El, op: ExtOp, notes: string[] = []): { host: El; op: ExtOp } {
    const split = op.type ? this.splitSlot(op.type) : undefined;
    if (split && op.slot && op.slot !== split.slot) {
      throw usageError(`"slot": "${op.slot}" and the type prefix ${split.slot}. disagree`, { element: idOf(owner), hint: 'Give the slot once: as the type prefix (loop.camunda:...) or as "slot".' });
    }
    const slotText: string | undefined = split?.slot ?? op.slot;
    if (slotText === undefined) return { host: owner, op };
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
    const what = split?.rest ?? (op.index !== undefined ? String(op.index) : (op.type ?? '<type>'));
    let nested = resolveNested(owner, ref, `${ref.text}.${what}`, (prefix) => `bpmn ext ${op.action} <file> ${id} '${prefix}.${what}'${op.action === 'add' ? ' ...' : ''}`);
    const zeebeLoop = (op.type !== undefined && new VendorElements(doc, this).canonicalName(split?.rest ?? op.type) === 'zeebe:loopCharacteristics') || (op.xml !== undefined && /^\s*<[\w.-]+:loopCharacteristics[\s/>]/.test(op.xml) && op.type === undefined);
    if (!nested && op.action === 'add' && slot === 'loop' && zeebeLoop && !owner.get<El | undefined>('loopCharacteristics')) {
      nested = doc.moddle.create('bpmn:MultiInstanceLoopCharacteristics');
      nested.$parent = owner;
      owner.set('loopCharacteristics', nested);
      notes.push(`${id}: created a parallel multi-instance loop for loop.${split?.rest ?? 'zeebe:loopCharacteristics'} (\`bpmn set <file> ${id} loop=sequential\` runs the items one after the other)`);
    }
    if (!nested) {
      const first: Record<NestedSlot, string> = {
        definition: `give it a trigger first: \`bpmn set <file> ${id} trigger=<message|timer|error|signal|...>\``,
        loop:
          doc.platform() === 'camunda8'
            ? `make it a multi-instance first: \`bpmn ext add <file> ${id} loop.zeebe:loopCharacteristics inputCollection==<items> inputElement=<item>\` (creates a parallel loop; \`bpmn set <file> ${id} loop=sequential\` for one after the other)`
            : `make it a loop first: \`bpmn set <file> ${id} loop=parallel\` (or sequential, or 'loop.camunda:collection=\${items}')`,
        condition: `give it a condition first: \`bpmn set <file> ${id} 'condition=\${...}'\` (conditional events: when=)`,
      };
      throw modelError(op.action === 'remove' ? 'E_NO_EXTENSION' : 'E_NO_NESTED_ELEMENT', `${kindLabel(owner)} ${id} has no ${SLOT_TEXT[slot]}${op.action === 'remove' ? ', so no extension elements there' : ' to hold extension elements'}`, {
        element: id,
        hint: op.action === 'remove' ? 'Nothing to remove; `bpmn ext list <file> <id>` shows what is there.' : `${first[slot][0]!.toUpperCase()}${first[slot].slice(1)}.`,
      });
    }
    this.nested.set(nested, { owner, slot, prefix: ref.text });
    const { slot: _slot, ...rest } = op;
    return { host: nested, op: { ...rest, ...(split ? { type: split.rest } : {}) } };
  }

  /** `2`, `loop.2`, `definition[1].0`: an index from `ext list` (of the element's own / of a nested element's extension elements). */
  private indexRef(text: string): { slot?: string; index: number } | undefined {
    const m = /^(?:(\w+(?:\[[^\]]*\])?)\.)?(\d+)$/.exec(text.trim());
    if (!m || (m[1] !== undefined && !parseSlotRef(m[1]))) return undefined;
    return { ...(m[1] !== undefined ? { slot: m[1] } : {}), index: Number(m[2]) };
  }
}

export const NESTED_HOSTS = new NestedHosts();
