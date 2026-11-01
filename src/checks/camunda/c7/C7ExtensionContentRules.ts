import { type BpmnElement, IdWords, Kinds } from '../../../model/index.js';
import type { C7ImplementationRules } from './C7ImplementationRules.js';
import { C7Rules } from './C7Rules.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C7ExtensionContentRules extends C7Rules {
  private static readonly EXECUTION_EVENTS = ['start', 'end'];
  private static readonly FORM_TYPES = ['string', 'long', 'boolean', 'date', 'enum'];
  private static readonly TASK_EVENTS = ['create', 'assignment', 'complete', 'update', 'delete', 'timeout'];

  constructor(
    context: RuleContext,
    private readonly implementation: C7ImplementationRules,
  ) {
    super(context);
  }

  check(element: BpmnElement, reporter: RuleReporter): void {
    this.checkContent(reporter.host, reporter.owner, element, IdWords.localName(element.type), reporter);
  }

  private checkContent(host: BpmnElement, owner: BpmnElement | undefined, extension: BpmnElement, local: string, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    const rebuild = (fix: Record<string, string> = {}): string => this.extHint(host, owner, extension, local, fix);
    if (local === 'executionListener' || local === 'taskListener') {
      if (local === 'taskListener' && !host.is('bpmn:UserTask')) {
        return;
      }
      const impl = ['class', 'expression', 'delegateExpression'].some((attribute) => this.nonEmpty(this.attr(extension, attribute))) || this.children(extension, 'script').length > 0;
      const event = this.attr(extension, 'event');
      const label = `${this.prefix}:${local}${event ? ` (event ${event})` : ''} of ${where}`;
      if (!impl) {
        reporter.deploy({ code: 'W_C7_DEPLOY_LISTENER', element: host, owner, subject: `listener:${local}:${event}:impl`, message: `${label} has no class, expression, delegateExpression or script; the engines refuse the file`, hint: rebuild({ [`expression`]: '${...}' }) });
      }
      if (!host.is('bpmn:SequenceFlow')) {
        const allowed = local === 'taskListener' ? C7ExtensionContentRules.TASK_EVENTS : C7ExtensionContentRules.EXECUTION_EVENTS;
        const placeholder = `<${allowed.join('|')}>`;
        if (event === undefined) {
          reporter.deploy({ code: 'W_C7_DEPLOY_LISTENER', element: host, owner, subject: `listener:${local}:event`, message: `${label} has no event; the engines refuse the file`, hint: `Set event to one of ${allowed.join(', ')}. ${rebuild({ event: placeholder })}` });
        } else if (!allowed.includes(event)) {
          reporter.deploy({ code: 'W_C7_DEPLOY_LISTENER', element: host, owner, subject: `listener:${local}:${event}:event`, message: `${label}: event "${event}" is not one of ${allowed.join(', ')}; the engines refuse the file`, hint: `${event === 'take' && local === 'executionListener' ? 'take is only read on sequence flows. ' : ''}${rebuild({ event: placeholder })}` });
        }
      }
      for (const script of this.children(extension, 'script')) {
        if (!this.nonEmpty(this.attr(script, 'scriptFormat'))) {
          reporter.deploy({ code: 'W_C7_DEPLOY_LISTENER', element: host, owner, subject: `listener:${local}:${event}:script`, message: `The script of ${label} has no scriptFormat; the engines refuse the file`, hint: rebuild() });
        }
      }
      if (local === 'taskListener' && event === 'timeout') {
        const kids = extension.peek<unknown[]>('$children');
        const timer = Array.isArray(kids) && (kids as BpmnElement[]).some((kid) => kid && typeof kid.type === 'string' && /timerEventDefinition$/i.test(kid.type));
        if (!timer) {
          reporter.deploy({ code: 'W_C7_DEPLOY_LISTENER', element: host, owner, subject: `listener:${local}:timeout:timer`, message: `${label} has no bpmn:timerEventDefinition; the engines refuse the file`, hint: rebuild() });
        }
        if (this.attr(extension, 'id') === undefined) {
          reporter.deploy({ code: 'W_C7_DEPLOY_LISTENER', element: host, owner, subject: `listener:${local}:timeout:id`, message: `${label} has no id, which the engines require on timeout task listeners; they refuse the file`, hint: rebuild({ id: '<listenerId>' }) });
        }
      }
      const fieldsHere = this.children(extension, 'field');
      if (fieldsHere.length && this.implementation.fieldsRead(extension)) {
        const addr = this.addressOf(host, owner);
        this.implementation.checkFieldValues(host, owner, fieldsHere, label, addr ? `${addr.id} ${ShellWords.quote(`${addr.prefix}${this.selectorOf(host, extension)}/${this.prefix}:field`)}` : undefined, reporter);
      }
      return;
    }
    if (local === 'in' || local === 'out') {
      if (!host.is('bpmn:CallActivity') && !(local === 'in' && host.is('bpmn:SignalEventDefinition'))) {
        return;
      }
      if (this.attr(extension, 'variables') !== undefined || (local === 'in' && this.attr(extension, 'businessKey') !== undefined)) {
        return;
      }
      const source = this.attr(extension, 'source') !== undefined || this.attr(extension, 'sourceExpression') !== undefined;
      const target = this.attr(extension, 'target') !== undefined;
      if (!source || !target) {
        const missing = [!source ? 'source or sourceExpression' : '', !target ? 'target' : ''].filter(Boolean).join(' and ');
        const fix: Record<string, string> = {};
        if (!source) {
          fix['source'] = '<var>';
        }
        if (!target) {
          fix['target'] = '<var>';
        }
        reporter.deploy({ code: 'W_C7_DEPLOY_EXTENSION', element: host, owner, subject: `${local}:${this.attr(extension, 'source') ?? this.attr(extension, 'sourceExpression') ?? this.attr(extension, 'target') ?? ''}`, message: `${this.prefix}:${local} of ${where} has no ${missing} (and no variables="all"${local === 'in' ? ' / businessKey' : ''}); the engines refuse the file`, hint: `${rebuild(fix).replace(/\.$/, '')} (or with variables=all instead of source and target).` });
      }
      return;
    }
    if (local === 'inputOutput') {
      this.checkParameters(host, owner, extension, rebuild(), local, reporter);
      return;
    }
    if (local === 'connector') {
      const ids = this.children(extension).filter((child) => IdWords.localName(child.type) === 'connectorId');
      if (!ids.length) {
        reporter.deploy({ code: 'W_C7_DEPLOY_EXTENSION', element: host, owner, subject: 'connector:id', message: `${this.prefix}:connector of ${where} has no ${this.prefix}:connectorId; the engines refuse the file`, hint: rebuild() });
      }
      if (ids.length > 1) {
        reporter.deploy({ code: 'W_C7_DEPLOY_DUPLICATE_EXTENSION', element: host, owner, subject: 'dup:connectorId', message: `${this.prefix}:connector of ${where} has ${ids.length} ${this.prefix}:connectorId elements; the engines refuse the file`, hint: rebuild() });
      }
      const ios = this.children(extension, 'inputOutput');
      if (ios.length > 1) {
        reporter.deploy({ code: 'W_C7_DEPLOY_DUPLICATE_EXTENSION', element: host, owner, subject: 'dup:connector/inputOutput', message: `${this.prefix}:connector of ${where} has ${ios.length} ${this.prefix}:inputOutput elements; the engines refuse the file`, hint: rebuild() });
      }
      for (const io of ios) {
        this.checkParameters(host, owner, io, rebuild(), 'connector', reporter);
      }
      return;
    }
    if (local === 'formData' && (host.is('bpmn:UserTask') || host.is('bpmn:StartEvent'))) {
      this.children(extension, 'formField').forEach((field, index) => {
        const label = `Form field ${this.attr(field, 'id') ?? index + 1} of ${where}`;
        if (!this.nonEmpty(this.attr(field, 'id'))) {
          reporter.deploy({ code: 'W_C7_DEPLOY_EXTENSION', element: host, owner, subject: `formField#${index}:id`, message: `${label} has no id; the engines refuse the file`, hint: rebuild() });
        }
        const type = this.attr(field, 'type');
        if (type === undefined) {
          reporter.deploy({ code: 'W_C7_DEPLOY_EXTENSION', element: host, owner, subject: `formField#${index}:type`, message: `${label} has no type; the engines refuse the file`, hint: `Use one of ${C7ExtensionContentRules.FORM_TYPES.join(', ')}. ${rebuild()}` });
        } else if (!C7ExtensionContentRules.FORM_TYPES.includes(type)) {
          reporter.deploy({ code: 'W_C7_DEPLOY_EXTENSION', element: host, owner, subject: `formField#${index}:type`, message: `${label} has type "${type}", which is not one of the built-in form types ${C7ExtensionContentRules.FORM_TYPES.join(', ')}; the engines refuse the file (unless a plugin registers it as a custom form type)`, hint: rebuild() });
        }
      });
    }
  }

  private checkParameters(host: BpmnElement, owner: BpmnElement | undefined, io: BpmnElement, rebuild: string, scope: string, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    for (const kind of ['inputParameter', 'outputParameter']) {
      this.children(io, kind).forEach((param, index) => {
        if (!this.nonEmpty(this.attr(param, 'name'))) {
          reporter.deploy({ code: 'W_C7_DEPLOY_EXTENSION', element: host, owner, subject: `${scope}:${kind}#${index}:name`, message: `${this.prefix}:${kind} ${index + 1} of ${where} has no name; the engines refuse the file`, hint: rebuild });
        }
      });
    }
  }

  checkInputOutputHost(host: BpmnElement, owner: BpmnElement | undefined, ios: BpmnElement[], reporter: RuleReporter): void {
    if (!ios.length || !host.is('bpmn:FlowNode')) {
      return;
    }
    const hostId = host.id ?? owner?.id;
    const where = this.describe(host, owner);
    const remove = hostId ? `Move the mappings to the next activity and remove them here: \`bpmn ext remove <file> ${hostId} ${this.prefix}:inputOutput\`.` : 'Remove it from the XML.';
    if (host.is('bpmn:StartEvent') || host.is('bpmn:BoundaryEvent') || host.is('bpmn:Gateway') || Kinds.isEventSubProcess(host)) {
      const kind = Kinds.isEventSubProcess(host) ? 'an event sub-process' : `a ${this.describe(host, undefined).split(' ')[0]}`;
      reporter.deploy({ code: 'W_C7_DEPLOY_INPUT_OUTPUT', element: host, owner, subject: 'io:host', message: `${this.prefix}:inputOutput on ${where}: the engines do not support input/output mappings on ${kind} and refuse the file`, hint: remove });
      return;
    }
    const outputs = ios.some((io) => this.children(io, 'outputParameter').length > 0);
    if (!outputs) {
      return;
    }
    const dropOutputs = hostId ? `Remove the output parameters: rebuild the mapping without them (\`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${this.prefix}:inputOutput --replace --xml '...'\`).` : 'Remove them from the XML.';
    if (host.is('bpmn:EndEvent')) {
      reporter.deploy({ code: 'W_C7_DEPLOY_INPUT_OUTPUT', element: host, owner, subject: 'io:output', message: `${this.prefix}:outputParameter on end event ${hostId}: the engines refuse output mappings on end events`, hint: dropOutputs });
    } else if (this.isMultiInstance(host)) {
      reporter.deploy({ code: 'W_C7_DEPLOY_INPUT_OUTPUT', element: host, owner, subject: 'io:output', message: `${this.prefix}:outputParameter on multi-instance ${where}: the engines refuse output mappings on multi-instance activities`, hint: `${dropOutputs} Collect results in an activity inside the loop instead.` });
    }
  }
}
