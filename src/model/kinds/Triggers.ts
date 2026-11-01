import type { BpmnElement } from '../document/BpmnElement.js';

export type Trigger = 'none' | 'message' | 'timer' | 'error' | 'signal' | 'escalation' | 'conditional' | 'link' | 'compensate' | 'terminate' | 'cancel';

export type DefinedTrigger = Exclude<Trigger, 'none'>;

export interface RootReference {
  option: 'message' | 'error' | 'signal' | 'escalation';
  refProperty: string;
  codeProperty?: 'errorCode' | 'escalationCode';
}

export interface TriggerDefinition {
  definition: string;
  root?: RootReference;
}

export class Triggers {
  static readonly TABLE: Readonly<Record<DefinedTrigger, TriggerDefinition>> = {
    message: { definition: 'bpmn:MessageEventDefinition', root: { option: 'message', refProperty: 'messageRef' } },
    timer: { definition: 'bpmn:TimerEventDefinition' },
    error: { definition: 'bpmn:ErrorEventDefinition', root: { option: 'error', refProperty: 'errorRef', codeProperty: 'errorCode' } },
    signal: { definition: 'bpmn:SignalEventDefinition', root: { option: 'signal', refProperty: 'signalRef' } },
    escalation: { definition: 'bpmn:EscalationEventDefinition', root: { option: 'escalation', refProperty: 'escalationRef', codeProperty: 'escalationCode' } },
    conditional: { definition: 'bpmn:ConditionalEventDefinition' },
    link: { definition: 'bpmn:LinkEventDefinition' },
    compensate: { definition: 'bpmn:CompensateEventDefinition' },
    terminate: { definition: 'bpmn:TerminateEventDefinition' },
    cancel: { definition: 'bpmn:CancelEventDefinition' },
  };

  static readonly EVENT_GATEWAY_TRIGGERS: readonly Trigger[] = ['message', 'timer', 'signal', 'conditional'];

  private static readonly ALIASES: Readonly<Record<string, Trigger>> = { compensation: 'compensate', condition: 'conditional', msg: 'message', time: 'timer' };

  static normalize(raw: string): Trigger | undefined {
    const token = raw.trim().toLowerCase();
    if (!token) {
      return undefined;
    }
    return Triggers.ALIASES[token] ?? (['none', ...Object.keys(Triggers.TABLE)] as Trigger[]).find((trigger) => trigger === token);
  }

  static of(element: BpmnElement): Trigger | undefined {
    if (!element.is('bpmn:Event')) {
      return undefined;
    }
    const first = element.get<BpmnElement[] | undefined>('eventDefinitions')?.[0];
    return first ? Triggers.ofDefinition(first) : 'none';
  }

  static ofDefinition(definition: BpmnElement): DefinedTrigger | undefined {
    return (Object.keys(Triggers.TABLE) as DefinedTrigger[]).find((trigger) => definition.is(Triggers.TABLE[trigger].definition));
  }

  static isLinkThrow(element: BpmnElement): boolean {
    return element.is('bpmn:IntermediateThrowEvent') && Triggers.of(element) === 'link';
  }

  static isLinkCatch(element: BpmnElement): boolean {
    return element.is('bpmn:IntermediateCatchEvent') && Triggers.of(element) === 'link';
  }
}
