import { type BpmnElement, BpmnError, EventTrigger, Kinds, type Trigger, type TriggerOptions } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export class InterruptingFlag {
  constructor(private readonly edit: EditSession) {}

  apply(event: BpmnElement, trigger: Trigger, opts: TriggerOptions): void {
    const want = opts.nonInterrupting;
    const interruptingOnly = EventTrigger.ALWAYS_INTERRUPTING.includes(trigger);
    if (event.is('bpmn:BoundaryEvent')) {
      InterruptingFlag.applyOnBoundary(event, trigger, want, interruptingOnly);
      return;
    }
    if (event.is('bpmn:StartEvent')) {
      this.applyOnStart(event, trigger, want, interruptingOnly);
      return;
    }
    if (want === true) {
      throw BpmnError.model('E_INVALID_TRIGGER', `nonInterrupting only applies to boundary events and event sub-process start events (${event.id} is a ${Kinds.of(event)?.kind ?? event.type})`, {
        element: event.id,
      });
    }
  }

  private static applyOnBoundary(event: BpmnElement, trigger: Trigger, want: boolean | undefined, interruptingOnly: boolean): void {
    if (want === true) {
      if (interruptingOnly) {
        throw BpmnError.model('E_INVALID_TRIGGER', `A ${trigger} boundary event cannot be non-interrupting`, {
          element: event.id,
          hint: 'Only message, timer, signal, escalation and conditional boundary events can be non-interrupting.',
        });
      }
      event.set('cancelActivity', false);
    } else if (want === false || (interruptingOnly && event.get<boolean>('cancelActivity') === false)) {
      event.set('cancelActivity', undefined);
    }
  }

  private applyOnStart(event: BpmnElement, trigger: Trigger, want: boolean | undefined, interruptingOnly: boolean): void {
    if (want === true) {
      this.assertStartCanBeNonInterrupting(event, trigger, interruptingOnly);
      event.set('isInterrupting', false);
    } else if (want === false || (interruptingOnly && event.get<boolean>('isInterrupting') === false)) {
      event.set('isInterrupting', undefined);
    }
  }

  private assertStartCanBeNonInterrupting(event: BpmnElement, trigger: Trigger, interruptingOnly: boolean): void {
    if (!Kinds.isEventSubProcess(this.edit.document.scopes.scopeOf(event))) {
      throw BpmnError.model('E_INVALID_TRIGGER', `Start event ${event.id} is not inside an event sub-process and cannot be non-interrupting`, {
        element: event.id,
        hint: 'Only start events of an eventSubProcess can be non-interrupting.',
      });
    }
    if (interruptingOnly || trigger === 'none') {
      throw BpmnError.model('E_INVALID_TRIGGER', `A ${trigger} start event cannot be non-interrupting`, {
        element: event.id,
        hint: 'Only message, timer, signal, escalation and conditional start events can be non-interrupting.',
      });
    }
  }
}
