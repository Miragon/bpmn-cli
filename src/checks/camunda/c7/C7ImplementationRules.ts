import { type BpmnElement, CAMUNDA } from '../../../model/index.js';
import { C7Rules } from './C7Rules.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

type FieldValue = { kind: 'string' | 'expression'; value: string } | { problem: string };

export class C7ImplementationRules extends C7Rules {
  private static readonly SHELL_FLAGS = ['wait', 'redirectError', 'cleanEnv'];

  check(element: BpmnElement, reporter: RuleReporter): void {
    if (!reporter.executable) {
      return;
    }
    if (C7Rules.SERVICE_LIKE.some((type) => element.is(type))) {
      this.checkServiceLike(element, reporter);
    }
    if (element.is('bpmn:Activity') || element.is('bpmn:Gateway') || element.is('bpmn:Event') || element.is('bpmn:MultiInstanceLoopCharacteristics')) {
      this.checkPriorities(element, reporter.owner, ['jobPriority'], reporter);
    }
  }

  private fieldValue(field: BpmnElement): FieldValue {
    const pick = (attrName: string, child: string): { value?: string; problem?: string } => {
      const attributeValue = this.attr(field, attrName);
      const kids = this.children(field, child);
      if (attributeValue !== undefined && kids.length) {
        return { problem: `both the attribute ${attrName} and a ${this.prefix}:${child} element` };
      }
      if (kids.length) {
        const text = kids[0]?.peek<unknown>('$body');
        return { value: typeof text === 'string' ? text : '' };
      }
      return attributeValue !== undefined && attributeValue.length > 0 ? { value: attributeValue } : {};
    };
    const stringValue = pick('stringValue', 'string');
    if (stringValue.problem) {
      return { problem: stringValue.problem };
    }
    if (stringValue.value !== undefined) {
      return { kind: 'string', value: stringValue.value };
    }
    const expression = pick('expression', 'expression');
    if (expression.problem) {
      return { problem: expression.problem };
    }
    if (expression.value !== undefined) {
      return { kind: 'expression', value: expression.value };
    }
    return { problem: 'no value' };
  }

  fieldsRead(el: BpmnElement, opts: { type?: string } = {}): boolean {
    if (opts.type !== undefined) {
      return opts.type.toLowerCase() === 'shell';
    }
    const get = (attributeName: string): string | undefined => (el.isGeneric ? this.attr(el, attributeName) : this.c7(el, attributeName));
    if (this.nonEmpty(get('class'))) {
      return true;
    }
    return get('expression') === undefined && this.nonEmpty(get('delegateExpression'));
  }

