import type { BpmnElement, Trigger, TriggerOptions } from '../../model/index.js';
import { PropertyCoercer } from '../properties/PropertyCoercer.js';

export type ElementKeys = Readonly<Record<string, string>>;

export class TriggerKeys {
  static readonly TRIGGER_OF_KEY: Readonly<Record<string, Trigger>> = {
    timer: 'timer',
    message: 'message',
    error: 'error',
    errorCode: 'error',
    signal: 'signal',
    escalation: 'escalation',
    escalationCode: 'escalation',
    when: 'conditional',
    link: 'link',
  };

  static readonly ALL: readonly string[] = [...Object.keys(TriggerKeys.TRIGGER_OF_KEY), 'nonInterrupting'];

  static impliedTrigger(keys: ElementKeys): Trigger | undefined {
    const key = Object.keys(TriggerKeys.TRIGGER_OF_KEY).find((candidate) => keys[candidate] !== undefined);
    return key ? TriggerKeys.TRIGGER_OF_KEY[key] : undefined;
  }

  static optionsOf(keys: ElementKeys, element: BpmnElement): TriggerOptions {
    const options: Record<string, unknown> = {};
    for (const key of TriggerKeys.ALL) {
      if (keys[key] !== undefined) {
        options[key] = key === 'nonInterrupting' ? PropertyCoercer.bool(element, key, keys[key]) : keys[key];
      }
    }
    return options as TriggerOptions;
  }

  static present(keys: ElementKeys): ElementKeys {
    return TriggerKeys.pick(keys, (key) => TriggerKeys.ALL.includes(key));
  }

  static without(keys: ElementKeys, consumed: readonly string[] = TriggerKeys.ALL): ElementKeys {
    return TriggerKeys.pick(keys, (key) => !consumed.includes(key));
  }

  private static pick(keys: ElementKeys, wanted: (key: string) => boolean): ElementKeys {
    return Object.fromEntries(Object.entries(keys).filter(([key]) => wanted(key)));
  }
}
