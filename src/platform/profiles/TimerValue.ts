// what Camunda 8.9 parses (engine-checked on 60 values): an ISO 8601 period / duration (Java Period + Duration,
// split at an upper-case T; a fraction on the seconds only: PT1.5S, not PT1.5H), a date-time with offset or Z (an
// optional [zone] after it; t and z in either case), a repeating interval R[n]/[start/]duration, a 6-field cron
// expression or one of its macros
const PERIOD = /^[-+]?[Pp](?:[-+]?\d+[Yy])?(?:[-+]?\d+[Mm])?(?:[-+]?\d+[Ww])?(?:[-+]?\d+[Dd])?$/;
const DURATION = /^[-+]?P(?:T(?=[-+]?\d)(?:[-+]?\d+H)?(?:[-+]?\d+M)?(?:[-+]?\d+(?:[.,]\d{0,9})?S)?)$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:\d{2}(?::\d{2})?)(?:\[[^\]]+\])?$/;
const CRON_MACROS = ['@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The six fields of a cron expression (Spring's CronExpression, which Camunda 8 uses): range and names. */
interface CronField {
  name: string;
  min: number;
  max: number;
  names?: string[];
  /** `?` allowed (the day fields) */
  question?: boolean;
  /** Quartz forms of the field (not checked further) */
  quartz?: RegExp;
}

const CRON_FIELDS: CronField[] = [
  { name: 'second', min: 0, max: 59 },
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  // L, W: last day, nearest weekday
  { name: 'day-of-month', min: 1, max: 31, question: true, quartz: /[LW]/i },
  { name: 'month', min: 1, max: 12, names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] },
  // 0 and 7 are Sunday; L, #: last / nth weekday of the month
  { name: 'day-of-week', min: 0, max: 7, names: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], question: true, quartz: /[L#]/i },
];

export class TimerValue {
  constructor(private readonly value: string) {}

  isDuration(): boolean {
    const v = this.value.trim();
    const t = v.indexOf('T');
    if (t === -1) return PERIOD.test(v) && /\d/.test(v);
    const period = v.slice(0, t);
    if (!/^[-+]?[Pp]$/.test(period) && !(PERIOD.test(period) && /\d/.test(period))) return false;
    return DURATION.test(`P${v.slice(t)}`) && /\d/.test(v.slice(t));
  }

  /** An ISO 8601 date-time with offset that is a real instant (dateTimeRangeProblem). */
  isDateTime(): boolean {
    return DATE_TIME.test(this.value.trim()) && !this.dateTimeRangeProblem();
  }

  /**
   * Why a date-time of the right form is no real instant, or undefined: Java's
   * strict parse, which Camunda 8 uses (engine-checked: 2030-02-30 and 25:00
   * are refused): month 1-12, a day of that month (29 February in leap years),
   * hour 0-23, minute and second 0-59, an offset of at most 18 hours.
   */
  dateTimeRangeProblem(): string | undefined {
    const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2}))?/.exec(this.value.trim());
    if (!m) return undefined;
    const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number, number, number];
    if (mo < 1 || mo > 12) return `month ${m[2]} is not in 01-12`;
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
    if (d < 1 || d > days) return `${MONTHS[mo - 1]} ${y} has no day ${m[3]}`;
    if (h > 23) return `hour ${m[4]} is not in 00-23`;
    if (mi > 59) return `minute ${m[5]} is not in 00-59`;
    if (s > 59) return `second ${m[6]} is not in 00-59`;
    const offset = /([+-])(\d{2}):(\d{2})(?::(\d{2}))?(?:\[[^\]]+\])?$/.exec(this.value.trim());
    if (offset && (Number(offset[3]) > 59 || Number(offset[4] ?? 0) > 59 || Number(offset[2]) * 3600 + Number(offset[3]) * 60 + Number(offset[4] ?? 0) > 18 * 3600)) return `offset ${offset[0].replace(/\[.*$/, '')} is not within ±18:00`;
    return undefined;
  }

  isCycle(): boolean {
    const v = this.value.trim();
    const m = /^R-?\d*\/(.+)$/.exec(v);
    if (m) {
      const parts = m[1]!.split('/');
      if (parts.length === 1) return new TimerValue(parts[0]!).isDuration();
      if (parts.length === 2) return new TimerValue(parts[0]!).isDateTime() && new TimerValue(parts[1]!).isDuration();
      return false;
    }
    if (CRON_MACROS.includes(v)) return true;
    return v.split(/ +/).length === 6 && !v.startsWith('R') && !this.cronProblem();
  }

  /** Why a cycle of a valid form is refused (a date that is no real instant, a cron field out of range), or undefined. */
  cycleRangeProblem(): string | undefined {
    const v = this.value.trim();
    const m = /^R-?\d*\/(.+)\/.+$/.exec(v);
    if (m) return new TimerValue(m[1]!).dateTimeRangeProblem();
    return v.split(/ +/).length === 6 && !v.startsWith('R') ? this.cronProblem() : undefined;
  }

  /** Why Spring's CronExpression (which Camunda 8 uses) refuses a 6-field cron expression, or undefined. */
  cronProblem(): string | undefined {
    const fields = this.value.trim().split(/ +/);
    for (let i = 0; i < 6; i++) {
      const spec = CRON_FIELDS[i]!;
      if (!this.validCronField(fields[i] ?? '', spec)) return `the ${spec.name} field "${fields[i] ?? ''}" is not ${spec.names ? `in ${spec.min}-${spec.max} or ${spec.names[0]}-${spec.names[spec.names.length - 1]}` : `in ${spec.min}-${spec.max}`}${spec.question ? ' (or ?)' : ''}`;
    }
    return undefined;
  }

  /**
   * One cron field as Spring parses it (engine-checked on Camunda 8.9: an
   * hour 25 is refused): a list of `*`, values and ranges, each with an
   * optional `/step` of 1 or more; `?` in the day fields; month and weekday
   * names. A day field with a Quartz form (L, W, #) passes.
   */
  private validCronField(field: string, spec: CronField): boolean {
    if (spec.quartz?.test(field)) return /^[0-9A-Za-z#?,\-/]+$/.test(field);
    if (spec.question && field === '?') return true;
    const value = (text: string): number | undefined => {
      const i = spec.names?.indexOf(text.toUpperCase()) ?? -1;
      // names: 1-based (JAN = 1, MON = 1)
      const n = i >= 0 ? i + 1 : /^\d+$/.test(text) ? Number(text) : undefined;
      return n !== undefined && n >= spec.min && n <= spec.max ? n : undefined;
    };
    return field.split(',').every((part) => {
      const [range, step, ...rest] = part.split('/');
      if (rest.length || range === undefined || range === '') return false;
      if (step !== undefined && !(/^\d+$/.test(step) && Number(step) >= 1)) return false;
      if (range === '*') return true;
      const ends = range.split('-');
      if (ends.length === 1) return value(ends[0]!) !== undefined;
      if (ends.length !== 2) return false;
      const [a, b] = ends.map(value);
      return a !== undefined && b !== undefined && a <= b;
    });
  }
}
