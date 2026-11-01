import type { BpmnDocument } from '../document/BpmnDocument.js';
import type { BpmnElement } from '../document/BpmnElement.js';
import { EventTrigger } from '../kinds/EventTrigger.js';

export type PropertyReader = (element: BpmnElement, document: BpmnDocument) => Record<string, unknown>;

export interface PropertyDefinition {
  key: string;
  appliesTo: string;
  description: string;
  read?: PropertyReader;
}

export class PropertyKeys {
  private static readIf(key: string, value: unknown): Record<string, unknown> {
    return value ? { [key]: value } : {};
  }

  private static readReference(key: string, reference: BpmnElement | undefined): Record<string, unknown> {
    return reference ? { [key]: reference.id } : {};
  }

  private static multiInstanceOf(element: BpmnElement): BpmnElement | undefined {
    const loop = element.get<BpmnElement | undefined>('loopCharacteristics');
    return loop?.is('bpmn:MultiInstanceLoopCharacteristics') ? loop : undefined;
  }

  private static expressionBody(owner: BpmnElement | undefined, property: string): string | undefined {
    return owner?.get<BpmnElement | undefined>(property)?.get<string | undefined>('body');
  }

  private static readDocumentation(element: BpmnElement): Record<string, unknown> {
    const text = element
      .list('documentation')
      .map((documentation) => documentation.get<string | undefined>('text'))
      .filter(Boolean)
      .join('\n');
    return PropertyKeys.readIf('doc', text);
  }

  private static readTrigger(event: BpmnElement): Record<string, unknown> {
    const { trigger, opts } = new EventTrigger(event).read();
    const { timerKind: _timerKind, ...triggerKeys } = opts;
    return { trigger, ...triggerKeys };
  }

  private static readLoop(activity: BpmnElement): Record<string, unknown> {
    const multiInstance = PropertyKeys.multiInstanceOf(activity);
    if (multiInstance) {
      return { loop: multiInstance.get<boolean | undefined>('isSequential') ? 'sequential' : 'parallel' };
    }
    return activity.get<BpmnElement | undefined>('loopCharacteristics')?.is('bpmn:StandardLoopCharacteristics') ? { loop: 'standard' } : {};
  }

  private static readCompletion(activity: BpmnElement): Record<string, unknown> {
    const multiInstance = PropertyKeys.multiInstanceOf(activity);
    if (multiInstance) {
      return PropertyKeys.readIf('completion', PropertyKeys.expressionBody(multiInstance, 'completionCondition'));
    }
    return activity.is('bpmn:AdHocSubProcess') ? PropertyKeys.readIf('completion', PropertyKeys.expressionBody(activity, 'completionCondition')) : {};
  }

  private static readTaskMessage(task: BpmnElement): Record<string, unknown> {
    const message = task.peek<BpmnElement>('messageRef');
    return message ? { message: message.get<string | undefined>('name') ?? message.id } : {};
  }

  private static readLane(node: BpmnElement, document: BpmnDocument): Record<string, unknown> {
    const innermostLane = document.scopes.lanesOf(node).at(-1);
    return innermostLane ? { lane: innermostLane.id } : {};
  }

