import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, type ModdleElement, type ReportPath } from '../CamundaRules.js';

import { EngineScope } from '../EngineScope.js';
import { ModdlePath } from '../ModdlePath.js';
import { Values } from '../Values.js';
import { C8EventDefinitions } from './C8EventDefinitions.js';
import { FlowIndex } from './FlowIndex.js';
import { type Duplicate, SubscriptionGroups } from './SubscriptionGroups.js';

type Trigger = 'message' | 'signal';

/** The start events Camunda 8 needs a static name on, and what the duplicate hint adds. */
const NAMED: Record<Trigger, { starts: string; note: string }> = {
  message: { starts: 'process start events', note: ' (and a zeebe:subscription on it)' },
  signal: { starts: 'start events', note: '' },
};

/**
 * Reports what executable events subscribe to and Camunda 8 refuses to deploy: a start event whose
 * message (process starts) or signal name is a FEEL expression, an error catch event whose code is
 * one or that does not interrupt, and one message name, signal name or error code (or two
 * catch-alls) twice among the events of a (sub-)process it subscribes to together. A send task or
 * message throw event whose message has no name (camunda-compat checks catching elements only).
 */
class C8Subscriptions extends C8Rule {
  private readonly flows = new FlowIndex();

  protected visit(node: ModdleElement): void {
    if (!EngineScope.C8.contains(node)) return;
    const groups = is(node, 'bpmn:Process') || is(node, 'bpmn:SubProcess') ? new SubscriptionGroups(node, this.flows) : undefined;
    if (is(node, 'bpmn:StartEvent') && is(node.$parent, 'bpmn:Process')) this.checkStartName(node, 'message');
    if (groups) this.checkMessageScope(groups, node);
    if (is(node, 'bpmn:StartEvent')) this.checkStartName(node, 'signal');
    if (groups) this.checkSignalScope(groups, node);
    if (is(node, 'bpmn:CatchEvent')) this.checkErrorCatch(node);
    if (groups) this.checkErrorScope(groups, node);
    this.checkThrownMessage(node);
  }

  /** A start event that waits for a FEEL name. */
  private checkStartName(start: ModdleElement, trigger: Trigger): void {
    const kind = `${trigger.charAt(0).toUpperCase()}${trigger.slice(1)}`;
    const reference = C8EventDefinitions.definitionOfType(start, `bpmn:${kind}EventDefinition`)?.get(`${trigger}Ref`);
    const name = reference?.get('name');
    if (Values.isFeel(name)) this.report(`c8-${trigger}`, start, `Start event ${start.id} catches the ${trigger} "${name}", a FEEL expression; Camunda 8 needs a static ${trigger} name on ${NAMED[trigger].starts} and refuses the file`, { path: ['eventDefinitions', 0, `${trigger}Ref`, 'name'], type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED, node: reference, property: 'name', hint: `\`bpmn set <file> ${reference.id} name=<${kind}Name>\`.` });
  }

  private checkMessageScope(groups: SubscriptionGroups, scope: ModdleElement): void {
    for (const { activity, boundaries } of groups.boundaryGroups()) this.reportNamed('message', is(activity, 'bpmn:ReceiveTask') ? [activity, ...boundaries] : boundaries, `on ${activity.id}`);
    for (const { gateway, targets } of groups.gatewayTargets()) this.reportNamed('message', targets, `after event-based gateway ${gateway.id}`);
    this.reportNamed('message', groups.eventSubProcessStarts(), `in the event sub-processes of ${scope.id}`);
    this.reportNamed('message', groups.processStarts(), `in process ${scope.id}`);
  }

  private checkSignalScope(groups: SubscriptionGroups, scope: ModdleElement): void {
    for (const { activity, boundaries } of groups.boundaryGroups()) this.reportNamed('signal', boundaries, `on ${activity.id}`);
    this.reportNamed('signal', groups.processStarts(), `in process ${scope.id}`);
  }

  /** One static name twice among `events`; a receive task waits for its own message. */
  private reportNamed(trigger: Trigger, events: ModdleElement[], where: string): void {
    const holderOf = (el: ModdleElement) => (trigger === 'message' && is(el, 'bpmn:ReceiveTask') ? el : C8EventDefinitions.onlyDefinition(el, `bpmn:${trigger === 'message' ? 'Message' : 'Signal'}EventDefinition`));
    const keyOf = (el: ModdleElement) => {
      const name = holderOf(el)?.get(`${trigger}Ref`)?.get('name');
      return Values.isBlank(name) || Values.isFeel(name) ? undefined : name;
    };
    for (const duplicate of SubscriptionGroups.duplicates(events, keyOf)) {
      const { first, el, key } = duplicate;
      const path = is(el, 'bpmn:ReceiveTask') ? ['messageRef'] : ['eventDefinitions', 0, `${trigger}Ref`];
      this.reportDuplicate(`c8-${trigger}`, duplicate, `${describeElement(el)} waits for the ${trigger} "${key}" like ${describeElement(first)} ${where}; Camunda 8 refuses one ${trigger} name twice there`, path, 'name', `Use another ${trigger}: \`bpmn set <file> ${el.id} ${trigger}=<Other${trigger.charAt(0).toUpperCase()}${trigger.slice(1)}>\`${NAMED[trigger].note}.`);
    }
  }

