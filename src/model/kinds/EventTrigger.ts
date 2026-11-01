import type { BpmnElement } from '../document/BpmnElement.js';
import { Triggers, type RootReference, type Trigger } from './Triggers.js';

export interface TriggerOptions {
  timer?: string | undefined;
  timerKind?: 'cycle' | 'duration' | 'date' | undefined;
  message?: string | undefined;
  error?: string | undefined;
  errorCode?: string | undefined;
  signal?: string | undefined;
  escalation?: string | undefined;
  escalationCode?: string | undefined;
  when?: string | undefined;
  link?: string | undefined;
  nonInterrupting?: boolean | undefined;
}

export class EventTrigger {
  static readonly ALWAYS_INTERRUPTING: readonly Trigger[] = ['error', 'cancel', 'compensate'];

  static readonly TIMER_PROPS: Readonly<Record<'cycle' | 'duration' | 'date', string>> = {
    cycle: 'timeCycle',
    duration: 'timeDuration',
    date: 'timeDate',
  };

  constructor(private readonly event: BpmnElement) {}

  static interruptingOnly(el: BpmnElement, trigger: Trigger): boolean {
    if (el.is('bpmn:BoundaryEvent')) {
      return EventTrigger.ALWAYS_INTERRUPTING.includes(trigger);
    }
    if (el.is('bpmn:StartEvent')) {
      return EventTrigger.ALWAYS_INTERRUPTING.includes(trigger) || trigger === 'none';
    }
    return true;
  }

  read(): { trigger: Trigger; opts: TriggerOptions } {
    const event = this.event;
    const trigger = Triggers.of(event) ?? 'none';
    const opts: TriggerOptions = {};
    const definition = event.get<BpmnElement[] | undefined>('eventDefinitions')?.[0];
    if (definition) {
      EventTrigger.readDefinition(definition, trigger, opts);
    }
    if (EventTrigger.isNonInterrupting(event)) {
      opts.nonInterrupting = true;
    }
    return { trigger, opts: Object.fromEntries(Object.entries(opts).filter(([, value]) => value !== undefined)) };
  }

  private static isNonInterrupting(event: BpmnElement): boolean {
    return (event.is('bpmn:BoundaryEvent') && event.get<boolean | undefined>('cancelActivity') === false) || (event.is('bpmn:StartEvent') && event.get<boolean | undefined>('isInterrupting') === false);
  }

  private static readDefinition(definition: BpmnElement, trigger: Trigger, opts: TriggerOptions): void {
    if (trigger === 'timer') {
      EventTrigger.readTimer(definition, opts);
    } else if (trigger === 'conditional') {
      opts.when = EventTrigger.bodyOf(definition.get<BpmnElement | undefined>('condition'));
    } else if (trigger === 'link') {
      opts.link = definition.get<string | undefined>('name');
    } else {
      const root = EventTrigger.rootReferenceOf(trigger);
      if (root) {
        EventTrigger.readRoot(definition, root, opts);
      }
    }
  }

  private static readTimer(definition: BpmnElement, opts: TriggerOptions): void {
    for (const kind of ['cycle', 'duration', 'date'] as const) {
      const timer = EventTrigger.bodyOf(definition.get<BpmnElement | undefined>(EventTrigger.TIMER_PROPS[kind]));
      if (timer) {
        Object.assign(opts, { timer, timerKind: kind });
        return;
      }
    }
  }

  private static bodyOf(expression: BpmnElement | undefined): string | undefined {
    return expression?.get<string | undefined>('body');
  }

  private static readRoot(def: BpmnElement, root: RootReference, opts: TriggerOptions): void {
    const ref = def.get<BpmnElement | undefined>(root.refProperty);
    opts[root.option] = ref?.get<string | undefined>('name') ?? ref?.get<string | undefined>('id');
    if (root.codeProperty) {
      opts[root.codeProperty] = ref?.get<string | undefined>(root.codeProperty);
    }
  }

  private static rootReferenceOf(trigger: Trigger): RootReference | undefined {
    return trigger === 'none' ? undefined : Triggers.TABLE[trigger].root;
  }
}
