const PERIOD = /^[-+]?[Pp](?:[-+]?\d+[Yy])?(?:[-+]?\d+[Mm])?(?:[-+]?\d+[Ww])?(?:[-+]?\d+[Dd])?$/;
const DURATION = /^[-+]?P(?:T(?=[-+]?\d)(?:[-+]?\d+H)?(?:[-+]?\d+M)?(?:[-+]?\d+(?:[.,]\d{0,9})?S)?)$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:\d{2}(?::\d{2})?)(?:\[[^\]]+\])?$/;
const CRON_MACROS = ['@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface CronField {
  name: string;
  min: number;
  max: number;
  names?: string[];
  question?: boolean;
  /** not checked further */
  quartz?: RegExp;
}

/**
 * The six cron fields. Quartz day-of-month takes L, W (last day, nearest weekday); day-of-week
 * counts 0 and 7 as Sunday and takes L, # (last / nth weekday of the month).
 */
const CRON_FIELDS: CronField[] = [
  { name: 'second', min: 0, max: 59 },
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31, question: true, quartz: /[LW]/i },
  { name: 'month', min: 1, max: 12, names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] },
  { name: 'day-of-week', min: 0, max: 7, names: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], question: true, quartz: /[L#]/i },
];

/**
 * Timer values as Camunda 8.9 parses them (engine-checked): Java Period + Duration split at an
 * upper-case T, date-times with offset, repeating intervals and Spring's 6-field cron.
 */
export class TimerValue {
  constructor(private readonly value: string) {}

  isDuration(): boolean {
    const trimmed = this.value.trim();
    const timeStart = trimmed.indexOf('T');
    if (timeStart === -1) return PERIOD.test(trimmed) && /\d/.test(trimmed);
    const period = trimmed.slice(0, timeStart);
    if (!/^[-+]?[Pp]$/.test(period) && !(PERIOD.test(period) && /\d/.test(period))) return false;
    return DURATION.test(`P${trimmed.slice(timeStart)}`) && /\d/.test(trimmed.slice(timeStart));
  }

  isDateTime(): boolean {
    return DATE_TIME.test(this.value.trim()) && !this.dateTimeRangeProblem();
  }

  /** Java's strict parse, which Camunda 8 uses, refuses 2030-02-30 and 25:00. */
  dateTimeRangeProblem(): string | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2}))?/.exec(this.value.trim());
    if (!match) return undefined;
    const [year, mo, day, hour, mi, second] = match.slice(1).map((group) => Number(group ?? 0)) as [number, number, number, number, number, number];
    if (mo < 1 || mo > 12) return `month ${match[2]} is not in 01-12`;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
    if (day < 1 || day > days) return `${MONTHS[mo - 1]} ${year} has no day ${match[3]}`;
    if (hour > 23) return `hour ${match[4]} is not in 00-23`;
    if (mi > 59) return `minute ${match[5]} is not in 00-59`;
    if (second > 59) return `second ${match[6]} is not in 00-59`;
    const offset = /([+-])(\d{2}):(\d{2})(?::(\d{2}))?(?:\[[^\]]+\])?$/.exec(this.value.trim());
    if (offset && (Number(offset[3]) > 59 || Number(offset[4] ?? 0) > 59 || Number(offset[2]) * 3600 + Number(offset[3]) * 60 + Number(offset[4] ?? 0) > 18 * 3600)) return `offset ${offset[0].replace(/\[.*$/, '')} is not within ±18:00`;
    return undefined;
  }

  isCycle(): boolean {
    const trimmed = this.value.trim();
    const match = /^R-?\d*\/(.+)$/.exec(trimmed);
    if (match) {
      const parts = match[1]!.split('/');
      if (parts.length === 1) return new TimerValue(parts[0]!).isDuration();
      if (parts.length === 2) return new TimerValue(parts[0]!).isDateTime() && new TimerValue(parts[1]!).isDuration();
      return false;
    }
    if (CRON_MACROS.includes(trimmed)) return true;
    return trimmed.split(/ +/).length === 6 && !trimmed.startsWith('R') && !this.cronProblem();
  }

  cycleRangeProblem(): string | undefined {
    const trimmed = this.value.trim();
    const match = /^R-?\d*\/(.+)\/.+$/.exec(trimmed);
    if (match) return new TimerValue(match[1]!).dateTimeRangeProblem();
    return trimmed.split(/ +/).length === 6 && !trimmed.startsWith('R') ? this.cronProblem() : undefined;
  }

  cronProblem(): string | undefined {
    const fields = this.value.trim().split(/ +/);
    for (let index = 0; index < 6; index++) {
      const spec = CRON_FIELDS[index]!;
      if (!this.validCronField(fields[index] ?? '', spec)) return `the ${spec.name} field "${fields[index] ?? ''}" is not ${spec.names ? `in ${spec.min}-${spec.max} or ${spec.names[0]}-${spec.names[spec.names.length - 1]}` : `in ${spec.min}-${spec.max}`}${spec.question ? ' (or ?)' : ''}`;
    }
    return undefined;
  }

  /** Whether a cron field fits its spec; month and weekday names count from 1 (JAN = 1, MON = 1). */
  private validCronField(field: string, spec: CronField): boolean {
    if (spec.quartz?.test(field)) return /^[0-9A-Za-z#?,\-/]+$/.test(field);
    if (spec.question && field === '?') return true;
    const value = (text: string): number | undefined => {
      const nameIndex = spec.names?.indexOf(text.toUpperCase()) ?? -1;
      const number = nameIndex >= 0 ? nameIndex + 1 : /^\d+$/.test(text) ? Number(text) : undefined;
      return number !== undefined && number >= spec.min && number <= spec.max ? number : undefined;
    };
    return field.split(',').every((part) => {
      const [range, step, ...rest] = part.split('/');
      if (rest.length || range === undefined || range === '') return false;
      if (step !== undefined && !(/^\d+$/.test(step) && Number(step) >= 1)) return false;
      if (range === '*') return true;
      const ends = range.split('-');
      if (ends.length === 1) return value(ends[0]!) !== undefined;
      if (ends.length !== 2) return false;
      const [low, high] = ends.map(value);
      return low !== undefined && high !== undefined && low <= high;
    });
  }
}