  static readonly ALL: readonly PropertyDefinition[] = [
    { key: 'id', appliesTo: 'any', description: 'Rename the element; every reference (flows, lanes, boundary hosts, calledElement) follows, and so does a DI id derived from the old id (BPMNShape_<id>, <id>_di)', read: (element) => ({ id: element.id }) },
    { key: 'name', appliesTo: 'any', description: 'Display name (empty value removes it; a group\'s name is the value of its category value)', read: (element) => PropertyKeys.readIf('name', element.name) },
    { key: 'doc', appliesTo: 'any', description: 'Documentation text (alias: documentation; empty removes it)', read: PropertyKeys.readDocumentation },
    { key: '<prefix>:<attr>', appliesTo: 'any', description: 'Vendor attribute, e.g. camunda:assignee=alice or zeebe:modelerTemplate=x (xmlns declared automatically for known prefixes)' },
    { key: '<property>', appliesTo: 'any', description: 'Any attribute of the BPMN type by property name, e.g. isExecutable, calledElement, scriptFormat, script, implementation, isForCompensation, completionQuantity, gatewayDirection, instantiate' },
    { key: 'condition', appliesTo: 'sequenceFlow', description: 'Condition expression (empty removes it; clears the default marker of the flow)', read: (flow) => PropertyKeys.readIf('condition', PropertyKeys.expressionBody(flow, 'conditionExpression')) },
    { key: 'language', appliesTo: 'sequenceFlow', description: 'Expression language of the condition', read: (flow) => PropertyKeys.readIf('language', flow.get<BpmnElement | undefined>('conditionExpression')?.get<string | undefined>('language')) },
    { key: 'default', appliesTo: 'sequenceFlow', description: 'true|false: make this flow the default flow of its source gateway/activity (removes its condition; a previous default flow loses the marker)', read: (flow) => PropertyKeys.readIf('default', flow.get<BpmnElement | undefined>('sourceRef')?.get<BpmnElement | undefined>('default') === flow) },
    { key: 'default', appliesTo: 'flowNode', description: 'Id of the default outgoing flow of a gateway/activity (empty clears it)', read: (node) => PropertyKeys.readReference('default', node.peek<BpmnElement>('default')) },
    { key: 'source', appliesTo: 'sequenceFlow', description: 'Redirect the flow: new source node id', read: (flow) => PropertyKeys.readReference('source', flow.get<BpmnElement | undefined>('sourceRef')) },
    { key: 'target', appliesTo: 'sequenceFlow', description: 'Redirect the flow: new target node id', read: (flow) => PropertyKeys.readReference('target', flow.get<BpmnElement | undefined>('targetRef')) },
    { key: 'trigger', appliesTo: 'event', description: 'Event trigger: none|message|timer|error|signal|escalation|conditional|link|compensate|terminate|cancel', read: PropertyKeys.readTrigger },
    { key: 'timer', appliesTo: 'event', description: 'ISO 8601 timer: R/PT1H (cycle), PT5M (duration) or a date; implies trigger=timer' },
    { key: 'message', appliesTo: 'event', description: 'Message name (a root bpmn:Message is created when missing); implies trigger=message' },
    { key: 'error', appliesTo: 'event', description: 'Error name (root bpmn:Error created when missing); implies trigger=error' },
    { key: 'errorCode', appliesTo: 'event', description: 'errorCode of the referenced bpmn:Error' },
    { key: 'signal', appliesTo: 'event', description: 'Signal name; implies trigger=signal' },
    { key: 'escalation', appliesTo: 'event', description: 'Escalation name; implies trigger=escalation' },
    { key: 'escalationCode', appliesTo: 'event', description: 'escalationCode of the referenced bpmn:Escalation' },
    { key: 'when', appliesTo: 'event', description: 'Condition expression of a conditional event; implies trigger=conditional' },
    { key: 'link', appliesTo: 'event', description: 'Link name of a link event; implies trigger=link' },
    { key: 'nonInterrupting', appliesTo: 'event', description: 'true|false: boundary events (cancelActivity) and event sub-process start events (isInterrupting); never for error/cancel/compensate triggers or untyped start events' },
    { key: 'loop', appliesTo: 'activity', description: 'none|standard|parallel|sequential (parallel/sequential = multi-instance)', read: PropertyKeys.readLoop },
    { key: 'cardinality', appliesTo: 'activity', description: 'Multi-instance loop cardinality expression (creates a parallel multi-instance loop when none exists)', read: (activity) => PropertyKeys.readIf('cardinality', PropertyKeys.expressionBody(PropertyKeys.multiInstanceOf(activity), 'loopCardinality')) },
    { key: 'completion', appliesTo: 'activity', description: 'Multi-instance completion condition expression (an ad-hoc sub-process without a multi-instance loop: its own completion condition)', read: PropertyKeys.readCompletion },
    { key: 'expanded', appliesTo: 'subProcess', description: 'true|false: draw the sub-process expanded (default) or collapsed', read: (subProcess, document) => ({ expanded: document.diagram.expansionState().get(subProcess.id) ?? true }) },
    { key: 'triggeredByEvent', appliesTo: 'subProcess', description: 'true|false: event sub-process' },
    { key: 'message', appliesTo: 'sendTask, receiveTask', description: 'Message name of a send / receive task (a root bpmn:Message is created when missing; empty removes the reference)', read: PropertyKeys.readTaskMessage },
    { key: 'calledDecision', appliesTo: 'businessRuleTask', description: 'The decision the task calls, in the spelling of the file\'s platform: camunda:decisionRef in Camunda 7, a zeebe:calledDecision decisionId in Camunda 8, bpmn-cli\'s own unprefixed calledDecision="<id>" without an engine. With the library\'s platform \'none\' a link in an engine spelling keeps it (a zeebe:calledDecision its resultVariable too) and a new link takes the engine spelling all the file\'s other links share (the other spellings are removed; empty removes the link)' },
    { key: 'definition.<key>', appliesTo: 'event', description: "Attribute of the event definition, e.g. definition.camunda:errorCodeVariable=code, definition.camunda:type=external + definition.camunda:topic=x (message throw / end), definition.camunda:variableName=amount (conditional); an event with several event definitions takes 'definition[<n>].<key>' (0-based) or 'definition[<trigger>].<key>'" },
    { key: 'loop.<key>', appliesTo: 'activity', description: 'Attribute of the loop characteristics, e.g. loop.camunda:collection=${items}, loop.camunda:elementVariable=item, loop.camunda:asyncBefore=true (creates a parallel multi-instance loop when none exists)' },
    { key: 'condition.<key>', appliesTo: 'sequenceFlow', description: 'Attribute of the condition expression, e.g. condition.camunda:resource=deployment://check.groovy (a script resource condition; set language= too)' },
    { key: 'condition.<key>', appliesTo: 'conditionalEvent', description: 'Attribute of the condition expression of a conditional event, e.g. condition.camunda:resource=deployment://ready.groovy condition.language=groovy; the event definition itself is definition.<key> (definition.camunda:variableName=amount)' },
    { key: 'lane', appliesTo: 'flowNode', description: 'Lane id the node belongs to (empty removes lane membership)', read: PropertyKeys.readLane },
    { key: 'text', appliesTo: 'textAnnotation', description: 'Annotation text' },
  ];
}