  /** An error catch event with a FEEL code, or one that does not interrupt. */
  private checkErrorCatch(event: ModdleElement): void {
    const definition = C8EventDefinitions.definitionOfType(event, 'bpmn:ErrorEventDefinition');
    if (!definition) return;
    const error = definition.get('errorRef');
    const code = error?.get('errorCode');
    if (Values.isFeel(code)) this.report('c8-error', event, `${describeElement(event)} catches the error code "${code}", an expression; Camunda 8 needs a static code on catching error events and refuses the file`, { path: ['eventDefinitions', 0, 'errorRef', 'errorCode'], type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED, node: error, property: 'errorCode', hint: `\`bpmn set <file> ${event.id} errorCode=<CODE>\` (or no code: it catches every error).` });
    const interrupting = is(event, 'bpmn:BoundaryEvent') ? 'cancelActivity' : 'isInterrupting';
    if (is(event, 'bpmn:IntermediateCatchEvent') || event.get(interrupting) !== false) return;
    this.report('c8-error', event, `${describeElement(event)} is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)`, { path: [interrupting], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: interrupting, hint: `\`bpmn set <file> ${event.id} nonInterrupting=false\`.` });
  }

  private checkErrorScope(groups: SubscriptionGroups, scope: ModdleElement): void {
    for (const { activity, boundaries } of groups.boundaryGroups()) this.reportErrorCodes(boundaries, `the boundary events of ${activity.id}`);
    this.reportErrorCodes(groups.eventSubProcessStarts(), `the event sub-processes of ${scope.id}`);
  }

  /** One error code twice; no code (`''`) catches every error. */
  private reportErrorCodes(events: ModdleElement[], where: string): void {
    const keyOf = (el: ModdleElement) => {
      const definition = C8EventDefinitions.onlyDefinition(el, 'bpmn:ErrorEventDefinition');
      const code = definition?.get('errorRef')?.get('errorCode');
      if (!definition) return undefined;
      return Values.isBlank(code) ? '' : code;
    };
    for (const duplicate of SubscriptionGroups.duplicates(events, keyOf)) {
      const { first, el, key } = duplicate;
      const message = key ? `${describeElement(el)} catches the error code "${key}" like ${describeElement(first)} (${where}); Camunda 8 refuses one code twice in a scope` : `${describeElement(el)} and ${describeElement(first)} both catch every error (no error code) (${where}); Camunda 8 allows one catch-all per scope`;
      this.reportDuplicate('c8-error', duplicate, message, ['eventDefinitions', 0, 'errorRef'], 'errorCode', `Catch another error: \`bpmn set <file> ${el.id} error=<OtherError> errorCode=<OTHER_CODE>\` (the events share no bpmn:Error then), or remove one of them.`);
    }
  }

  private reportDuplicate(finding: string, { first, el, key }: Duplicate, message: string, path: ReportPath, property: string, hint: string): void {
    this.report(finding, el, message, { path, type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, duplicatedProperty: property, duplicatedPropertyValue: key, duplicateOf: first, hint });
  }

  /** A send task or message throw event whose message has no name. */
  private checkThrownMessage(node: ModdleElement): void {
    if (!isAny(node, ['bpmn:SendTask', 'bpmn:ThrowEvent'])) return;
    const holder = is(node, 'bpmn:SendTask') ? node : C8EventDefinitions.definitionOfType(node, 'bpmn:MessageEventDefinition');
    const message = holder?.messageRef;
    if (!message || Values.hasName(message)) return;
    this.report('c8-implementation', node, `Message ${message.id} of ${describeElement(node)} has no name; Camunda 8 refuses the file`, { path: [...ModdlePath.between(node, holder), 'messageRef', 'name'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: message, requiredProperty: 'name', hint: `\`bpmn set <file> ${message.id} name=<MessageName>\`.` });
  }
}

export default defineRule(
  {
    ruleName: 'c8-subscriptions',
    kind: 'engine-specific',
    targetEngine: 'c8',
    findings: {
      'c8-message': ['W_C8_DEPLOY_MESSAGE', 'deploy'],
      'c8-signal': ['W_C8_DEPLOY_SIGNAL', 'deploy'],
      'c8-error': ['W_C8_DEPLOY_ERROR', 'deploy'],
      'c8-implementation': ['W_C8_DEPLOY_IMPLEMENTATION', 'deploy'],
    },
  },
  C8Subscriptions,
);
