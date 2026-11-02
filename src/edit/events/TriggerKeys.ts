import { type BpmnElement, PropertyCatalog, type Trigger, type TriggerOptions } from '../../model/index.js';
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

  static assertFit(element: BpmnElement, keys: ElementKeys, trigger: Trigger): void {
    const foreign = Object.keys(keys).find((key) => (TriggerKeys.TRIGGER_OF_KEY[key] ?? trigger) !== trigger);
    if (foreign) {
      const untaken = Object.keys(TriggerKeys.TRIGGER_OF_KEY).filter((key) => TriggerKeys.TRIGGER_OF_KEY[key] !== trigger);
      throw PropertyCatalog.of(element).unknownKey(foreign, `${foreign} belongs to the ${TriggerKeys.TRIGGER_OF_KEY[foreign]} trigger, not ${trigger}`, untaken);
    }
  }

  static assertNoneWithoutTrigger(eventSubProcess: BpmnElement, startKeys: ElementKeys): void {
    const [untriggered] = Object.keys(startKeys);
    if (untriggered) {
      throw PropertyCatalog.of(eventSubProcess).unknownKey(untriggered, 'it belongs to the start event, and this event sub-process names no trigger');
    }
  }

  static optionsOf(keys: ElementKeys, element: BpmnElement): TriggerOptions {
    const options: Record<string, unknown> = {};
    for (const key of TriggerKeys.ALL) {
      if (keys[key] !== undefined) {
        options[key] = key === 'nonInterrupting' ? PropertyCoercer.booleanOf(element, key, keys[key]) : keys[key];
      }
    }
    return options as TriggerOptions;
  }

  static present(keys: ElementKeys): ElementKeys {
    return TriggerKeys.pick(keys, (key) => TriggerKeys.ALL.includes(key));
  }

  static remainingKeys(keys: ElementKeys, consumed: readonly string[] = TriggerKeys.ALL): ElementKeys {
    return TriggerKeys.pick(keys, (key) => !consumed.includes(key));
  }

  private static pick(keys: ElementKeys, wanted: (key: string) => boolean): ElementKeys {
    return Object.fromEntries(Object.entries(keys).filter(([key]) => wanted(key)));
  }
}
