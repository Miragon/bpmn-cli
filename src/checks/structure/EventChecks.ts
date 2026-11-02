import { type BpmnDocument, type BpmnElement, ElementText, EventTrigger, Kinds, type Trigger, Triggers } from '../../model/index.js';
import type { StructureFindings } from './StructureFindings.js';

export class EventChecks {
  private static readonly EVENT_SUBPROCESS_ONLY_STARTS: Trigger[] = ['error', 'escalation', 'compensate'];

  constructor(
    private readonly document: BpmnDocument,
    private readonly findings: StructureFindings,
  ) {}

  checkEvent(el: BpmnElement, scope: BpmnElement): void {
    const def = Kinds.of(el);
    if (!def?.triggers) {
      return;
    }
    const trigger = Triggers.of(el);
    const eventDefs = el.list('eventDefinitions');
    if (!trigger) {
      this.findings.error('E_INVALID_TRIGGER', `${this.findings.describe(el)} has an unsupported event definition ${eventDefs[0]?.type ?? ''}`, ElementText.shownId(el), { hint: `Allowed triggers for ${def.kind}: ${def.triggers.join(', ')}. Change it with \`bpmn set <file> ${ElementText.shownId(el)} trigger=<trigger>\`.` });
      return;
    }
    if (!def.triggers.includes(trigger)) {
      this.findings.error('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def.kind} ${ElementText.shownId(el)}`, ElementText.shownId(el), { hint: `Allowed triggers for ${def.kind}: ${def.triggers.join(', ')}. Change it with \`bpmn set <file> ${ElementText.shownId(el)} trigger=<trigger>\` or retype the event.` });
      return;
    }
    if (el.is('bpmn:StartEvent')) {
      this.checkStartTrigger(el, scope, trigger);
    }
    if (el.is('bpmn:EndEvent') && trigger === 'cancel') {
      this.checkCancelEnd(el, scope);
    }
  }

  private checkStartTrigger(el: BpmnElement, scope: BpmnElement, trigger: Trigger): void {
    const inEventSub = Kinds.isEventSubProcess(scope);
    if (EventChecks.EVENT_SUBPROCESS_ONLY_STARTS.includes(trigger) && !inEventSub) {
      this.findings.error('E_INVALID_TRIGGER', `startEvent:${trigger} ${ElementText.shownId(el)} is only allowed inside an event sub-process`, ElementText.shownId(el), { hint: 'Move it into an eventSubProcess (`bpmn add <file> eventSubProcess "<Name>" --in <scope>`, then `bpmn move <file> <id> --in <eventSubProcessId>`) or use trigger none/message/timer/signal/conditional.' });
    } else if (!inEventSub && scope.is('bpmn:SubProcess') && trigger !== 'none') {
      this.findings.error('E_INVALID_TRIGGER', `startEvent:${trigger} ${ElementText.shownId(el)} inside embedded sub-process ${ElementText.shownId(scope)} must have no trigger`, ElementText.shownId(el), { hint: `Use \`bpmn set <file> ${ElementText.shownId(el)} trigger=none\`; triggered starts belong to the process or to an event sub-process.` });
    }
    if (!inEventSub && el.peek<boolean>('isInterrupting') === false) {
      this.findings.error('E_INVALID_TRIGGER', `Non-interrupting start event ${ElementText.shownId(el)} is only allowed inside an event sub-process`, ElementText.shownId(el), { hint: `Use \`bpmn set <file> ${ElementText.shownId(el)} nonInterrupting=false\`.` });
    }
  }

  private checkCancelEnd(el: BpmnElement, scope: BpmnElement): void {
    if (scope.is('bpmn:Transaction')) {
      return;
    }
    this.findings.error('E_INVALID_TRIGGER', `endEvent:cancel ${ElementText.shownId(el)} is only allowed inside a transaction sub-process`, ElementText.shownId(el), { hint: 'Use a transaction (`bpmn add <file> transaction "<Name>" ...`) or another end trigger (none, error, terminate, ...).' });
  }

  checkBoundaryEvent(el: BpmnElement, scope: BpmnElement): void {
    const host = el.peek<BpmnElement>('attachedToRef');
    if (!host) {
      this.findings.error('E_NO_HOST', `${this.findings.describe(el)} is not attached to any activity`, ElementText.shownId(el), { hint: `Boundary events need a host: \`bpmn remove <file> ${ElementText.shownId(el)}\` and re-add it with --on <activityId>.` });
      return;
    }
    if (!host.is('bpmn:Activity')) {
      this.findings.error('E_INVALID_HOST', `${this.findings.describe(el)} is attached to ${this.findings.describe(host)}, which is not an activity`, ElementText.shownId(el), { related: [ElementText.shownId(host)], hint: 'Boundary events attach to tasks, sub-processes and call activities only.' });
      return;
    }
    if (this.document.scopes.scopeOf(host) !== scope) {
      this.findings.error('E_INVALID_HOST', `${this.findings.describe(el)} is declared in ${ElementText.shownId(scope)} but its host ${ElementText.shownId(host)} is in ${ElementText.shownId(this.document.scopes.scopeOf(host))}`, ElementText.shownId(el), { related: [ElementText.shownId(host)], hint: `Move the boundary event next to its host: \`bpmn remove <file> ${ElementText.shownId(el)}\` and re-add it with --on ${ElementText.shownId(host)}.` });
    }
    if (host.peek<boolean>('isForCompensation') === true) {
      this.findings.error('E_INVALID_HOST', `${this.findings.describe(el)} is attached to ${ElementText.shownId(host)}, a compensation handler (isForCompensation=true), which cannot carry boundary events`, ElementText.shownId(el), { related: [ElementText.shownId(host)], hint: `Remove it (\`bpmn remove <file> ${ElementText.shownId(el)}\`), attach it to a normal activity (\`bpmn move <file> ${ElementText.shownId(el)} --on <activityId>\`), or make ${ElementText.shownId(host)} a normal activity (\`bpmn set <file> ${ElementText.shownId(host)} isForCompensation=false\`).` });
    }
    if (Kinds.isEventSubProcess(host)) {
      this.findings.error('E_INVALID_HOST', `${this.findings.describe(el)} is attached to ${ElementText.shownId(host)}, an event sub-process, which cannot carry boundary events`, ElementText.shownId(el), { related: [ElementText.shownId(host)], hint: `Remove it (\`bpmn remove <file> ${ElementText.shownId(el)}\`) or attach it to an activity in the flow (\`bpmn move <file> ${ElementText.shownId(el)} --on <activityId>\`).` });
    }
    const trigger = Triggers.of(el);
    if (trigger && el.peek<boolean>('cancelActivity') === false && EventTrigger.ALWAYS_INTERRUPTING.includes(trigger)) {
      this.findings.error('E_INVALID_TRIGGER', `boundaryEvent:${trigger} ${ElementText.shownId(el)} cannot be non-interrupting`, ElementText.shownId(el), { hint: `Error, cancel and compensate boundary events always interrupt: \`bpmn set <file> ${ElementText.shownId(el)} nonInterrupting=false\`.` });
    }
    if (trigger === 'cancel' && !host.is('bpmn:Transaction')) {
      this.findings.error('E_INVALID_TRIGGER', `boundaryEvent:cancel ${ElementText.shownId(el)} must be attached to a transaction (host ${ElementText.shownId(host)} is a ${Kinds.label(host)})`, ElementText.shownId(el), { related: [ElementText.shownId(host)], hint: 'Cancel boundary events only work on transaction sub-processes.' });
    }
  }

  checkEventSubProcess(sub: BpmnElement): void {
    const starts = this.document.scopes.flowNodes(sub).filter((node) => node.is('bpmn:StartEvent'));
    if (!starts.length) {
      this.findings.error('E_EVENT_SUBPROCESS_NO_START', `Event sub-process ${ElementText.shownId(sub)} has no start event`, ElementText.shownId(sub), { hint: `Create it with its trigger in one command: \`bpmn add <file> eventSubProcess:<message|timer|signal|conditional|error|escalation|compensate> "<Name>" --in <scope>\` (the start event is created inside), or add the sub-process and its startEvent:<trigger> together in one batch: \`bpmn apply <file> ops.json\`.` });
      return;
    }
    for (const start of starts) {
      if (Triggers.of(start) === 'none') {
        this.findings.error('E_EVENT_SUBPROCESS_PLAIN_START', `Start event ${ElementText.shownId(start)} of event sub-process ${ElementText.shownId(sub)} has no trigger`, ElementText.shownId(start), { related: [ElementText.shownId(sub)], hint: `Event sub-processes start on a trigger: \`bpmn set <file> ${ElementText.shownId(start)} trigger=message|timer|error|signal|escalation|conditional|compensate\`.` });
      }
    }
  }
}
