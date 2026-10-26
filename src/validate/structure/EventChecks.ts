import type { Doc } from '../../model/Doc.js';
import { isEventSubProcess, kindLabel, kindOf, triggerOf, type Trigger } from '../../model/utils/kinds.js';
import { is, type El, peek, list, shownId } from '../../model/utils/moddle.js';
import { ALWAYS_INTERRUPTING as NON_INTERRUPTING_FORBIDDEN } from '../../ops/events/EventTrigger.js';
import type { StructureFindings } from './StructureFindings.js';

/** Triggers per event kind and scope, boundary hosts, and the start of event sub-processes. */
export class EventChecks {
  private static readonly EVENT_SUBPROCESS_ONLY_STARTS: Trigger[] = ['error', 'escalation', 'compensate'];

  constructor(
    private readonly doc: Doc,
    private readonly findings: StructureFindings,
  ) {}

  checkEvent(el: El, scope: El): void {
    const def = kindOf(el);
    if (!def?.triggers) return;
    const trigger = triggerOf(el);
    const eventDefs = list(el, 'eventDefinitions');
    if (!trigger) {
      this.findings.error('E_INVALID_TRIGGER', `${this.findings.describe(el)} has an unsupported event definition ${eventDefs[0]?.$type ?? ''}`, shownId(el), {
        hint: `Allowed triggers for ${def.kind}: ${def.triggers.join(', ')}. Change it with \`bpmn set <file> ${shownId(el)} trigger=<trigger>\`.`,
      });
      return;
    }
    if (!def.triggers.includes(trigger)) {
      this.findings.error('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def.kind} ${shownId(el)}`, shownId(el), {
        hint: `Allowed triggers for ${def.kind}: ${def.triggers.join(', ')}. Change it with \`bpmn set <file> ${shownId(el)} trigger=<trigger>\` or retype the event.`,
      });
      return;
    }
    if (is(el, 'bpmn:StartEvent')) this.checkStartTrigger(el, scope, trigger);
    if (is(el, 'bpmn:EndEvent') && trigger === 'cancel') this.checkCancelEnd(el, scope);
  }

  private checkStartTrigger(el: El, scope: El, trigger: Trigger): void {
    const inEventSub = isEventSubProcess(scope);
    if (EventChecks.EVENT_SUBPROCESS_ONLY_STARTS.includes(trigger) && !inEventSub) {
      this.findings.error('E_INVALID_TRIGGER', `startEvent:${trigger} ${shownId(el)} is only allowed inside an event sub-process`, shownId(el), {
        hint: 'Move it into an eventSubProcess (`bpmn add <file> eventSubProcess "<Name>" --in <scope>`, then `bpmn move <file> <id> --in <eventSubProcessId>`) or use trigger none/message/timer/signal/conditional.',
      });
    } else if (!inEventSub && is(scope, 'bpmn:SubProcess') && trigger !== 'none') {
      this.findings.error('E_INVALID_TRIGGER', `startEvent:${trigger} ${shownId(el)} inside embedded sub-process ${shownId(scope)} must have no trigger`, shownId(el), {
        hint: `Use \`bpmn set <file> ${shownId(el)} trigger=none\`; triggered starts belong to the process or to an event sub-process.`,
      });
    }
    if (!inEventSub && peek<boolean>(el, 'isInterrupting') === false) {
      this.findings.error('E_INVALID_TRIGGER', `Non-interrupting start event ${shownId(el)} is only allowed inside an event sub-process`, shownId(el), {
        hint: `Use \`bpmn set <file> ${shownId(el)} nonInterrupting=false\`.`,
      });
    }
  }

  private checkCancelEnd(el: El, scope: El): void {
    if (is(scope, 'bpmn:Transaction')) return;
    this.findings.error('E_INVALID_TRIGGER', `endEvent:cancel ${shownId(el)} is only allowed inside a transaction sub-process`, shownId(el), {
      hint: 'Use a transaction (`bpmn add <file> transaction "<Name>" ...`) or another end trigger (none, error, terminate, ...).',
    });
  }

  checkBoundaryEvent(el: El, scope: El): void {
    const host = peek<El>(el, 'attachedToRef');
    if (!host) {
      this.findings.error('E_NO_HOST', `${this.findings.describe(el)} is not attached to any activity`, shownId(el), {
        hint: `Boundary events need a host: \`bpmn remove <file> ${shownId(el)}\` and re-add it with --on <activityId>.`,
      });
      return;
    }
    if (!is(host, 'bpmn:Activity')) {
      this.findings.error('E_INVALID_HOST', `${this.findings.describe(el)} is attached to ${this.findings.describe(host)}, which is not an activity`, shownId(el), {
        related: [shownId(host)],
        hint: 'Boundary events attach to tasks, sub-processes and call activities only.',
      });
      return;
    }
    if (this.doc.scopeOf(host) !== scope) {
      this.findings.error('E_INVALID_HOST', `${this.findings.describe(el)} is declared in ${shownId(scope)} but its host ${shownId(host)} is in ${shownId(this.doc.scopeOf(host))}`, shownId(el), {
        related: [shownId(host)],
        hint: `Move the boundary event next to its host: \`bpmn remove <file> ${shownId(el)}\` and re-add it with --on ${shownId(host)}.`,
      });
    }
    // bpmn-js does not attach boundary events to a compensation handler,
    // and Camunda 7 / CIB seven / Operaton refuse the file
    if (peek<boolean>(host, 'isForCompensation') === true) {
      this.findings.error('E_INVALID_HOST', `${this.findings.describe(el)} is attached to ${shownId(host)}, a compensation handler (isForCompensation=true), which cannot carry boundary events`, shownId(el), {
        related: [shownId(host)],
        hint: `Remove it (\`bpmn remove <file> ${shownId(el)}\`), attach it to a normal activity (\`bpmn move <file> ${shownId(el)} --on <activityId>\`), or make ${shownId(host)} a normal activity (\`bpmn set <file> ${shownId(host)} isForCompensation=false\`).`,
      });
    }
    // an event sub-process has no place in the flow to interrupt or leave
    if (isEventSubProcess(host)) {
      this.findings.error('E_INVALID_HOST', `${this.findings.describe(el)} is attached to ${shownId(host)}, an event sub-process, which cannot carry boundary events`, shownId(el), {
        related: [shownId(host)],
        hint: `Remove it (\`bpmn remove <file> ${shownId(el)}\`) or attach it to an activity in the flow (\`bpmn move <file> ${shownId(el)} --on <activityId>\`).`,
      });
    }
    const trigger = triggerOf(el);
    if (trigger && peek<boolean>(el, 'cancelActivity') === false && NON_INTERRUPTING_FORBIDDEN.includes(trigger)) {
      this.findings.error('E_INVALID_TRIGGER', `boundaryEvent:${trigger} ${shownId(el)} cannot be non-interrupting`, shownId(el), {
        hint: `Error, cancel and compensate boundary events always interrupt: \`bpmn set <file> ${shownId(el)} nonInterrupting=false\`.`,
      });
    }
    if (trigger === 'cancel' && !is(host, 'bpmn:Transaction')) {
      this.findings.error('E_INVALID_TRIGGER', `boundaryEvent:cancel ${shownId(el)} must be attached to a transaction (host ${shownId(host)} is a ${kindLabel(host)})`, shownId(el), {
        related: [shownId(host)],
        hint: 'Cancel boundary events only work on transaction sub-processes.',
      });
    }
  }

  checkEventSubProcess(sub: El): void {
    const starts = this.doc.flowNodes(sub).filter((node) => is(node, 'bpmn:StartEvent'));
    if (!starts.length) {
      this.findings.error('E_EVENT_SUBPROCESS_NO_START', `Event sub-process ${shownId(sub)} has no start event`, shownId(sub), {
        hint: `Create it with its trigger in one command: \`bpmn add <file> eventSubProcess:<message|timer|signal|conditional|error|escalation|compensate> "<Name>" --in <scope>\` (the start event is created inside), or add the sub-process and its startEvent:<trigger> together in one batch: \`bpmn apply <file> ops.json\`.`,
      });
      return;
    }
    for (const start of starts) {
      if (triggerOf(start) === 'none') {
        this.findings.error('E_EVENT_SUBPROCESS_PLAIN_START', `Start event ${shownId(start)} of event sub-process ${shownId(sub)} has no trigger`, shownId(start), {
          related: [shownId(sub)],
          hint: `Event sub-processes start on a trigger: \`bpmn set <file> ${shownId(start)} trigger=message|timer|error|signal|escalation|conditional|compensate\`.`,
        });
      }
    }
  }
}
