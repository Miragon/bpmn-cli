import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, describeElement, ERROR_TYPES, type ModdleElement, type ReportData, type ReportPath } from '../CamundaRules.js';

import { ElementKinds } from '../describe.js';
import { EngineScope } from '../EngineScope.js';
import { sh } from '../shell.js';
import { Values } from '../Values.js';
import { C7Host, type HostExtension } from './C7Host.js';
import { CamundaPlacement } from './CamundaPlacement.js';

const SERVICE_LIKE = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask'];
/** The form field types every engine knows (more only through a custom form type plugin). */
const FORM_TYPES = ['string', 'long', 'boolean', 'date', 'enum'];
/** The order in which the engines pick the definition a throw event with several acts on. */
const ACTING_ORDER: Record<string, string[]> = { 'bpmn:IntermediateThrowEvent': ['Signal', 'Message'], 'bpmn:EndEvent': ['Message', 'Signal'] };
const EXECUTION_EVENTS = ['start', 'end'];
const TASK_EVENTS = ['create', 'assignment', 'complete', 'update', 'delete', 'timeout'];
const LISTENER_IMPLEMENTATIONS = ['class', 'expression', 'delegateExpression'];
const ASYNC_ATTRIBUTES = ['async', 'asyncBefore', 'asyncAfter'];

/** Where camunda:field elements sit: how messages name their holder, their path, and the `ext add` type argument that replaces one of them by name. */
interface FieldsAt {
  label: string;
  path: ReportPath;
  /** `X camunda:field`, `T 'camunda:taskListener[event=create]/camunda:field'`; undefined without an address */
  fieldOf: string | undefined;
  /** whether `path` leads to the list of fields (each one at its index) or to the field itself */
  indexed?: boolean;
}

/**
 * Reports camunda extension content the Camunda 7 engines refuse to deploy, in executable
 * processes: extension elements under `bpmn:definitions`; camunda:in / out without source and
 * target, nameless input or output parameters, a connector without connectorId, form fields
 * without id or with an unknown type, camunda:field without value where the engines read the
 * fields; listeners without implementation or with an unknown event, a script without format, a
 * timeout listener without timer or id; input/output mappings where the engines refuse them; a
 * second extension element the engines read as one (now, or once the element runs asynchronously).
 */
class C7ExtensionContent extends C7Rule {
  protected visit(node: ModdleElement): boolean | void {
    if (!C7Host.visits(node)) return false;
    if (is(node, 'bpmn:Definitions')) return this.checkDefinitionsExtension(node);
    if (!EngineScope.inExecutableProcess(node)) return;
    const host = new C7Host(node);
    const read = new CamundaPlacement(host).readExtensions();
    for (const extension of read) this.checkContent(host, extension);
    if (SERVICE_LIKE.some((type) => is(node, type))) this.checkImplementationFields(host, host.describe());
    if (this.isActingMessageThrow(host)) this.checkImplementationFields(host, describeElement(host.owner));
    for (const extension of read) if (extension.local === 'executionListener' || extension.local === 'taskListener') this.checkListener(host, extension);
    if (is(node, 'bpmn:FlowNode')) this.checkInputOutput(host);
    this.checkDuplicates(host);
  }

  private reportOn(host: C7Host, finding: string, message: string, data: ReportData): void {
    this.report(finding, host.target, message, data);
  }

