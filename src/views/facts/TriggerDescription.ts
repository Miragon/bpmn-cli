import { EventTrigger, Triggers, type BpmnElement, type Trigger } from '../../model/index.js';

export class TriggerDescription {
  constructor(private readonly event: BpmnElement) {}

  private static body(expression: BpmnElement | undefined): string | undefined {
    return expression?.get<string | undefined>('body');
  }

  private static timer(definition: BpmnElement): string | undefined {
    const kinds = ['date', 'duration', 'cycle'] as const;
    return kinds.map((kind) => TriggerDescription.body(definition.get<BpmnElement | undefined>(EventTrigger.TIMER_PROPS[kind]))).find(Boolean);
  }

  private static rootText(definition: BpmnElement | undefined, trigger: Exclude<Trigger, 'none'>): string {
    const root = Triggers.TABLE[trigger].root;
    const reference = root && definition?.get<BpmnElement | undefined>(root.refProperty);
    if (!root || !reference) {
      return root?.option ?? trigger;
    }
    const code = root.codeProperty ? reference.get<string | undefined>(root.codeProperty) : undefined;
    return `${root.option} ${reference.get<string | undefined>('name') ?? reference.id}${code ? ` (${code})` : ''}`;
  }

  text(): string | undefined {
    const { event } = this;
    const trigger = event.is('bpmn:Event') ? (Triggers.of(event) ?? 'none') : 'none';
    if (trigger === 'none') {
      return undefined;
    }
    const definition = event.list('eventDefinitions')[0];
    if (trigger === 'timer') {
      return (definition && TriggerDescription.timer(definition)) ?? 'timer';
    }
    if (trigger === 'conditional') {
      const condition = TriggerDescription.body(definition?.get<BpmnElement | undefined>('condition'));
      return condition ? `condition ${condition}` : 'conditional';
    }
    if (trigger === 'link') {
      const link = definition?.get<string | undefined>('name');
      return link ? `link ${link}` : 'link';
    }
    return TriggerDescription.rootText(definition, trigger);
  }
}
