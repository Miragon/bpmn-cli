import { triggerOf, type Trigger } from '../../document/utils/kinds.js';
import { is, many, type El, idOf } from '../../document/utils/moddle.js';
import type { TriggerOptions } from '../../commands/types.js';

export interface TriggerDetails {
  trigger: Trigger;
  timer?: { kind: 'cycle' | 'duration' | 'date'; value: string };
  message?: { id: string; name?: string };
  error?: { id: string; name?: string; code?: string };
  signal?: { id: string; name?: string };
  escalation?: { id: string; name?: string; code?: string };
  condition?: string;
  link?: string;
  nonInterrupting?: boolean;
}

/** Triggers that always interrupt: never on a non-interrupting boundary or start event. */
export const ALWAYS_INTERRUPTING: Trigger[] = ['error', 'cancel', 'compensate'];

export const TRIGGER_OPTION_KEYS: ReadonlyArray<keyof TriggerOptions> = ['timer', 'timerKind', 'message', 'error', 'errorCode', 'signal', 'escalation', 'escalationCode', 'when', 'link', 'nonInterrupting'];

export const TIMER_PROPS: Record<'cycle' | 'duration' | 'date', string> = {
  cycle: 'timeCycle',
  duration: 'timeDuration',
  date: 'timeDate',
};

type RefInfo = { id: string; name?: string; code?: string };

/**
 * An event's trigger as the model has it: as `set` / `add` options, as --json details
 * or as a short text ("PT2D", "message OrderReceived").
 */
export class EventTrigger {
  constructor(private readonly event: El) {}

  /** Only boundary and start events can be non-interrupting, and not with every trigger. */
  static interruptingOnly(el: El, trigger: Trigger): boolean {
    if (is(el, 'bpmn:BoundaryEvent')) return ALWAYS_INTERRUPTING.includes(trigger);
    if (is(el, 'bpmn:StartEvent')) return ALWAYS_INTERRUPTING.includes(trigger) || trigger === 'none';
    return true;
  }

  static optionsOf(source: TriggerOptions): TriggerOptions {
    const out: Record<string, unknown> = {};
    for (const key of TRIGGER_OPTION_KEYS) if (source[key] !== undefined) out[key] = source[key];
    return out as TriggerOptions;
  }

  read(): { trigger: Trigger; opts: TriggerOptions } {
    const el = this.event;
    const trigger = triggerOf(el) ?? 'none';
    const opts: TriggerOptions = {};
    const def = (el.get<El[] | undefined>('eventDefinitions') ?? [])[0];
    const body = (propName: string): string | undefined => def?.get<El | undefined>(propName)?.get<string | undefined>('body');
    const ref = (propName: string): El | undefined => def?.get<El | undefined>(propName);
    const named = (propName: string): string | undefined => ref(propName)?.get<string | undefined>('name') ?? ref(propName)?.get<string | undefined>('id');
    if (def) {
      switch (trigger) {
        case 'timer': {
          const cycle = body('timeCycle');
          const duration = body('timeDuration');
          const date = body('timeDate');
          if (cycle) Object.assign(opts, { timer: cycle, timerKind: 'cycle' });
          else if (duration) Object.assign(opts, { timer: duration, timerKind: 'duration' });
          else if (date) Object.assign(opts, { timer: date, timerKind: 'date' });
          break;
        }
        case 'message':
          opts.message = named('messageRef');
          break;
        case 'error':
          opts.error = named('errorRef');
          opts.errorCode = ref('errorRef')?.get<string | undefined>('errorCode');
          break;
        case 'signal':
          opts.signal = named('signalRef');
          break;
        case 'escalation':
          opts.escalation = named('escalationRef');
          opts.escalationCode = ref('escalationRef')?.get<string | undefined>('escalationCode');
          break;
        case 'conditional':
          opts.when = body('condition');
          break;
        case 'link':
          opts.link = def.get<string | undefined>('name');
          break;
        default:
          break;
      }
    }
    if (is(el, 'bpmn:BoundaryEvent') && el.get<boolean | undefined>('cancelActivity') === false) opts.nonInterrupting = true;
    if (is(el, 'bpmn:StartEvent') && el.get<boolean | undefined>('isInterrupting') === false) opts.nonInterrupting = true;
    for (const optionKey of Object.keys(opts) as Array<keyof TriggerOptions>) if (opts[optionKey] === undefined) delete opts[optionKey];
    return { trigger, opts };
  }

  details(): TriggerDetails | undefined {
    const event = this.event;
    if (!is(event, 'bpmn:Event')) return undefined;
    const trigger = triggerOf(event) ?? 'none';
    const details: TriggerDetails = { trigger };
    const def = many(event, 'eventDefinitions')[0];
    if (def) {
      switch (trigger) {
        case 'timer': {
          for (const kind of ['cycle', 'duration', 'date'] as const) {
            const value = EventTrigger.bodyOf(def.get<El | undefined>(TIMER_PROPS[kind]));
            if (value) details.timer = { kind, value };
          }
          break;
        }
        case 'message': {
          const info = EventTrigger.refInfo(def.get<El | undefined>('messageRef'));
          if (info) details.message = info;
          break;
        }
        case 'error': {
          const info = EventTrigger.refInfo(def.get<El | undefined>('errorRef'), 'errorCode');
          if (info) details.error = info;
          break;
        }
        case 'signal': {
          const info = EventTrigger.refInfo(def.get<El | undefined>('signalRef'));
          if (info) details.signal = info;
          break;
        }
        case 'escalation': {
          const info = EventTrigger.refInfo(def.get<El | undefined>('escalationRef'), 'escalationCode');
          if (info) details.escalation = info;
          break;
        }
        case 'conditional': {
          const condition = EventTrigger.bodyOf(def.get<El | undefined>('condition'));
          if (condition) details.condition = condition;
          break;
        }
        case 'link': {
          const link = def.get<string | undefined>('name');
          if (link) details.link = link;
          break;
        }
        default:
          break;
      }
    }
    if (is(event, 'bpmn:BoundaryEvent') && event.get<boolean>('cancelActivity') === false) details.nonInterrupting = true;
    if (is(event, 'bpmn:StartEvent') && event.get<boolean>('isInterrupting') === false) details.nonInterrupting = true;
    return details;
  }

  describe(): string {
    const details = this.details();
    if (!details || details.trigger === 'none') return '';
    switch (details.trigger) {
      case 'timer':
        return details.timer ? details.timer.value : 'timer';
      case 'message':
        return EventTrigger.named(details.message, 'message');
      case 'error':
        return EventTrigger.named(details.error, 'error');
      case 'signal':
        return EventTrigger.named(details.signal, 'signal');
      case 'escalation':
        return EventTrigger.named(details.escalation, 'escalation');
      case 'conditional':
        return details.condition ? `condition ${details.condition}` : 'conditional';
      case 'link':
        return details.link ? `link ${details.link}` : 'link';
      default:
        return details.trigger;
    }
  }

  private static refInfo(ref: El | undefined, codeProp?: string): RefInfo | undefined {
    if (!ref) return undefined;
    const name = ref.get<string | undefined>('name');
    const code = codeProp ? ref.get<string | undefined>(codeProp) : undefined;
    return { id: idOf(ref), ...(name ? { name } : {}), ...(code ? { code } : {}) };
  }

  private static bodyOf(expr: El | undefined): string | undefined {
    return expr?.get<string | undefined>('body');
  }

  private static named(info: RefInfo | undefined, fallback: string): string {
    if (!info) return fallback;
    return `${fallback} ${info.name ?? info.id}${info.code ? ` (${info.code})` : ''}`;
  }
}