  /** The BPMN schema does not allow extension elements under `bpmn:definitions`; the engines validate against it and refuse the file. */
  private checkDefinitionsExtension(node: ModdleElement): void {
    const values: ModdleElement[] = node.extensionElements?.values ?? [];
    if (!values.length) return;
    const types = values.map(({ $type: type }) => `${type.slice(0, type.indexOf(':') + 1)}${type.charAt(type.indexOf(':') + 1).toLowerCase()}${type.slice(type.indexOf(':') + 2)}`).join(', ');
    this.report('c7-definitions-extension', node, `bpmn:definitions carries bpmn:extensionElements (${types}), which the BPMN schema does not allow there; the engines refuse the file`, { path: ['extensionElements'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'extensionElements', hint: `Move the content to the process: \`bpmn ext remove <file> ${node.id ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.` });
  }

  private checkContent(host: C7Host, extension: HostExtension): void {
    const { value, index, local } = extension;
    if ((local === 'executionListener' || local === 'taskListener') && this.readsFields(value)) {
      const event: string | undefined = value.get('event');
      const fieldOf = host.address ? `${host.address.id} ${sh(`${host.address.slot}${host.selector(extension)}/${host.typeName('field')}`)}` : undefined;
      this.checkFields(host, value.get('fields'), { label: `${host.typeName(local)}${event ? ` (event ${event})` : ''} of ${host.describe()}`, path: host.extensionPath(index, 'fields'), fieldOf });
    } else if (local === 'in' || local === 'out') {
      this.checkBinding(host, extension);
    } else if (local === 'inputOutput') {
      this.checkParameters(host, value, host.extensionPath(index), host.rebuild(extension));
    } else if (local === 'connector') {
      const rebuild = host.rebuild(extension);
      if (value.get('connectorId') === undefined) this.reportOn(host, 'c7-extension', `${host.typeName('connector')} of ${host.describe()} has no ${host.typeName('connectorId')}; the engines refuse the file`, { path: host.extensionPath(index, 'connectorId'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: value, requiredProperty: 'connectorId', hint: rebuild });
      if (value.get('inputOutput')) this.checkParameters(host, value.get('inputOutput'), host.extensionPath(index, 'inputOutput'), rebuild);
    } else if (local === 'formData') {
      this.checkFormFields(host, extension);
    }
  }

  private checkBinding(host: C7Host, extension: HostExtension): void {
    const { value, index, local } = extension;
    if (value.get('variables') !== undefined || (local === 'in' && value.get('businessKey') !== undefined)) return;
    const hasSource = value.get('source') !== undefined || value.get('sourceExpression') !== undefined;
    const hasTarget = value.get('target') !== undefined;
    if (hasSource && hasTarget) return;
    const missing = [!hasSource ? 'source or sourceExpression' : '', !hasTarget ? 'target' : ''].filter(Boolean).join(' and ');
    const fix = { ...(hasSource ? {} : { source: '<var>' }), ...(hasTarget ? {} : { target: '<var>' }) };
    this.reportOn(host, 'c7-extension', `${host.typeName(local)} of ${host.describe()} has no ${missing} (and no variables="all"${local === 'in' ? ' / businessKey' : ''}); the engines refuse the file`, { path: hasSource ? host.extensionPath(index, 'target') : host.extensionPath(index), type: ERROR_TYPES.PROPERTY_REQUIRED, node: value, requiredProperty: hasSource ? 'target' : ['source', 'sourceExpression', ...(hasTarget ? [] : ['target'])], hint: `${host.rebuild(extension, fix).replace(/\.$/, '')} (or with variables=all instead of source and target).` });
  }

  private checkParameters(host: C7Host, mapping: ModdleElement, path: ReportPath, rebuild: string): void {
    for (const kind of ['inputParameter', 'outputParameter']) {
      (mapping.get(`${kind}s`) ?? []).forEach((parameter: ModdleElement, index: number) => {
        if (!Values.nonEmpty(parameter.get('name'))) this.reportOn(host, 'c7-extension', `${host.typeName(kind)} ${index + 1} of ${host.describe()} has no name; the engines refuse the file`, { path: [...path, `${kind}s`, index, 'name'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: parameter, requiredProperty: 'name', hint: rebuild });
      });
    }
  }

  private checkFormFields(host: C7Host, extension: HostExtension): void {
    const rebuild = host.rebuild(extension);
    (extension.value.get('fields') ?? []).forEach((field: ModdleElement, fieldIndex: number) => {
      const id: string | undefined = field.get('id');
      const type: string | undefined = field.get('type');
      const label = `Form field ${id ?? fieldIndex + 1} of ${host.describe()}`;
      const path = host.extensionPath(extension.index, 'fields', fieldIndex);
      if (!Values.nonEmpty(id)) this.reportOn(host, 'c7-extension', `${label} has no id; the engines refuse the file`, { path: [...path, 'id'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: field, requiredProperty: 'id', hint: rebuild });
      if (type === undefined) this.reportOn(host, 'c7-extension', `${label} has no type; the engines refuse the file`, { path: [...path, 'type'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: field, requiredProperty: 'type', hint: `Use one of ${FORM_TYPES.join(', ')}. ${rebuild}` });
      else if (!FORM_TYPES.includes(type)) this.reportOn(host, 'c7-extension', `${label} has type "${type}", which is not one of the built-in form types ${FORM_TYPES.join(', ')}; the engines refuse the file (unless a plugin registers it as a custom form type)`, { path: [...path, 'type'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: field, property: 'type', hint: rebuild });
    });
  }

  /** The camunda:field elements of a task or a message throw event definition, where its implementation reads them. */
  private checkImplementationFields(host: C7Host, label: string): void {
    const type: string | undefined = host.node.get('camunda:type');
    const shell = type?.toLowerCase() === 'shell';
    if (type !== undefined ? !shell : !this.readsFields(host.node, 'camunda:')) return;
    const fieldOf = host.address ? `${host.address.id} ${sh(`${host.address.slot}${host.typeName('field')}`)}` : undefined;
    for (const { value, index } of host.camundaExtensions('field')) this.checkFields(host, [value], { label, path: host.extensionPath(index), fieldOf, indexed: false });
  }

  /** Whether the engines parse the fields of an implementation: a class, or a delegate expression without an expression. */
  private readsFields(el: ModdleElement, prefix = ''): boolean {
    return Values.nonEmpty(el.get(`${prefix}class`)) || (el.get(`${prefix}expression`) === undefined && Values.nonEmpty(el.get(`${prefix}delegateExpression`)));
  }

  private checkFields(host: C7Host, fields: ModdleElement[] | undefined, { label, path, fieldOf, indexed = true }: FieldsAt): void {
    (fields ?? []).forEach((field, index) => {
      const problem = this.fieldProblem(field);
      if (!problem) return;
      const name: string | undefined = field.get('name');
      const fieldPath = indexed ? [...path, index] : path;
      const hint = fieldOf && name !== undefined ? `Give it one: \`bpmn ext add <file> ${fieldOf} name=${sh(name)} stringValue=<value>\` (replaces the field of that name; or ${sh('expression=${...}')}).` : 'Give it a stringValue or an expression in the XML.';
      const kind = problem === 'no value' ? { path: fieldPath, type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: ['stringValue', 'expression', 'string'] } : { path: [...fieldPath, 'string'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'string' };
      this.reportOn(host, 'c7-extension', `${host.typeName('field')}${name !== undefined ? ` "${name}"` : ''} of ${label} has ${problem}; the engines refuse the file (a field needs stringValue, expression, a ${host.typeName('string')} or a ${host.typeName('expression')})`, { node: field, hint, ...kind });
    });
  }

  /**
   * What keeps the engines from reading a field's value: none at all, or the stringValue attribute
   * next to a camunda:string element. An element without text counts as a value; an empty
   * expression does too, as the moddle cannot tell its attribute from its element.
   */
  private fieldProblem(field: ModdleElement): string | undefined {
    const stringValue: string | undefined = field.get('stringValue');
    const stringElement: string | undefined = field.get('string');
    if (stringValue !== undefined && stringElement !== undefined) return 'both the attribute stringValue and a camunda:string element';
    return stringElement !== undefined || (stringValue !== undefined && stringValue.length > 0) || field.get('expression') !== undefined ? undefined : 'no value';
  }

  /** Whether the host is the message definition a throw or end event acts on. */
  private isActingMessageThrow(host: C7Host): boolean {
    const event = host.owner;
    if (!is(host.node, 'bpmn:MessageEventDefinition') || !event || !(event.eventDefinitions ?? []).includes(host.node)) return false;
    const order = ACTING_ORDER[event.$type];
    if (!order) return false;
    const definitions: ModdleElement[] = event.eventDefinitions;
    const ranks = definitions.map((definition) => order.findIndex((kind) => is(definition, `bpmn:${kind}EventDefinition`)));
    return definitions.length < 2 || ranks.includes(-1) || definitions[ranks.indexOf(Math.min(...ranks))] === host.node;
  }

  /** A listener needs an implementation, an event the engines know (none on a flow), a script format; a timeout task listener a timer and an id. */
  private checkListener(host: C7Host, extension: HostExtension): void {
    const { value: listener, index, local } = extension;
    const event: string | undefined = listener.get('event');
    const label = `${host.typeName(local)}${event ? ` (event ${event})` : ''} of ${host.describe()}`;
    const report = (message: string, steps: ReportPath, type: string, details: Record<string, unknown>) => this.reportOn(host, 'c7-listener', message, { path: host.extensionPath(index, ...steps), type, node: listener, ...details });
    if (!LISTENER_IMPLEMENTATIONS.some((name) => Values.nonEmpty(listener.get(name))) && listener.script === undefined) report(`${label} has no class, expression, delegateExpression or script; the engines refuse the file`, [], ERROR_TYPES.PROPERTY_REQUIRED, { requiredProperty: [...LISTENER_IMPLEMENTATIONS, 'script'], hint: host.rebuild(extension, { expression: '${...}' }) });
    if (!is(host.node, 'bpmn:SequenceFlow')) {
      const allowed = local === 'taskListener' ? TASK_EVENTS : EXECUTION_EVENTS;
      const rebuild = host.rebuild(extension, { event: `<${allowed.join('|')}>` });
      if (event === undefined) report(`${label} has no event; the engines refuse the file`, ['event'], ERROR_TYPES.PROPERTY_REQUIRED, { requiredProperty: 'event', hint: `Set event to one of ${allowed.join(', ')}. ${rebuild}` });
      else if (!allowed.includes(event)) report(`${label}: event "${event}" is not one of ${allowed.join(', ')}; the engines refuse the file`, ['event'], ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, { property: 'event', hint: `${event === 'take' && local === 'executionListener' ? 'take is only read on sequence flows. ' : ''}${rebuild}` });
    }
    if (listener.script && !Values.nonEmpty(listener.script.get('scriptFormat'))) report(`The script of ${label} has no scriptFormat; the engines refuse the file`, ['script', 'scriptFormat'], ERROR_TYPES.PROPERTY_REQUIRED, { requiredProperty: 'scriptFormat', hint: host.rebuild(extension) });
    if (local !== 'taskListener' || event !== 'timeout') return;
    if (!(listener.get('eventDefinitions') ?? []).some((definition: ModdleElement) => is(definition, 'bpmn:TimerEventDefinition'))) report(`${label} has no bpmn:timerEventDefinition; the engines refuse the file`, ['eventDefinitions'], ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED, { requiredType: 'bpmn:TimerEventDefinition', hint: host.rebuild(extension) });
    if (listener.get('id') === undefined) report(`${label} has no id, which the engines require on timeout task listeners; they refuse the file`, ['id'], ERROR_TYPES.PROPERTY_REQUIRED, { requiredProperty: 'id', hint: host.rebuild(extension, { id: '<listenerId>' }) });
  }

  /** camunda:inputOutput on a start or boundary event, a gateway or an event sub-process; output parameters on an end event or a multi-instance activity. */
  private checkInputOutput(host: C7Host): void {
    const node = host.node;
    const mappings = host.camundaExtensions('inputOutput');
    const [first] = mappings;
    if (!first) return;
    const mapping = host.typeName('inputOutput');
    const unsupported = this.unsupportedMappingHost(node);
    if (unsupported) return this.reportOn(host, 'c7-input-output', `${mapping} on ${host.describe()}: the engines do not support input/output mappings on ${unsupported} and refuse the file`, { path: host.extensionPath(first.index), type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, node: first.value, extensionElement: first.value, hint: `Move the mappings to the next activity and remove them here: \`bpmn ext remove <file> ${node.id} ${mapping}\`.` });
    const withOutputs = mappings.find(({ value }) => (value.get('outputParameters') ?? []).length);
    const parameter = host.typeName('outputParameter');
    const dropOutputs = `Remove the output parameters: rebuild the mapping without them (\`bpmn ext list <file> ${node.id} --json\`, then \`bpmn ext add <file> ${node.id} ${mapping} --replace --xml '...'\`).`;
    const loop = node.loopCharacteristics;
    const report = (message: string, hint: string) => withOutputs && this.reportOn(host, 'c7-input-output', message, { hint, path: host.extensionPath(withOutputs.index, 'outputParameters'), type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: withOutputs.value, property: 'outputParameters' });
    if (is(node, 'bpmn:EndEvent')) report(`${parameter} on end event ${node.id}: the engines refuse output mappings on end events`, dropOutputs);
    else if (loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) report(`${parameter} on multi-instance ${host.describe()}: the engines refuse output mappings on multi-instance activities`, `${dropOutputs} Collect results in an activity inside the loop instead.`);
  }

  /** `a startEvent`, `a boundaryEvent:timer`, `an event sub-process`; undefined where the engines take mappings. */
  private unsupportedMappingHost(node: ModdleElement): string | undefined {
    if (is(node, 'bpmn:SubProcess') && node.triggeredByEvent === true) return 'an event sub-process';
    return is(node, 'bpmn:StartEvent') || is(node, 'bpmn:BoundaryEvent') || is(node, 'bpmn:Gateway') ? `a ${ElementKinds.of(node)}` : undefined;
  }

  /**
   * A second camunda extension element of a type the engines read with a single-element lookup
   * (ENGINE-01009): inputOutput on flow nodes, connector on service-like tasks, formData on user
   * tasks and start events, failedJobRetryTimeCycle on asynchronous elements and timer events; of
   * the last on an element not asynchronous yet, the file deploys until it is.
   */
  private checkDuplicates(host: C7Host): void {
    const byLocal = new Map<string, HostExtension[]>();
    for (const extension of host.camundaExtensions()) byLocal.set(extension.local, [...(byLocal.get(extension.local) ?? []), extension]);
    for (const reportsRead of [true, false]) {
      for (const [local, extensions] of byLocal) {
        const [, second] = extensions;
        if (!second || this.isRead(host.node, local) !== reportsRead) continue;
        const typeName = host.typeName(local);
        const message = reportsRead ? `${host.describe()} has ${extensions.length} ${typeName} elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name ${local})` : `${host.describe()} has ${extensions.length} ${typeName} elements; once it runs asynchronously the engines refuse the file`;
        this.reportOn(host, reportsRead ? 'c7-duplicate-extension' : 'c7-async-duplicate-extension', message, { path: host.extensionPath(second.index), type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, node: second.value, hint: host.merge(local) });
      }
    }
  }

  /** Whether the engines read the extension type `local` on `node` now, or only once it runs asynchronously; undefined for one whose duplicates do not matter there. */
  private isRead(node: ModdleElement, local: string): boolean | undefined {
    if (local === 'inputOutput') return is(node, 'bpmn:FlowNode') || undefined;
    if (local === 'connector') return SERVICE_LIKE.some((type) => is(node, type)) || undefined;
    if (local === 'formData') return is(node, 'bpmn:UserTask') || is(node, 'bpmn:StartEvent') || undefined;
    if (local !== 'failedJobRetryTimeCycle') return undefined;
    return ASYNC_ATTRIBUTES.some((name) => [true, 'true'].includes(node.get(`camunda:${name}`))) || (node.eventDefinitions ?? []).some((definition: ModdleElement) => is(definition, 'bpmn:TimerEventDefinition'));
  }
}

export default defineRule(
  {
    ruleName: 'c7-extension-content',
    kind: 'engine-specific',
    targetEngine: 'c7',
    findings: {
      'c7-definitions-extension': ['W_C7_DEPLOY_DEFINITIONS_EXTENSION', 'deploy'],
      'c7-extension': ['W_C7_DEPLOY_EXTENSION', 'deploy'],
      'c7-listener': ['W_C7_DEPLOY_LISTENER', 'deploy'],
      'c7-input-output': ['W_C7_DEPLOY_INPUT_OUTPUT', 'deploy'],
      'c7-duplicate-extension': ['W_C7_DEPLOY_DUPLICATE_EXTENSION', 'deploy'],
      'c7-async-duplicate-extension': ['W_C7_DUPLICATE_EXTENSION', 'practice'],
    },
  },
  C7ExtensionContent,
);
