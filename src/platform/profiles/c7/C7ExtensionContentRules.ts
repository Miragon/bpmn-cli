import type { El } from '../../../model/utils/moddle.js';
import type { RuleRun } from '../RuleRun.js';
import { attr, idOf, localName, peek } from '../utils/element.js';
import { sh } from '../utils/hint.js';
import { nonEmpty } from '../utils/value.js';
import type { C7ImplementationRules } from './C7ImplementationRules.js';
import { C7Rules } from './C7Rules.js';

const EXECUTION_EVENTS = ['start', 'end'];
/** the form field types every engine knows (more only through a custom form type plugin) */
const FORM_TYPES = ['string', 'long', 'boolean', 'date', 'enum'];
const TASK_EVENTS = ['create', 'assignment', 'complete', 'update', 'delete', 'timeout'];

/** Engine rules on the content of camunda extensions: listeners, mappings, connectors, forms. */
export class C7ExtensionContentRules extends C7Rules {
  constructor(
    run: RuleRun,
    prefix: string,
    private readonly implementation: C7ImplementationRules,
  ) {
    super(run, prefix);
  }

  /** Engine rules on the content of one (allowed, top-level) camunda extension element. */
  checkContent(host: El, owner: El | undefined, extension: El, local: string): void {
    const where = this.describe(host, owner);
    const rebuild = (fix: Record<string, string> = {}): string => this.extHint(host, owner, extension, local, fix);
    if (local === 'executionListener' || local === 'taskListener') {
      if (local === 'taskListener' && !this.kit.is(host, 'bpmn:UserTask')) return;
      const impl = ['class', 'expression', 'delegateExpression'].some((attribute) => nonEmpty(attr(extension, attribute))) || this.children(extension, 'script').length > 0;
      const event = attr(extension, 'event');
      const label = `${this.prefix}:${local}${event ? ` (event ${event})` : ''} of ${where}`;
      if (!impl) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:${event}:impl`, `${label} has no class, expression, delegateExpression or script; the engines refuse the file`, rebuild({ [`expression`]: '${...}' }));
      if (!this.kit.is(host, 'bpmn:SequenceFlow')) {
        const allowed = local === 'taskListener' ? TASK_EVENTS : EXECUTION_EVENTS;
        const placeholder = `<${allowed.join('|')}>`;
        if (event === undefined) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:event`, `${label} has no event; the engines refuse the file`, `Set event to one of ${allowed.join(', ')}. ${rebuild({ event: placeholder })}`);
        else if (!allowed.includes(event)) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:${event}:event`, `${label}: event "${event}" is not one of ${allowed.join(', ')}; the engines refuse the file`, `${event === 'take' && local === 'executionListener' ? 'take is only read on sequence flows. ' : ''}${rebuild({ event: placeholder })}`);
      }
      for (const script of this.children(extension, 'script')) {
        if (!nonEmpty(attr(script, 'scriptFormat'))) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:${event}:script`, `The script of ${label} has no scriptFormat; the engines refuse the file`, rebuild());
      }
      if (local === 'taskListener' && event === 'timeout') {
        const kids = peek<unknown[]>(extension, '$children');
        const timer = Array.isArray(kids) && (kids as El[]).some((kid) => kid && typeof kid.$type === 'string' && /timerEventDefinition$/i.test(kid.$type));
        if (!timer) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:timeout:timer`, `${label} has no bpmn:timerEventDefinition; the engines refuse the file`, rebuild());
        if (attr(extension, 'id') === undefined) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:timeout:id`, `${label} has no id, which the engines require on timeout task listeners; they refuse the file`, rebuild({ id: '<listenerId>' }));
      }
      // fields of a class / delegateExpression listener are parsed when the file is deployed
      const fieldsHere = this.children(extension, 'field');
      if (fieldsHere.length && this.implementation.fieldsRead(extension)) {
        const addr = this.addressOf(host, owner);
        this.implementation.checkFieldValues(host, owner, fieldsHere, label, addr ? `${addr.id} ${sh(`${addr.prefix}${this.selectorOf(host, extension)}/${this.prefix}:field`)}` : undefined);
      }
      return;
    }
    if (local === 'in' || local === 'out') {
      if (!this.kit.is(host, 'bpmn:CallActivity') && !(local === 'in' && this.kit.is(host, 'bpmn:SignalEventDefinition'))) return;
      if (attr(extension, 'variables') !== undefined || (local === 'in' && attr(extension, 'businessKey') !== undefined)) return;
      const source = attr(extension, 'source') !== undefined || attr(extension, 'sourceExpression') !== undefined;
      const target = attr(extension, 'target') !== undefined;
      if (!source || !target) {
        const missing = [!source ? 'source or sourceExpression' : '', !target ? 'target' : ''].filter(Boolean).join(' and ');
        const fix: Record<string, string> = {};
        if (!source) fix['source'] = '<var>';
        if (!target) fix['target'] = '<var>';
        this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `${local}:${attr(extension, 'source') ?? attr(extension, 'sourceExpression') ?? attr(extension, 'target') ?? ''}`, `${this.prefix}:${local} of ${where} has no ${missing} (and no variables="all"${local === 'in' ? ' / businessKey' : ''}); the engines refuse the file`, `${rebuild(fix).replace(/\.$/, '')} (or with variables=all instead of source and target).`);
      }
      return;
    }
    if (local === 'inputOutput') {
      this.checkParameters(host, owner, extension, rebuild(), local);
      return;
    }
    if (local === 'connector') {
      const ids = this.children(extension).filter((child) => localName(child.$type) === 'connectorId');
      if (!ids.length) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, 'connector:id', `${this.prefix}:connector of ${where} has no ${this.prefix}:connectorId; the engines refuse the file`, rebuild());
      if (ids.length > 1) this.push('deploy', 'W_C7_DEPLOY_DUPLICATE_EXTENSION', host, owner, 'dup:connectorId', `${this.prefix}:connector of ${where} has ${ids.length} ${this.prefix}:connectorId elements; the engines refuse the file`, rebuild());
      const ios = this.children(extension, 'inputOutput');
      if (ios.length > 1) this.push('deploy', 'W_C7_DEPLOY_DUPLICATE_EXTENSION', host, owner, 'dup:connector/inputOutput', `${this.prefix}:connector of ${where} has ${ios.length} ${this.prefix}:inputOutput elements; the engines refuse the file`, rebuild());
      for (const io of ios) this.checkParameters(host, owner, io, rebuild(), 'connector');
      return;
    }
    if (local === 'formData' && (this.kit.is(host, 'bpmn:UserTask') || this.kit.is(host, 'bpmn:StartEvent'))) {
      this.children(extension, 'formField').forEach((field, index) => {
        const label = `Form field ${attr(field, 'id') ?? index + 1} of ${where}`;
        if (!nonEmpty(attr(field, 'id'))) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `formField#${index}:id`, `${label} has no id; the engines refuse the file`, rebuild());
        const type = attr(field, 'type');
        if (type === undefined) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `formField#${index}:type`, `${label} has no type; the engines refuse the file`, `Use one of ${FORM_TYPES.join(', ')}. ${rebuild()}`);
        else if (!FORM_TYPES.includes(type)) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `formField#${index}:type`, `${label} has type "${type}", which is not one of the built-in form types ${FORM_TYPES.join(', ')}; the engines refuse the file (unless a plugin registers it as a custom form type)`, rebuild());
      });
    }
  }

  private checkParameters(host: El, owner: El | undefined, io: El, rebuild: string, scope: string): void {
    const where = this.describe(host, owner);
    for (const kind of ['inputParameter', 'outputParameter']) {
      this.children(io, kind).forEach((param, index) => {
        if (!nonEmpty(attr(param, 'name'))) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `${scope}:${kind}#${index}:name`, `${this.prefix}:${kind} ${index + 1} of ${where} has no name; the engines refuse the file`, rebuild);
      });
    }
  }

  /** Where the engines refuse camunda:inputOutput. */
  checkInputOutputHost(host: El, owner: El | undefined, ios: El[]): void {
    if (!ios.length || !this.kit.is(host, 'bpmn:FlowNode')) return;
    const hostId = idOf(host) ?? idOf(owner);
    const where = this.describe(host, owner);
    const remove = hostId ? `Move the mappings to the next activity and remove them here: \`bpmn ext remove <file> ${hostId} ${this.prefix}:inputOutput\`.` : 'Remove it from the XML.';
    if (this.kit.is(host, 'bpmn:StartEvent') || this.kit.is(host, 'bpmn:BoundaryEvent') || this.kit.is(host, 'bpmn:Gateway') || this.kit.isEventSubProcess(host)) {
      const kind = this.kit.isEventSubProcess(host) ? 'an event sub-process' : `a ${this.describe(host, undefined).split(' ')[0]}`;
      this.push('deploy', 'W_C7_DEPLOY_INPUT_OUTPUT', host, owner, 'io:host', `${this.prefix}:inputOutput on ${where}: the engines do not support input/output mappings on ${kind} and refuse the file`, remove);
      return;
    }
    const outputs = ios.some((io) => this.children(io, 'outputParameter').length > 0);
    if (!outputs) return;
    const dropOutputs = hostId ? `Remove the output parameters: rebuild the mapping without them (\`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${this.prefix}:inputOutput --replace --xml '...'\`).` : 'Remove them from the XML.';
    if (this.kit.is(host, 'bpmn:EndEvent')) {
      this.push('deploy', 'W_C7_DEPLOY_INPUT_OUTPUT', host, owner, 'io:output', `${this.prefix}:outputParameter on end event ${hostId}: the engines refuse output mappings on end events`, dropOutputs);
    } else if (this.isMultiInstance(host)) {
      this.push('deploy', 'W_C7_DEPLOY_INPUT_OUTPUT', host, owner, 'io:output', `${this.prefix}:outputParameter on multi-instance ${where}: the engines refuse output mappings on multi-instance activities`, `${dropOutputs} Collect results in an activity inside the loop instead.`);
    }
  }
}
