import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, type ModdleElement, type ReportData, type ReportPath } from '../CamundaRules.js';

import { EngineScope } from '../EngineScope.js';
import { FirstOfKey } from '../FirstOfKey.js';
import { ModdlePath } from '../ModdlePath.js';
import { sh } from '../shell.js';
import { Values } from '../Values.js';
import { C8EventDefinitions } from './C8EventDefinitions.js';
import { C8Host, type ZeebeValue } from './C8Host.js';
import { FeelExpression } from './feel/FeelExpression.js';
import { ZeebeHint } from './ZeebeHint.js';

const JOB_TASKS = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:ScriptTask', 'bpmn:BusinessRuleTask'];
const BINDING_TYPES = ['deployment', 'latest', 'versionTag'];
/** The extension element camunda-compat's `version-tag` checks on each host: the first of its type. */
const VERSION_TAG_CHECKED_BY_COMPAT: Record<string, string> = { 'zeebe:calledDecision': 'bpmn:BusinessRuleTask', 'zeebe:calledElement': 'bpmn:CallActivity', 'zeebe:formDefinition': 'bpmn:UserTask' };
const TASK_LISTENER_EVENT_CHOICE = '<creating|assigning|updating|completing|canceling>';
const TASK_LISTENER_EVENTS = ['creating', 'assigning', 'updating', 'completing', 'canceling', 'create', 'assignment', 'update', 'complete', 'cancel'];

/**
 * Reports zeebe extension content Camunda 8 refuses or cannot use. It refuses: two of an element it
 * reads once per element, listeners without or with an unknown event type or where it does not
 * run them (a start listener on a start or boundary event, an end listener on a gateway, execution
 * listeners on a sequence flow, task listeners on a job worker user task), an unknown binding type,
 * a linked resource without resource type or version tag, conditional filter variable events other
 * than create and update, a version tag binding without version tag and a task header key twice
 * where camunda-compat does not look. It deploys but cannot use: job retries that are no number (an
 * incident on every instance), task headers without key or value (dropped from the job) and a
 * multi-instance completion condition that is no FEEL expression (an incident on every completed
 * instance). A listener without type is left to camunda-compat.
 */
class C8Extensions extends C8Rule {
  protected visit(node: ModdleElement): void {
    this.checkCompletionCondition(node);
    if (this.isJobHost(node) && EngineScope.C8.runs(node)) this.checkRetries(node);
    for (const value of node.extensionElements?.values ?? []) if (isAny(value, ['zeebe:TaskHeaders', 'zeebe:ExecutionListeners']) && C8Host.readHostOf(value)) this.checkHeaderValues(value, node);
    const host = C8Host.of(node);
    if (!host) return;
    const values = host.zeebeValues();
    for (const value of values) this.checkListeners(host, value, values);
    const read = values.filter(({ placement }) => placement === 'read');
    for (const value of read) this.checkExtension(host, value, read);
    this.checkDuplicates(host, read);
  }

  /** It deploys, then reads the condition as a string and raises an incident on every completed instance. */
  private checkCompletionCondition(node: ModdleElement): void {
    const loop = is(node, 'bpmn:Activity') && !is(node, 'bpmn:Transaction') ? node.loopCharacteristics : undefined;
    const condition = loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics') ? loop.completionCondition : undefined;
    if (!condition || Values.isFeel(condition.body) || !EngineScope.C8.runs(node)) return;
    this.report('c8-feel-completion-condition', node, `The completion condition "${condition.body ?? ''}" of multi-instance ${describeElement(node)} is no FEEL expression (=...); it deploys, but every completed instance gets an incident (expected a boolean, got a string)`, { path: ['loopCharacteristics', 'completionCondition'], type: ERROR_TYPES.EXPRESSION_REQUIRED, node: loop, property: 'completionCondition', hint: `\`bpmn set <file> ${node.id} ${sh(`completion==${FeelExpression.fromJuel(condition.body ?? '')}`)}\` (check the FEEL syntax).` });
  }

  private isJobHost(node: ModdleElement): boolean {
    return isAny(node, JOB_TASKS) || (is(node, 'bpmn:ThrowEvent') && !!C8EventDefinitions.definitionOfType(node, 'bpmn:MessageEventDefinition'));
  }

