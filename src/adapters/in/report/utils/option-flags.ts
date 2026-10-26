import { TRIGGER_FIELDS } from '../../../../domain/commands/utils/op-fields.js';
import type { TriggerOptions } from '../../../../domain/commands/types.js';

export function flag(key: string): string {
  return `--${key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)}`;
}

export interface TriggerFlagDoc {
  value?: string;
  help: string;
}

export const TRIGGER_FLAGS: { [Key in keyof TriggerOptions]-?: TriggerFlagDoc } = {
  timer: { value: 'iso', help: 'timer: R/PT1H (cycle), PT5M (duration) or a date' },
  timerKind: { value: 'kind', help: 'cycle | duration | date (default: classified from the value)' },
  message: { value: 'name', help: 'message name (bpmn:Message is created when missing)' },
  error: { value: 'name', help: 'error name' },
  errorCode: { value: 'code', help: 'error code' },
  signal: { value: 'name', help: 'signal name' },
  escalation: { value: 'name', help: 'escalation name' },
  escalationCode: { value: 'code', help: 'escalation code' },
  when: { value: 'expr', help: 'condition of a conditional event' },
  link: { value: 'name', help: 'link name' },
  nonInterrupting: { help: 'non-interrupting boundary / start event' },
};

export function triggerFlag(key: keyof TriggerOptions): [flags: string, help: string] {
  const doc = TRIGGER_FLAGS[key];
  return [`${flag(key)}${doc.value ? ` <${doc.value}>` : ''}`, doc.help];
}

export function triggerFlagUsage(keys: ReadonlyArray<keyof TriggerOptions>): string {
  if (!keys.length) return '(no option)';
  return keys
    .map((key, index) => {
      const allowedValues = TRIGGER_FIELDS[key].values;
      const spelled = `${flag(key)} ${allowedValues ? allowedValues.join('|') : `<${TRIGGER_FLAGS[key].value}>`}`;
      return index ? `[${spelled}]` : spelled;
    })
    .join(' ');
}
