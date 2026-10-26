import type { El } from '../../../document/utils/moddle.js';
import { attr, idOf, isGeneric, peek } from '../../utils/element.js';
import { sh } from '../../utils/hint.js';
import { nonEmpty } from '../../utils/value.js';
import { C7Rules } from './C7Rules.js';

type FieldValue = { kind: 'string' | 'expression'; value: string } | { problem: string };

const SHELL_FLAGS = ['wait', 'redirectError', 'cleanEnv'];
const BINDINGS = ['latest', 'deployment', 'version', 'versionTag'];
const CASE_BINDINGS = ['latest', 'deployment', 'version'];
const FORM_BINDINGS = ['deployment', 'latest', 'version'];
const DECISION_MAPPERS = ['singleEntry', 'singleResult', 'collectEntries', 'resultList'];
const TTL_MAX = 2147483647;

/**
 * How activities and processes are implemented and bound: delegates, external and shell tasks,
 * called elements and decisions, forms, multi-instance loops, priorities, history time to live.
 */
export class C7ImplementationRules extends C7Rules {
  private isExpression(value: string): boolean {
    return /[$#]\{/.test(value);
  }

  private isNumber(value: string): boolean {
    return /^[+-]?\d+$/.test(value.trim()) && value.trim() === value;
  }

  /**
   * A camunda:field's value as the engines parse it: stringValue / camunda:string first, then
   * expression / camunda:expression. None, or attribute and element of one kind together, is
   * refused where the engines read fields. An element without text counts as a value.
   */
  private fieldValue(field: El): FieldValue {
    const pick = (attrName: string, child: string): { value?: string; problem?: string } => {
      const attributeValue = attr(field, attrName);
      const kids = this.children(field, child);
      if (attributeValue !== undefined && kids.length) return { problem: `both the attribute ${attrName} and a ${this.prefix}:${child} element` };
      if (kids.length) {
        const text = peek<unknown>(kids[0], '$body');
        return { value: typeof text === 'string' ? text : '' };
      }
      return attributeValue !== undefined && attributeValue.length > 0 ? { value: attributeValue } : {};
    };
    const stringValue = pick('stringValue', 'string');
    if (stringValue.problem) return { problem: stringValue.problem };
    if (stringValue.value !== undefined) return { kind: 'string', value: stringValue.value };
    const expression = pick('expression', 'expression');
    if (expression.problem) return { problem: expression.problem };
    if (expression.value !== undefined) return { kind: 'expression', value: expression.value };
    return { problem: 'no value' };
  }

  /**
   * Whether the engines parse the camunda:field elements of an implementation: a class or a
   * delegate expression (an expression wins and reads none), a shell task; never an external task.
   */
  fieldsRead(el: El, opts: { type?: string } = {}): boolean {
    if (opts.type !== undefined) return opts.type.toLowerCase() === 'shell';
    const get = (attributeName: string): string | undefined => (isGeneric(el) ? attr(el, attributeName) : this.c7(el, attributeName));
    if (nonEmpty(get('class'))) return true;
    return get('expression') === undefined && nonEmpty(get('delegateExpression'));
  }

  /**
   * Fields without a value where the engines read them; `add` is the `ext add` type argument that
   * replaces one field.
   */
  checkFieldValues(host: El, owner: El | undefined, fields: El[], label: string, add: string | undefined): void {
    fields.forEach((field, index) => {
      const fieldValue = this.fieldValue(field);
      if (!('problem' in fieldValue)) return;
      const name = attr(field, 'name');
      const hint = add && name !== undefined ? `Give it one: \`bpmn ext add <file> ${add} name=${sh(name)} stringValue=<value>\` (replaces the field of that name; or ${sh('expression=${...}')}).` : `Give it a stringValue or an expression in the XML.`;
      this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `field:${name ?? `#${index}`}`, `${this.prefix}:field${name !== undefined ? ` "${name}"` : ''} of ${label} has ${fieldValue.problem}; the engines refuse the file (a field needs stringValue, expression, a ${this.prefix}:string or a ${this.prefix}:expression)`, hint);
    });
  }

  /** camunda:type="shell": a command field, fixed values only, true/false flags. */
  private checkShell(el: El, owner: El | undefined, label: string, add: string | undefined): void {
    const prefix = this.prefix;
    const fields = this.camundaExt(el, 'field');
    if (!fields.some((field) => attr(field, 'name') === 'command')) {
      this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'shell:command', `${label} is a shell task without a ${prefix}:field named command; the engines refuse the file`, add ? `\`bpmn ext add <file> ${add} name=command stringValue=<command>\`.` : 'Add a command field in the XML.');
    }
    for (const field of fields) {
      const name = attr(field, 'name') ?? '';
      const fieldValue = this.fieldValue(field);
      if ('problem' in fieldValue) continue;
      if (fieldValue.kind === 'expression') {
        this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, `shell:${name}`, `${prefix}:field "${name}" of shell task ${label} is an expression; the shell task takes fixed values only and the engines refuse the file`, add ? `\`bpmn ext add <file> ${add} name=${sh(name)} stringValue=<value>\`.` : 'Use a stringValue.');
      } else if (SHELL_FLAGS.includes(name) && !['true', 'false'].includes(fieldValue.value.toLowerCase())) {
        this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, `shell:${name}`, `${prefix}:field "${name}" of shell task ${label} is "${fieldValue.value}", not true or false; the engines refuse the file`, add ? `\`bpmn ext add <file> ${add} name=${name} stringValue=true\` (or false).` : 'Use true or false.');
      }
    }
  }

  private hasConnector(...hosts: Array<El | undefined>): boolean {
    return hosts.some((host) => !!host && this.camundaExt(host, 'connector').length > 0);
  }

  private validTtl(ttl: string): boolean {
    const match = /^\+?(\d+)$/.exec(ttl) ?? /^P(\d+)D$/.exec(ttl);
    return !!match && Number(match[1]) <= TTL_MAX;
  }

  checkProcess(proc: El): void {
    const id = idOf(proc) ?? '<processId>';
    const ttl = this.c7(proc, 'historyTimeToLive');
    const hint = `\`bpmn set <file> ${id} ${this.prefix}:historyTimeToLive=180\` (days, like Camunda Modeler; P180D works too).`;
    if (!nonEmpty(ttl)) {
      this.push('deploy', 'W_C7_DEPLOY_HISTORY_TTL', proc, undefined, 'ttl', `Executable process ${id} has no ${this.prefix}:historyTimeToLive; Camunda 7.20+, CIB seven and Operaton refuse to deploy it (ENGINE-12018)`, hint);
    } else if (!this.validTtl(ttl)) {
      this.push('deploy', 'W_C7_DEPLOY_HISTORY_TTL', proc, undefined, 'ttl', `${this.prefix}:historyTimeToLive="${ttl}" of process ${id} is not a number of days (or P<n>D); the engines refuse it`, hint);
    }
    this.checkPriorities(proc, undefined, ['jobPriority', 'taskPriority']);
  }

  /** jobPriority / taskPriority: a number or an expression, checked when the file is deployed. */
  checkPriorities(el: El, owner: El | undefined, names: string[]): void {
    const addr = this.addressOf(el, owner);
    for (const name of names) {
      const value = this.c7(el, name);
      if (value === undefined || this.isNumber(value) || this.isExpression(value)) continue;
      if (!this.kit.camunda.attr(name)?.owners.some((ownerType) => this.kit.is(el, ownerType))) continue;
      this.push('deploy', 'W_C7_DEPLOY_BAD_VALUE', el, owner, `attr:${name}`, `${this.prefix}:${name}="${value}" on ${this.describe(el, owner)} is not a number or expression; the engines refuse it`, addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${this.prefix}:${name}=50`)}\` (an integer or \${...}).` : 'Use an integer.');
    }
  }

  checkServiceLike(el: El): void {
    this.checkImplementation(el, undefined, this.describe(el, undefined), { decisionRef: this.kit.is(el, 'bpmn:BusinessRuleTask') });
  }

  /** Implementation of a task, or of the message definition of a message throw / end event. */
  checkImplementation(el: El, owner: El | undefined, label: string, opts: { decisionRef?: boolean; event?: El } = {}): void {
    const addr = this.addressOf(el, owner);
    const set = (kv: string): string => (addr ? `\`bpmn set <file> ${addr.id} ${kv.split(' ').map((assignment) => sh(`${addr.prefix}${assignment}`)).join(' ')}\`` : 'edit the XML');
    const type = this.c7(el, 'type');
    const topic = this.c7(el, 'topic');
    const external = type !== undefined && type.toLowerCase() === 'external';
    const shell = type !== undefined && type.toLowerCase() === 'shell';
    const prefix = this.prefix;
    // `ext add` type argument for one camunda:field of this element (keyed by name: replaces it)
    const fieldAdd = addr ? `${addr.id} ${sh(`${addr.prefix}${prefix}:field`)}` : undefined;
    if (type !== undefined && !external && !shell) {
      const mail = type.toLowerCase() === 'mail' ? ' (the standard engine distributions cannot load the mail task)' : '';
      this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'impl:type', `${prefix}:type="${type}" on ${label} is not supported (only "external" and "shell")${mail}; the engines refuse the file`, `Use an external task: ${set(`${prefix}:type=external ${prefix}:topic=<topic>`)}, or remove it: ${set(`${prefix}:type=`)}.`);
      return;
    }
    if (shell) this.checkShell(el, owner, label, fieldAdd);
    if (this.fieldsRead(el, { type })) this.checkFieldValues(el, owner, this.camundaExt(el, 'field'), label, fieldAdd);
    const impl =
      ['class', 'delegateExpression', 'expression'].some((attributeName) => nonEmpty(this.c7(el, attributeName))) ||
      external ||
      shell ||
      this.hasConnector(el, opts.event) ||
      (opts.decisionRef === true && this.c7(el, 'decisionRef') !== undefined);
    if (!impl) {
      if (opts.event) {
        const misplaced = ['class', 'delegateExpression', 'expression', 'type', 'topic'].some((attributeName) => this.c7(opts.event, attributeName) !== undefined);
        if (!misplaced) {
          this.push('runtime', 'W_C7_MESSAGE_NO_IMPLEMENTATION', el, owner, 'impl', `${label} has no implementation: it sends nothing and behaves like a none event at run time`, `Give it one: ${set(`${prefix}:type=external ${prefix}:topic=<topic>`)} (or ${prefix}:delegateExpression=\${...}).`);
        }
        return;
      }
      const hint = topic !== undefined ? `It has a ${prefix}:topic but no ${prefix}:type: ${set(`${prefix}:type=external`)}.` : `Give it one: ${set(`${prefix}:type=external ${prefix}:topic=<topic>`)} (or ${prefix}:delegateExpression=\${...}, ${prefix}:class=..., ${prefix}:expression=\${...}${opts.decisionRef ? `, ${prefix}:decisionRef=<decisionId>` : ''}).`;
      this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'impl', `${label} has no implementation (${prefix}:class, delegateExpression, expression, type=external${opts.decisionRef ? ', decisionRef' : ''} or a connector); the engines refuse the file`, hint);
      return;
    }
    if (external && topic === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_EXTERNAL_TOPIC', el, owner, 'topic', `${label} is an external task without ${prefix}:topic; the engines refuse the file`, `${set(`${prefix}:topic=<topic>`)}.`);
    } else if (external && topic === '') {
      this.push('runtime', 'W_C7_BAD_VALUE', el, owner, 'attr:topic', `${label} is an external task with an empty ${prefix}:topic; no worker can fetch it`, `${set(`${prefix}:topic=<topic>`)}.`);
    }
    if (this.c7(el, 'resultVariable') !== undefined && (nonEmpty(this.c7(el, 'class')) || nonEmpty(this.c7(el, 'delegateExpression')))) {
      this.push('deploy', 'W_C7_DEPLOY_RESULT_VARIABLE', el, owner, 'resultVariable', `${label} combines ${prefix}:resultVariable with ${nonEmpty(this.c7(el, 'class')) ? `${prefix}:class` : `${prefix}:delegateExpression`}; the engines support a result variable only with ${prefix}:expression and refuse the file`, `Remove it: ${set(`${prefix}:resultVariable=`)} (or switch to ${prefix}:expression=\${...}).`);
    }
    if (external) this.checkPriorities(el, owner, ['taskPriority']);
  }

  private checkBinding(el: El, binding: string, version: string, versionTag: string | undefined, allowed: string[]): void {
    const id = idOf(el)!;
    const prefix = this.prefix;
    const bindingValue = this.c7(el, binding);
    if (bindingValue === undefined) return;
    if (bindingValue === 'version' && this.c7(el, version) === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, binding, `${this.describe(el, undefined)} has ${prefix}:${binding}="version" but no ${prefix}:${version}; the engines refuse the file`, `\`bpmn set <file> ${id} ${prefix}:${version}=<n>\` (or \`${prefix}:${binding}=latest\`).`);
    } else if (bindingValue === 'versionTag' && versionTag && this.c7(el, versionTag) === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, binding, `${this.describe(el, undefined)} has ${prefix}:${binding}="versionTag" but no ${prefix}:${versionTag}; the engines refuse the file`, `\`bpmn set <file> ${id} ${prefix}:${versionTag}=<tag>\` (or \`${prefix}:${binding}=latest\`).`);
    } else if (!allowed.includes(bindingValue)) {
      this.push('runtime', 'W_C7_BAD_VALUE', el, undefined, `attr:${binding}`, `${prefix}:${binding}="${bindingValue}" on ${this.describe(el, undefined)} is not one of ${allowed.join(', ')}; the engines accept the file but cannot resolve the reference as intended`, `\`bpmn set <file> ${id} ${prefix}:${binding}=latest\`.`);
    }
  }

  checkCallActivity(el: El): void {
    const id = idOf(el)!;
    const prefix = this.prefix;
    const called = peek<string>(el, 'calledElement');
    const caseRef = this.c7(el, 'caseRef');
    if (called === undefined && caseRef === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement', `Call activity ${id} has no calledElement (nor ${prefix}:caseRef); the engines refuse the file`, `\`bpmn set <file> ${id} calledElement=<processId>\`.`);
    } else if (called !== undefined && caseRef !== undefined) {
      this.push('deploy', 'W_C7_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement+caseRef', `Call activity ${id} has both calledElement and ${prefix}:caseRef; the engines refuse the file`, `Keep one: \`bpmn set <file> ${id} ${prefix}:caseRef=\`.`);
    } else if (called === '') {
      this.push('runtime', 'W_C7_BAD_VALUE', el, undefined, 'attr:calledElement', `Call activity ${id} has an empty calledElement; it fails when it runs`, `\`bpmn set <file> ${id} calledElement=<processId>\`.`);
    }
    this.checkBinding(el, 'calledElementBinding', 'calledElementVersion', 'calledElementVersionTag', BINDINGS);
    this.checkBinding(el, 'caseBinding', 'caseVersion', undefined, CASE_BINDINGS);
  }

  checkBusinessRule(el: El): void {
    if (this.c7(el, 'decisionRef') === undefined) return;
    this.checkBinding(el, 'decisionRefBinding', 'decisionRefVersion', 'decisionRefVersionTag', BINDINGS);
    const map = this.c7(el, 'mapDecisionResult');
    if (map !== undefined && !DECISION_MAPPERS.includes(map)) {
      this.push('deploy', 'W_C7_DEPLOY_BAD_VALUE', el, undefined, 'attr:mapDecisionResult', `${this.prefix}:mapDecisionResult="${map}" on ${this.describe(el, undefined)} is not one of ${DECISION_MAPPERS.join(', ')}; the engines refuse the file`, `\`bpmn set <file> ${idOf(el)} ${this.prefix}:mapDecisionResult=singleEntry\` (or another of the four).`);
    }
  }

  checkForms(el: El): void {
    const id = idOf(el)!;
    const prefix = this.prefix;
    const formRef = this.c7(el, 'formRef');
    if (formRef === undefined) return;
    if (this.c7(el, 'formKey') !== undefined) {
      this.push('deploy', 'W_C7_DEPLOY_FORM', el, undefined, 'formKey+formRef', `${this.describe(el, undefined)} has both ${prefix}:formKey and ${prefix}:formRef; the engines refuse the file`, `Keep one: \`bpmn set <file> ${id} ${prefix}:formKey=\` (or ${prefix}:formRef=).`);
    }
    const binding = this.c7(el, 'formRefBinding');
    if (binding === undefined || !FORM_BINDINGS.includes(binding)) {
      this.push('deploy', 'W_C7_DEPLOY_FORM', el, undefined, 'formRefBinding', `${this.describe(el, undefined)} has ${prefix}:formRef but ${binding === undefined ? `no ${prefix}:formRefBinding` : `${prefix}:formRefBinding="${binding}"`} (one of ${FORM_BINDINGS.join(', ')} is required); the engines refuse the file`, `\`bpmn set <file> ${id} ${prefix}:formRefBinding=latest\`.`);
    } else if (binding === 'version' && this.c7(el, 'formRefVersion') === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, 'formRefBinding', `${this.describe(el, undefined)} has ${prefix}:formRefBinding="version" but no ${prefix}:formRefVersion; the engines refuse the file`, `\`bpmn set <file> ${id} ${prefix}:formRefVersion=<n>\` (or ${prefix}:formRefBinding=latest).`);
    }
  }

  checkMultiInstance(activity: El): void {
    const loop = peek<El>(activity, 'loopCharacteristics');
    if (!this.kit.is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
    const id = idOf(activity)!;
    const prefix = this.prefix;
    const card = peek<El>(loop, 'loopCardinality');
    const collection = this.c7(loop, 'collection');
    // the engines read loopDataInputRef as a variable name, which bpmn-moddle reports on import
    const dataInput = peek<unknown>(loop, 'loopDataInputRef') ?? this.doc.importWarnings.some((warning) => (warning as { element?: unknown }).element === loop && /loopDataInputRef/.test(String((warning as { property?: unknown }).property ?? '')));
    const elementVariable = this.c7(loop, 'elementVariable');
    if (!card && collection === undefined && !dataInput) {
      const misplaced = this.c7(activity, 'collection');
      const message = `Multi-instance ${this.describe(activity, undefined)} has neither a loop cardinality nor ${prefix}:collection${misplaced !== undefined ? ` (${prefix}:collection sits on the activity, not on the loop)` : ''}; the engines refuse the file`;
      const hint =
        misplaced !== undefined
          ? `Move it onto the loop: \`bpmn set <file> ${id} ${prefix}:collection= ${sh(`loop.${prefix}:collection=${misplaced}`)}${this.c7(activity, 'elementVariable') !== undefined ? ` ${prefix}:elementVariable= ${sh(`loop.${prefix}:elementVariable=${this.c7(activity, 'elementVariable')}`)}` : ''}\`.`
          : `\`bpmn set <file> ${id} ${sh(`loop.${prefix}:collection=\${items}`)} loop.${prefix}:elementVariable=item\` (or \`bpmn set <file> ${id} cardinality=3\`).`;
      this.push('deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi', message, hint);
      return;
    }
    if (card && !nonEmpty(peek<string>(card, 'body')) && collection === undefined && !dataInput) {
      this.push('deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:cardinality', `Multi-instance ${this.describe(activity, undefined)} has an empty loop cardinality; the engines refuse the file`, `\`bpmn set <file> ${id} cardinality=3\` (a number or \${...}).`);
    }
    if (elementVariable !== undefined && collection === undefined && !dataInput) {
      this.push('deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:elementVariable', `Multi-instance ${this.describe(activity, undefined)} has ${prefix}:elementVariable but no ${prefix}:collection; the engines refuse the file`, `\`bpmn set <file> ${id} ${sh(`loop.${prefix}:collection=\${items}`)}\` (or remove it: \`bpmn set <file> ${id} loop.${prefix}:elementVariable=\`).`);
    }
  }

  checkScriptTask(el: El): void {
    if (nonEmpty(peek<string>(el, 'script')) || this.c7(el, 'resource') !== undefined) return;
    this.push('deploy', 'W_C7_DEPLOY_SCRIPT', el, undefined, 'script', `Script task ${idOf(el)} has neither a script nor ${this.prefix}:resource; the engines refuse the file`, `\`bpmn set <file> ${idOf(el)} scriptFormat=groovy ${sh('script=...')}\` (or ${this.prefix}:resource=deployment://<file>).`);
  }

  checkUserTaskPriority(el: El): void {
    const priority = this.c7(el, 'priority');
    if (priority === undefined || this.isNumber(priority) || this.isExpression(priority)) return;
    this.push('runtime', 'W_C7_BAD_VALUE', el, undefined, 'attr:priority', `${this.prefix}:priority="${priority}" on ${this.describe(el, undefined)} is not a number or expression; creating the task fails`, `\`bpmn set <file> ${idOf(el)} ${this.prefix}:priority=50\`.`);
  }
}