  checkFieldValues(host: BpmnElement, owner: BpmnElement | undefined, fields: BpmnElement[], label: string, add: string | undefined, reporter: RuleReporter): void {
    fields.forEach((field, index) => {
      const fieldValue = this.fieldValue(field);
      if (!('problem' in fieldValue)) {
        return;
      }
      const name = this.attr(field, 'name');
      const hint = add && name !== undefined ? `Give it one: \`bpmn ext add <file> ${add} name=${ShellWords.quote(name)} stringValue=<value>\` (replaces the field of that name; or ${ShellWords.quote('expression=${...}')}).` : `Give it a stringValue or an expression in the XML.`;
      reporter.deploy({ code: 'W_C7_DEPLOY_EXTENSION', element: host, owner, subject: `field:${name ?? `#${index}`}`, message: `${this.prefix}:field${name !== undefined ? ` "${name}"` : ''} of ${label} has ${fieldValue.problem}; the engines refuse the file (a field needs stringValue, expression, a ${this.prefix}:string or a ${this.prefix}:expression)`, hint });
    });
  }

  private checkShell(el: BpmnElement, owner: BpmnElement | undefined, label: string, add: string | undefined, reporter: RuleReporter): void {
    const prefix = this.prefix;
    const fields = this.camundaExt(el, 'field');
    if (!fields.some((field) => this.attr(field, 'name') === 'command')) {
      reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: 'shell:command', message: `${label} is a shell task without a ${prefix}:field named command; the engines refuse the file`, hint: add ? `\`bpmn ext add <file> ${add} name=command stringValue=<command>\`.` : 'Add a command field in the XML.' });
    }
    for (const field of fields) {
      const name = this.attr(field, 'name') ?? '';
      const fieldValue = this.fieldValue(field);
      if ('problem' in fieldValue) {
        continue;
      }
      if (fieldValue.kind === 'expression') {
        reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: `shell:${name}`, message: `${prefix}:field "${name}" of shell task ${label} is an expression; the shell task takes fixed values only and the engines refuse the file`, hint: add ? `\`bpmn ext add <file> ${add} name=${ShellWords.quote(name)} stringValue=<value>\`.` : 'Use a stringValue.' });
      } else if (C7ImplementationRules.SHELL_FLAGS.includes(name) && !['true', 'false'].includes(fieldValue.value.toLowerCase())) {
        reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: `shell:${name}`, message: `${prefix}:field "${name}" of shell task ${label} is "${fieldValue.value}", not true or false; the engines refuse the file`, hint: add ? `\`bpmn ext add <file> ${add} name=${name} stringValue=true\` (or false).` : 'Use true or false.' });
      }
    }
  }

  private hasConnector(...hosts: Array<BpmnElement | undefined>): boolean {
    return hosts.some((host) => !!host && this.camundaExt(host, 'connector').length > 0);
  }

  checkPriorities(el: BpmnElement, owner: BpmnElement | undefined, names: string[], reporter: RuleReporter): void {
    const addr = this.addressOf(el, owner);
    for (const name of names) {
      const value = this.c7(el, name);
      if (value === undefined || this.isNumber(value) || this.isExpression(value)) {
        continue;
      }
      if (!CAMUNDA.attr(name)?.owners.some((ownerType) => el.is(ownerType))) {
        continue;
      }
      reporter.deploy({ code: 'W_C7_DEPLOY_BAD_VALUE', element: el, owner, subject: `attr:${name}`, message: `${this.prefix}:${name}="${value}" on ${this.describe(el, owner)} is not a number or expression; the engines refuse it`, hint: addr ? `\`bpmn set <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${this.prefix}:${name}=50`)}\` (an integer or \${...}).` : 'Use an integer.' });
    }
  }

  checkServiceLike(el: BpmnElement, reporter: RuleReporter): void {
    this.checkImplementation(el, undefined, this.describe(el, undefined), reporter, { decisionRef: el.is('bpmn:BusinessRuleTask') });
  }

  checkImplementation(el: BpmnElement, owner: BpmnElement | undefined, label: string, reporter: RuleReporter, opts: { decisionRef?: boolean; event?: BpmnElement } = {}): void {
    const addr = this.addressOf(el, owner);
    const set = (kv: string): string => (addr ? `\`bpmn set <file> ${addr.id} ${kv.split(' ').map((assignment) => ShellWords.quote(`${addr.prefix}${assignment}`)).join(' ')}\`` : 'edit the XML');
    const type = this.c7(el, 'type');
    const topic = this.c7(el, 'topic');
    const external = type !== undefined && type.toLowerCase() === 'external';
    const shell = type !== undefined && type.toLowerCase() === 'shell';
    const prefix = this.prefix;
    const fieldAdd = addr ? `${addr.id} ${ShellWords.quote(`${addr.prefix}${prefix}:field`)}` : undefined;
    if (type !== undefined && !external && !shell) {
      const mail = type.toLowerCase() === 'mail' ? ' (the standard engine distributions cannot load the mail task)' : '';
      reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: 'impl:type', message: `${prefix}:type="${type}" on ${label} is not supported (only "external" and "shell")${mail}; the engines refuse the file`, hint: `Use an external task: ${set(`${prefix}:type=external ${prefix}:topic=<topic>`)}, or remove it: ${set(`${prefix}:type=`)}.` });
      return;
    }
    if (shell) {
      this.checkShell(el, owner, label, fieldAdd, reporter);
    }
    if (this.fieldsRead(el, { type })) {
      this.checkFieldValues(el, owner, this.camundaExt(el, 'field'), label, fieldAdd, reporter);
    }
    const impl =
      ['class', 'delegateExpression', 'expression'].some((attributeName) => this.nonEmpty(this.c7(el, attributeName))) ||
      external ||
      shell ||
      this.hasConnector(el, opts.event) ||
      (opts.decisionRef === true && this.c7(el, 'decisionRef') !== undefined);
    if (!impl) {
      if (opts.event) {
        const misplaced = ['class', 'delegateExpression', 'expression', 'type', 'topic'].some((attributeName) => this.c7(opts.event, attributeName) !== undefined);
        if (!misplaced) {
          reporter.runtime({ code: 'W_C7_MESSAGE_NO_IMPLEMENTATION', element: el, owner, subject: 'impl', message: `${label} has no implementation: it sends nothing and behaves like a none event at run time`, hint: `Give it one: ${set(`${prefix}:type=external ${prefix}:topic=<topic>`)} (or ${prefix}:delegateExpression=\${...}).` });
        }
        return;
      }
      const hint = topic !== undefined ? `It has a ${prefix}:topic but no ${prefix}:type: ${set(`${prefix}:type=external`)}.` : `Give it one: ${set(`${prefix}:type=external ${prefix}:topic=<topic>`)} (or ${prefix}:delegateExpression=\${...}, ${prefix}:class=..., ${prefix}:expression=\${...}${opts.decisionRef ? `, ${prefix}:decisionRef=<decisionId>` : ''}).`;
      reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: 'impl', message: `${label} has no implementation (${prefix}:class, delegateExpression, expression, type=external${opts.decisionRef ? ', decisionRef' : ''} or a connector); the engines refuse the file`, hint });
      return;
    }
    if (external && topic === undefined) {
      reporter.deploy({ code: 'W_C7_DEPLOY_EXTERNAL_TOPIC', element: el, owner, subject: 'topic', message: `${label} is an external task without ${prefix}:topic; the engines refuse the file`, hint: `${set(`${prefix}:topic=<topic>`)}.` });
    } else if (external && topic === '') {
      reporter.runtime({ code: 'W_C7_BAD_VALUE', element: el, owner, subject: 'attr:topic', message: `${label} is an external task with an empty ${prefix}:topic; no worker can fetch it`, hint: `${set(`${prefix}:topic=<topic>`)}.` });
    }
    if (this.c7(el, 'resultVariable') !== undefined && (this.nonEmpty(this.c7(el, 'class')) || this.nonEmpty(this.c7(el, 'delegateExpression')))) {
      reporter.deploy({ code: 'W_C7_DEPLOY_RESULT_VARIABLE', element: el, owner, subject: 'resultVariable', message: `${label} combines ${prefix}:resultVariable with ${this.nonEmpty(this.c7(el, 'class')) ? `${prefix}:class` : `${prefix}:delegateExpression`}; the engines support a result variable only with ${prefix}:expression and refuse the file`, hint: `Remove it: ${set(`${prefix}:resultVariable=`)} (or switch to ${prefix}:expression=\${...}).` });
    }
    if (external) {
      this.checkPriorities(el, owner, ['taskPriority'], reporter);
    }
  }
}