  private checkRetries(node: ModdleElement): void {
    const [taskDefinition] = C8Host.valuesOf(node, 'zeebe:TaskDefinition');
    const retries = taskDefinition?.retries;
    if (retries === undefined || Values.isFeel(retries) || /^\s*-?\d+\s*$/.test(retries)) return;
    this.report('c8-bad-value', node, `The ${ZeebeHint.prefixOf(node)}:taskDefinition of ${describeElement(node)} has retries="${retries}", which is no number; it deploys, but every instance gets an incident when it reaches ${node.id}`, { path: [...ModdlePath.between(node, taskDefinition), 'retries'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: taskDefinition, property: 'retries', hint: ZeebeHint.of(node)?.replace(taskDefinition, { retries: '3' }) ?? 'edit the XML.' });
  }

  /** Task headers without key or value, of the host or of its execution listeners (not on a sequence flow). */
  private checkHeaderValues(value: ModdleElement, host: ModdleElement): void {
    if (is(value, 'zeebe:TaskHeaders')) this.checkHeaderValuesOf(value, host, '');
    else if (!is(host, 'bpmn:SequenceFlow')) (value.listeners ?? []).forEach((listener: ModdleElement, index: number) => listener.headers && this.checkHeaderValuesOf(listener.headers, host, `execution listener ${index + 1} of `));
  }

  private checkHeaderValuesOf(headers: ModdleElement, host: ModdleElement, inListener: string): void {
    const owner = ModdlePath.ownerOf(host);
    const where = `${inListener}${host.id ? describeElement(host) : describeElement(host, owner)}`;
    const hint = host.id && !inListener ? ZeebeHint.of(host) : undefined;
    (headers.values ?? []).forEach((header: ModdleElement, index: number) => {
      const missing = (['key', 'value'] as const).find((property) => Values.isBlank(header[property]));
      if (missing) this.report('c8-bad-value', owner, `Task header ${header.key ? `"${header.key}"` : index + 1} of ${where} has no ${missing}; Camunda 8 drops it, the job does not carry it`, { path: [...ModdlePath.between(owner, header), missing], type: ERROR_TYPES.PROPERTY_REQUIRED, node: header, requiredProperty: missing, hint: hint ? this.headerValueHint(hint, header, index, missing) : 'Fix it in the XML.' });
    });
  }

  /** Re-add a header without key (after removing it) or without value: `bpmn ext add` replaces the header of its key. */
  private headerValueHint(hint: ZeebeHint, header: ModdleElement, index: number, missing: 'key' | 'value'): string {
    const add = hint.extAdd(`${hint.name('header')} key=${header.key ?? '<key>'} value=<value>`);
    if (missing === 'value') return `Give it a value: ${add}.`;
    return `Remove it (\`bpmn ext remove <file> ${hint.target} ${sh(`${hint.name('taskHeaders')}/${hint.name('header')}[${index}]`)}\`) and add it with a key: ${add}.`;
  }

  private reportOn(host: C8Host, finding: string, message: string, data: ReportData): void {
    this.report(finding, host.target, message, data);
  }

  private checkListeners(host: C8Host, { value, index, type, placement }: ZeebeValue, values: ZeebeValue[]): void {
    const hint = host.hint();
    if (placement === 'flowListeners') this.reportOn(host, 'c8-listener', `${host.describe()} has execution listeners; Camunda 8 supports them on processes, activities, events and gateways, not on sequence flows, and refuses the file`, { path: host.extensionPath(index), type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, node: host.node, extensionElement: value, hint: `Remove them (${hint ? hint.extRemove(index) : 'remove it from the XML'}) and put them on the flow's source or target.` });
    if (placement !== 'read') return;
    if (type.name === 'zeebe:executionListeners') this.checkExecutionListeners(host, value, index);
    if (type.name !== 'zeebe:taskListeners') return;
    if (!values.some((zeebeValue) => zeebeValue.type.name === 'zeebe:userTask')) this.reportOn(host, 'c8-listener', `${host.describe()} has task listeners but is a job worker user task (no ${host.spell('zeebe:userTask')}); Camunda 8 allows task listeners on Camunda user tasks only and refuses the file`, { path: host.path('extensionElements'), type: ERROR_TYPES.EXTENSION_ELEMENT_REQUIRED, node: host.node, requiredExtensionElement: 'zeebe:UserTask', hint: hint ? `Make it a Camunda user task: ${hint.extAdd(hint.name('userTask'))} (or remove the listeners: \`bpmn ext remove <file> ${hint.target} ${hint.name('taskListeners')}\`).` : 'Make it a Camunda user task in the XML (or remove the listeners).' });
    (value.listeners ?? []).forEach((listener: ModdleElement, listenerIndex: number) => {
      const eventType: string | undefined = listener.eventType;
      const rebuild = this.rebuildListenerHint(host, 'taskListener', listenerIndex, 'Rebuild it', `eventType=${TASK_LISTENER_EVENT_CHOICE} type=${listener.type ?? '<jobType>'}`);
      const label = `Task listener ${listenerIndex + 1}${eventType?.trim() ? ` (${eventType})` : ''} of ${host.describe()}`;
      if (!eventType?.trim()) this.reportEventType(host, listener, index, listenerIndex, `${label} has no eventType; Camunda 8 refuses the file`, rebuild, true);
      else if (!TASK_LISTENER_EVENTS.includes(eventType)) this.reportEventType(host, listener, index, listenerIndex, `${label}: eventType "${eventType}" is not one of creating, assigning, updating, completing, canceling; Camunda 8 refuses the file`, rebuild);
    });
  }

  private checkExecutionListeners(host: C8Host, value: ModdleElement, index: number): void {
    const allowedEvents = this.runsAtLeast(host.node, '8.10') ? ['start', 'end', 'beforeAll', 'cancel'] : ['start', 'end'];
    (value.listeners ?? []).forEach((listener: ModdleElement, listenerIndex: number) => {
      const eventType: string | undefined = listener.eventType;
      const label = `Execution listener ${listenerIndex + 1}${eventType?.trim() ? ` (${eventType})` : ''} of ${host.describe()}`;
      const rebuild = (lead: string, eventTypeFix: string) => this.rebuildListenerHint(host, 'executionListener', listenerIndex, lead, `eventType=${eventTypeFix} type=${listener.type ?? '<jobType>'}`);
      const unsupported = (where: string, lead: string, fix: string) => this.reportEventType(host, listener, index, listenerIndex, `${label}: Camunda 8 does not support ${eventType} listeners on ${where} and refuses the file`, rebuild(lead, fix));
      if (!eventType?.trim()) this.reportEventType(host, listener, index, listenerIndex, `${label} has no eventType; Camunda 8 refuses the file`, rebuild('Rebuild it', '<start|end>'), true);
      else if (!allowedEvents.includes(eventType)) this.reportEventType(host, listener, index, listenerIndex, `${label}: eventType "${eventType}" is not ${allowedEvents.length === 2 ? 'start or end' : `one of ${allowedEvents.join(', ')}`}; Camunda 8 refuses the file`, rebuild('Rebuild it', '<start|end>'));
      else if (eventType === 'start' && is(host.node, 'bpmn:StartEvent')) unsupported('start events', 'Make it an end listener or remove it', 'end');
      else if (eventType === 'start' && is(host.node, 'bpmn:BoundaryEvent')) unsupported('boundary events', 'Make it an end listener or remove it', 'end');
      else if (eventType === 'end' && is(host.node, 'bpmn:Gateway')) unsupported('gateways', 'Make it a start listener or remove it', 'start');
    });
  }

  private reportEventType(host: C8Host, listener: ModdleElement, index: number, listenerIndex: number, message: string, hint: string, missing = false): void {
    const path = host.extensionPath(index, 'listeners', listenerIndex, 'eventType');
    this.reportOn(host, 'c8-listener', message, missing ? { path, type: ERROR_TYPES.PROPERTY_REQUIRED, node: listener, requiredProperty: 'eventType', hint } : { path, type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: listener, property: 'eventType', hint });
  }

  /** `<lead>: <remove the listener>, then <add it again with fix>`: the listener is rebuilt in its list (`zeebe:taskListeners/zeebe:taskListener[0]`). */
  private rebuildListenerHint(host: C8Host, listenerLocal: 'executionListener' | 'taskListener', listenerIndex: number, lead: string, fix: string): string {
    const hint = host.hint();
    if (!hint) return `${lead}: remove it from the XML, then edit the XML.`;
    const listener = `${hint.name(`${listenerLocal}s`)}/${hint.name(listenerLocal)}`;
    return `${lead}: ${hint.extRemove(`${listener}[${listenerIndex}]`)}, then ${hint.extAdd(`${listener} ${fix}`)}.`;
  }

  private checkExtension(host: C8Host, zeebeValue: ZeebeValue, read: ZeebeValue[]): void {
    const { value, index, type } = zeebeValue;
    const first = read.find((other) => other.type.name === type.name) === zeebeValue;
    if (type.name in VERSION_TAG_CHECKED_BY_COMPAT) this.checkBinding(host, zeebeValue);
    else if (type.name === 'zeebe:linkedResources') this.checkLinkedResources(host, value, index);
    else if (type.name === 'zeebe:conditionalFilter') this.checkConditionalFilter(host, value, index);
    else if (type.name === 'zeebe:taskHeaders' && !first) this.checkHeaderKeys(host, value, host.extensionPath(index), '');
    else if (type.name === 'zeebe:executionListeners' && !first) (value.listeners ?? []).forEach((listener: ModdleElement, listenerIndex: number) => listener.headers && this.checkHeaderKeys(host, listener.headers, host.extensionPath(index, 'listeners', listenerIndex, 'headers'), `execution listener ${listenerIndex + 1}`));
  }

  private checkBinding(host: C8Host, { value, index, type }: ZeebeValue): void {
    const bindingType: string | undefined = value.bindingType;
    if (bindingType === undefined) return;
    const subject = `${host.spell(type.name)} of ${host.describe()}`;
    const replaced = (fix: Record<string, string>) => host.hint()?.replace(value, fix) ?? 'Fix it in the XML.';
    if (!BINDING_TYPES.includes(bindingType)) this.reportBindingType(host, value, subject, host.extensionPath(index, 'bindingType'), replaced({ bindingType: 'latest' }));
    else if (this.lacksVersionTag(value) && !this.isCheckedByCompat(host, value, type.name)) this.reportVersionTag(host, value, subject, host.extensionPath(index, 'versionTag'), replaced({ versionTag: '<versionTag>' }));
  }

  private checkLinkedResources(host: C8Host, value: ModdleElement, index: number): void {
    const rebuild = this.rebuildHint(host, value);
    (value.values ?? []).forEach((resource: ModdleElement, resourceIndex: number) => {
      const subject = `Linked resource ${resource.linkName ?? resourceIndex + 1} of ${host.describe()}`;
      const path = (property: string) => host.extensionPath(index, 'values', resourceIndex, property);
      if (resource.resourceType === undefined || resource.resourceType === '') this.reportOn(host, 'c8-extension', `${subject} has no resourceType; Camunda 8 refuses the file`, { path: path('resourceType'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: resource, requiredProperty: 'resourceType', hint: rebuild });
      const bindingType: string | undefined = resource.bindingType;
      if (bindingType !== undefined && !BINDING_TYPES.includes(bindingType)) this.reportBindingType(host, resource, subject, path('bindingType'), rebuild);
      else if (bindingType === 'versionTag' && this.lacksVersionTag(resource)) this.reportVersionTag(host, resource, subject, path('versionTag'), rebuild);
    });
  }

  private checkConditionalFilter(host: C8Host, value: ModdleElement, index: number): void {
    const unknown = (value.variableEvents as string | undefined)?.split(',').map((eventName) => eventName.trim()).filter((eventName) => eventName && eventName !== 'create' && eventName !== 'update') ?? [];
    if (unknown.length) this.reportOn(host, 'c8-extension', `${host.spell('zeebe:conditionalFilter')} of ${host.describe()} lists the variable events ${unknown.join(', ')}; Camunda 8 knows create and update only and refuses the file`, { path: host.extensionPath(index, 'variableEvents'), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: value, property: 'variableEvents', hint: `${this.rebuildHint(host, value)} (variableEvents=create,update)` });
  }

  /** A header key twice in a header list camunda-compat skips (a second zeebe:taskHeaders, the headers of a second listener list). */
  private checkHeaderKeys(host: C8Host, headers: ModdleElement, headersPath: ReportPath, listenerLabel: string): void {
    const where = `${listenerLabel ? `${listenerLabel} of ` : ''}${host.describe()}`;
    const hint = host.hint();
    const firsts = new FirstOfKey<ModdleElement>();
    (headers.values ?? []).forEach((header: ModdleElement, headerIndex: number) => {
      const key: string | undefined = header.key;
      if (key?.trim() && firsts.repeats(key, header)) this.reportOn(host, 'c8-extension', `${where} has the task header "${key}" twice; Camunda 8 refuses the file`, { path: [...headersPath, 'values', headerIndex, 'key'], type: ERROR_TYPES.PROPERTY_VALUE_DUPLICATED, node: headers, duplicatedProperty: 'key', duplicatedPropertyValue: key, propertiesName: 'values', hint: hint && host.node.id && !listenerLabel ? `Keep one: \`bpmn ext remove <file> ${host.node.id} ${sh(`${hint.name('taskHeaders')}/${hint.name('header')}[${headerIndex}]`)}\`.` : 'Remove one in the XML.' });
    });
  }

  private reportBindingType(host: C8Host, element: ModdleElement, subject: string, path: ReportPath, hint: string): void {
    this.reportOn(host, 'c8-extension', `${subject} has bindingType="${element.bindingType}"; Camunda 8 accepts ${BINDING_TYPES.join(', ')} only and refuses the file`, { path, type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: element, property: 'bindingType', hint });
  }

  private reportVersionTag(host: C8Host, element: ModdleElement, subject: string, path: ReportPath, hint: string): void {
    this.reportOn(host, 'c8-extension', `${subject} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, { path, type: ERROR_TYPES.PROPERTY_REQUIRED, node: element, requiredProperty: 'versionTag', hint });
  }

  /** How to rebuild a zeebe element with child elements (`zeebe:linkedResources`). */
  private rebuildHint(host: C8Host, element: ModdleElement): string {
    const hint = host.hint();
    return hint ? hint.rebuild(hint.nameOf(element)) : 'Fix it in the XML.';
  }

  private lacksVersionTag(element: ModdleElement): boolean {
    return element.bindingType === 'versionTag' && !element.versionTag?.trim();
  }

  /** camunda-compat reports an empty version tag of the first such element on its host. */
  private isCheckedByCompat(host: C8Host, value: ModdleElement, name: string): boolean {
    const versionTag: string | undefined = value.versionTag;
    return host.zeebeValues().find((zeebeValue) => zeebeValue.type.name === name)?.value === value && is(host.node, VERSION_TAG_CHECKED_BY_COMPAT[name] ?? '') && (versionTag === undefined || versionTag === '');
  }

  /** Two or more of an element Camunda 8 reads once per element: reported on the second. */
  private checkDuplicates(host: C8Host, read: ZeebeValue[]): void {
    const byName = new Map<string, ZeebeValue[]>();
    for (const value of read) if (C8Host.zeebe.isSingle(value.type.name)) byName.set(value.type.name, [...(byName.get(value.type.name) ?? []), value]);
    const hint = host.hint();
    for (const [name, values] of byName) {
      const [, second] = values;
      if (second) this.reportOn(host, 'c8-duplicate-extension', `${host.describe()} has ${values.length} ${host.spell(name)} elements; Camunda 8 reads one and refuses the file`, { path: host.extensionPath(second.index), type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, node: host.node, extensionElement: second.value, hint: hint ? `Merge them into one: ${hint.rebuild(hint.nameOf(second.value)).replace(/^See it/, 'see them')}` : 'Merge them into one: fix it in the XML.' });
    }
  }
}

export default defineRule(
  {
    ruleName: 'c8-extensions',
    kind: 'engine-specific',
    targetEngine: 'c8',
    findings: {
      'c8-feel-completion-condition': ['W_C8_EXPRESSION', 'runtime'],
      'c8-bad-value': ['W_C8_BAD_VALUE', 'runtime'],
      'c8-listener': ['W_C8_DEPLOY_LISTENER', 'deploy'],
      'c8-extension': ['W_C8_DEPLOY_EXTENSION', 'deploy'],
      'c8-duplicate-extension': ['W_C8_DEPLOY_DUPLICATE_EXTENSION', 'deploy'],
    },
  },
  C8Extensions,
);
