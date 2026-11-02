import { type BpmnElement, IdWords, Kinds } from '../../../model/index.js';
import type { C8DefinitionRules } from './C8DefinitionRules.js';
import { C8Rules } from './C8Rules.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';

export class C8EventRules extends C8Rules {
  constructor(
    context: RuleContext,
    private readonly definitions: C8DefinitionRules,
  ) {
    super(context);
  }

  check(element: BpmnElement, reporter: RuleReporter): void {
    if (element.is('bpmn:Event')) {
      this.checkEvent(element, reporter);
    }
    if (element.is('bpmn:BoundaryEvent')) {
      C8EventRules.checkBoundaryHost(element, reporter);
    }
  }

  private static checkBoundaryHost(el: BpmnElement, reporter: RuleReporter): void {
    const host = el.peek<BpmnElement>('attachedToRef');
    if (host && host.peek<boolean>('isForCompensation') === true) {
      reporter.deploy({ code: 'W_C8_DEPLOY_BOUNDARY_HOST', element: el, subject: 'compensationHost', message: `Boundary event ${el.id} is attached to the compensation handler ${host.id}; Camunda 8 refuses boundary events on compensation handlers`, hint: `Remove it: \`bpmn remove <file> ${el.id}\` (or attach it to a normal activity: \`bpmn move <file> ${el.id} --on <activityId>\`).`, related: [host.id], fix: { op: 'remove', ids: [el.id] } });
    }
  }

  checkEvent(el: BpmnElement, reporter: RuleReporter): void {
    const defs = el.list('eventDefinitions');
    if (defs.length > 1) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_DEFINITION', element: el, subject: 'definitions', message: `${this.describe(el)} has ${defs.length} event definitions (${defs.map((definition) => this.triggerName(definition)).join(', ')}); Camunda 8 allows one and refuses the file`, hint: `Keep one: \`bpmn set <file> ${el.id} trigger=<${defs.map((definition) => this.triggerName(definition)).join('|')}>\` (keeps that definition, drops the others), and model each other trigger as its own event.` });
      return;
    }
    const def = defs[0];
    if (!def) {
      this.checkMissingDefinition(el, reporter);
      return;
    }
    if (this.reportUnsupportedPosition(el, def, reporter)) {
      return;
    }
    this.checkDefinitionId(el, def, reporter);
    this.definitions.checkDefinition(el, def, reporter);
  }

  private checkMissingDefinition(el: BpmnElement, reporter: RuleReporter): void {
    const parent = el.parent;
    if (el.is('bpmn:IntermediateCatchEvent') || el.is('bpmn:BoundaryEvent')) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_DEFINITION', element: el, subject: 'none', message: `${this.describe(el)} has no event definition; Camunda 8 refuses ${el.is('bpmn:BoundaryEvent') ? 'boundary' : 'intermediate catch'} events without a trigger`, hint: `Give it one: \`bpmn set <file> ${el.id} trigger=timer timer=PT1H\` (or message, signal, ...).` });
    }
    if (el.is('bpmn:StartEvent') && Kinds.isEventSubProcess(parent)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_DEFINITION', element: el, subject: 'eventSubStart', message: `Start event ${el.id} of event sub-process ${parent?.id} has no trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file`, hint: `\`bpmn set <file> ${el.id} trigger=message message=<MessageName>\` (or timer, error, signal, escalation, conditional).` });
    }
  }

  private reportUnsupportedPosition(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): boolean {
    const parent = el.parent;
    const trigger = this.triggerName(def);
    if (def.is('bpmn:CancelEventDefinition')) {
      reporter.deploy({ code: 'W_C8_DEPLOY_UNSUPPORTED', element: el, subject: 'cancel', message: `${this.describe(el)} is a cancel event; Camunda 8 does not support cancel events (nor transactions) and refuses the file`, hint: `\`bpmn set <file> ${el.id} trigger=${el.is('bpmn:BoundaryEvent') ? 'error' : 'none'}\`${el.is('bpmn:BoundaryEvent') ? ' (an error boundary event)' : ''}.` });
      return true;
    }
    if (!el.is('bpmn:StartEvent')) {
      return false;
    }
    if (parent && parent.is('bpmn:SubProcess') && !Kinds.isEventSubProcess(parent) && !parent.is('bpmn:AdHocSubProcess')) {
      reporter.deploy({ code: 'W_C8_DEPLOY_START_EVENT', element: el, subject: 'subStartType', message: `Start event ${el.id} of sub-process ${parent.id} has a ${trigger} trigger; Camunda 8 allows only a none start event in an embedded sub-process and refuses the file`, hint: `\`bpmn set <file> ${el.id} trigger=none\` (an event sub-process takes triggered starts: \`bpmn add <file> eventSubProcess:${trigger} ... --in ${parent.id}\`).`, fix: { op: 'set', id: el.id, set: { trigger: 'none' } } });
      return true;
    }
    if (Kinds.isEventSubProcess(parent) && def.is('bpmn:CompensateEventDefinition')) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_DEFINITION', element: el, subject: 'eventSubStart', message: `Start event ${el.id} of event sub-process ${parent?.id} has a compensation trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file`, hint: `\`bpmn set <file> ${el.id} trigger=<message|timer|error|signal|escalation|conditional>\`.` });
      return true;
    }
    return false;
  }

  private checkDefinitionId(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const needsId = def.is('bpmn:ConditionalEventDefinition') || def.is('bpmn:CompensateEventDefinition') || (def.is('bpmn:LinkEventDefinition') && el.is('bpmn:CatchEvent'));
    if (!needsId || def.id) {
      return;
    }
    const id = el.id;
    reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_DEFINITION', element: el, subject: 'definitionId', message: `The ${this.triggerName(def)} event definition of ${this.describe(el)} has no id; Camunda 8.9 refuses the file (an internal error: "Cannot invoke String.getBytes ... value is null")`, hint: `\`bpmn set <file> ${id} definition.id=${IdWords.localName(def.type)}_${id.replace(/^[A-Za-z]+_/, '')}\` (Camunda Modeler gives every event definition an id).` });
  }
}
