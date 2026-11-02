import { type BpmnElement, BpmnError, ChangeEntries, type ChangeSet, Kinds, type Trigger, type TriggerOptions, Triggers } from '../../model/index.js';
import { PropertyCoercer } from '../properties/PropertyCoercer.js';
import type { EditSession } from '../session/EditSession.js';
import { TriggerChange } from './TriggerChange.js';
import { TriggerKeys } from './TriggerKeys.js';

interface TriggerKeyValues {
  requested: Trigger | undefined;
  given: Record<string, unknown>;
  nonInterrupting: boolean | undefined;
}

export class EventKeys {
  constructor(private readonly edit: EditSession) {}

  write(el: BpmnElement, keys: Map<string, string>, changes: ChangeSet): void {
    const def = Kinds.of(el);
    const allowed = def?.triggers ?? [];
    const change = new TriggerChange(this.edit, el);
    const { requested, given, nonInterrupting } = EventKeys.readKeys(el, keys, EventKeys.namedTrigger(el, keys, allowed));
    const trigger = requested ?? change.current.trigger;
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

  private static namedTrigger(el: BpmnElement, keys: Map<string, string>, allowed: readonly Trigger[]): Trigger | undefined {
    if (!keys.has('trigger')) {
      return undefined;
    }
    const raw = keys.get('trigger') ?? '';
    const trigger = raw ? Triggers.normalize(raw) : 'none';
    if (!trigger) {
      throw PropertyCoercer.invalidValue(el, 'trigger', `unknown trigger "${raw}"`, `Allowed on ${Kinds.of(el)?.kind ?? Kinds.label(el)}: ${allowed.join(', ')}.`);
    }
    return trigger;
  }

  private static readKeys(el: BpmnElement, keys: Map<string, string>, named: Trigger | undefined): TriggerKeyValues {
    const values: TriggerKeyValues = { requested: named, given: {}, nonInterrupting: undefined };
    for (const [key, value] of keys) {
      if (key === 'nonInterrupting') {
        values.nonInterrupting = value ? PropertyCoercer.booleanOf(el, key, value) : false;
      } else if (key !== 'trigger') {
        values.requested = EventKeys.impliedTrigger(el, key, values.requested);
        EventKeys.assertHasValue(el, key, value);
        values.given[key] = key === 'message' ? value : value || undefined;
      }
    }
    return values;
  }

  private static impliedTrigger(el: BpmnElement, key: string, requested: Trigger | undefined): Trigger {
    const implied = TriggerKeys.TRIGGER_OF_KEY[key]!;
    if (requested !== undefined && requested !== implied) {
      throw PropertyCoercer.invalidValue(el, key, `${key} belongs to the ${implied} trigger, not ${requested}`);
    }
    return implied;
  }

  private static assertHasValue(el: BpmnElement, key: string, value: string): void {
    if (!value && key !== 'errorCode' && key !== 'escalationCode' && key !== 'message') {
      throw PropertyCoercer.invalidValue(el, key, `${key} needs a value`, 'Use trigger=none to remove the trigger.');
    }
  }
}
