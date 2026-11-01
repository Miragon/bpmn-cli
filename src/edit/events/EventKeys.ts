import { type BpmnElement, BpmnError, ChangeEntries, type ChangeSet, Kinds, type Trigger, type TriggerOptions, Triggers } from '../../model/index.js';
import { PropertyCoercer } from '../properties/PropertyCoercer.js';
import type { EditSession } from '../session/EditSession.js';
import { TriggerChange } from './TriggerChange.js';
import { TriggerKeys } from './TriggerKeys.js';

export class EventKeys {
  constructor(private readonly edit: EditSession) {}

  write(el: BpmnElement, keys: Map<string, string>, changes: ChangeSet): void {
    const def = Kinds.of(el);
    const allowed = def?.triggers ?? [];
    const change = new TriggerChange(this.edit, el);
    const current = change.current;
    let requested: Trigger | undefined;
    if (keys.has('trigger')) {
      const raw = keys.get('trigger') ?? '';
      requested = raw ? Triggers.normalize(raw) : 'none';
      if (!requested) {
        throw PropertyCoercer.invalid(el, 'trigger', `unknown trigger "${raw}"`, `Allowed on ${def?.kind ?? Kinds.label(el)}: ${allowed.join(', ')}.`);
      }
    }
    const given: Record<string, unknown> = {};
    let nonInterrupting: boolean | undefined;
    for (const [key, value] of keys) {
      if (key === 'trigger') {
        continue;
      }
      if (key === 'nonInterrupting') {
        nonInterrupting = value ? PropertyCoercer.bool(el, key, value) : false;
        continue;
      }
      const implied = TriggerKeys.TRIGGER_OF_KEY[key]!;
      if (requested === undefined) {
        requested = implied;
      } else if (requested !== implied) {
        throw PropertyCoercer.invalid(el, key, `${key} belongs to the ${implied} trigger, not ${requested}`);
      }
      if (!value && key !== 'errorCode' && key !== 'escalationCode') {
        throw PropertyCoercer.invalid(el, key, `${key} needs a value`, 'Use trigger=none to remove the trigger.');
      }
      given[key] = value || undefined;
    }
    const trigger = requested ?? current.trigger;
    if (nonInterrupting !== undefined && requested === undefined && !Object.keys(given).length) {
      change.setNonInterrupting(nonInterrupting);
      changes.change(ChangeEntries.of(el, `nonInterrupting=${nonInterrupting}`));
      return;
    }
    if (!allowed.includes(trigger)) {
      throw BpmnError.model('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def?.kind ?? Kinds.label(el)} ${el.id}`, {
        element: el.id,
        hint: `Allowed triggers: ${allowed.join(', ') || 'none'}.`,
      });
    }
    change.change(trigger, { ...given, ...(nonInterrupting !== undefined ? { nonInterrupting } : {}) } as TriggerOptions, changes, { strict: true });
    const details = Object.entries(given)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([entryKey, entryValue]) => `${entryKey}=${String(entryValue)}`);
    changes.change(ChangeEntries.of(el, [`trigger=${trigger}`, ...details, ...(nonInterrupting !== undefined ? [`nonInterrupting=${nonInterrupting}`] : [])].join(' ')));
  }
}
