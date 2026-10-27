import { TRIGGER_FIELDS } from '../../../../domain/commands/utils/op-fields.js';
import type { TriggerOptions } from '../../../../domain/commands/types.js';

export function flag(key: string): string {
  return `--${key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)}`;
}

/** The value placeholder of each trigger flag; `nonInterrupting` takes none. */
const TRIGGER_VALUE_NAMES: Record<keyof TriggerOptions, string | undefined> = {
  timer: 'iso',
  timerKind: 'kind',
  message: 'name',
  error: 'name',
  errorCode: 'code',
  signal: 'name',
  escalation: 'name',
  escalationCode: 'code',
  when: 'expr',
  link: 'name',
  nonInterrupting: undefined,
};

export function triggerFlag(key: keyof TriggerOptions): [flags: string, help: string] {
  const valueName = TRIGGER_VALUE_NAMES[key];
  return [`${flag(key)}${valueName ? ` <${valueName}>` : ''}`, TRIGGER_FIELDS[key].description];
}

export function triggerFlagUsage(keys: ReadonlyArray<keyof TriggerOptions>): string {
  if (!keys.length) return '(no option)';
  return keys
    .map((key, index) => {
      const allowedValues = TRIGGER_FIELDS[key].values;
      const spelled = `${flag(key)} ${allowedValues ? allowedValues.join('|') : `<${TRIGGER_VALUE_NAMES[key]}>`}`;
      return index ? `[${spelled}]` : spelled;
    })
    .join(' ');
}
