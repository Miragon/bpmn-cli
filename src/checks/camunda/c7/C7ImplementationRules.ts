import { type BpmnElement, CAMUNDA } from '../../../model/index.js';
import { C7Rules } from './C7Rules.js';
import type { ElementAddress } from '../rules/ElementAddress.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

type FieldValue = { kind: 'string' | 'expression'; value: string } | { problem: string };
type ImplementationSite = { el: BpmnElement; owner: BpmnElement | undefined; label: string; reporter: RuleReporter; set: (kv: string) => string };

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
    const fields = this.camundaExt(el, 'field');
    if (!fields.some((field) => this.attr(field, 'name') === 'command')) {
      reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: 'shell:command', message: `${label} is a shell task without a ${this.prefix}:field named command; the engines refuse the file`, hint: add ? `\`bpmn ext add <file> ${add} name=command stringValue=<command>\`.` : 'Add a command field in the XML.' });
    }
    for (const field of fields) {
      this.checkShellField(el, owner, field, label, add, reporter);
    }
  }

  private checkShellField(el: BpmnElement, owner: BpmnElement | undefined, field: BpmnElement, label: string, add: string | undefined, reporter: RuleReporter): void {
    const name = this.attr(field, 'name') ?? '';
    const fieldValue = this.fieldValue(field);
    if ('problem' in fieldValue) {
      return;
    }
    if (fieldValue.kind === 'expression') {
      reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: `shell:${name}`, message: `${this.prefix}:field "${name}" of shell task ${label} is an expression; the shell task takes fixed values only and the engines refuse the file`, hint: add ? `\`bpmn ext add <file> ${add} name=${ShellWords.quote(name)} stringValue=<value>\`.` : 'Use a stringValue.' });
    } else if (C7ImplementationRules.SHELL_FLAGS.includes(name) && !['true', 'false'].includes(fieldValue.value.toLowerCase())) {
      reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: `shell:${name}`, message: `${this.prefix}:field "${name}" of shell task ${label} is "${fieldValue.value}", not true or false; the engines refuse the file`, hint: add ? `\`bpmn ext add <file> ${add} name=${name} stringValue=true\` (or false).` : 'Use true or false.' });
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

  private checkServiceLike(el: BpmnElement, reporter: RuleReporter): void {
    this.checkImplementation(el, undefined, this.describe(el, undefined), reporter, { decisionRef: el.is('bpmn:BusinessRuleTask') });
  }

  private static setCommand(addr: ElementAddress | undefined, kv: string): string {
    return addr ? `\`bpmn set <file> ${addr.id} ${kv.split(' ').map((assignment) => ShellWords.quote(`${addr.prefix}${assignment}`)).join(' ')}\`` : 'edit the XML';
  }

  checkImplementation(el: BpmnElement, owner: BpmnElement | undefined, label: string, reporter: RuleReporter, opts: { decisionRef?: boolean; event?: BpmnElement } = {}): void {
    const addr = this.addressOf(el, owner);
    const set = (kv: string): string => C7ImplementationRules.setCommand(addr, kv);
    const site = { el, owner, label, reporter, set };
    const type = this.c7(el, 'type');
    const topic = this.c7(el, 'topic');
    const external = type !== undefined && type.toLowerCase() === 'external';
    const shell = type !== undefined && type.toLowerCase() === 'shell';
    const fieldAdd = addr?.slot(`${this.prefix}:field`);
    if (type !== undefined && !external && !shell) {
      this.reportUnsupportedType(site, type);
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
      this.reportNoImplementation(site, topic, opts);
      return;
    }
    if (external && topic === undefined) {
      reporter.deploy({ code: 'W_C7_DEPLOY_EXTERNAL_TOPIC', element: el, owner, subject: 'topic', message: `${label} is an external task without ${this.prefix}:topic; the engines refuse the file`, hint: `${set(`${this.prefix}:topic=<topic>`)}.` });
    } else if (external && topic === '') {
      reporter.runtime({ code: 'W_C7_BAD_VALUE', element: el, owner, subject: 'attr:topic', message: `${label} is an external task with an empty ${this.prefix}:topic; no worker can fetch it`, hint: `${set(`${this.prefix}:topic=<topic>`)}.` });
    }
    this.checkResultVariable(site);
    if (external) {
      this.checkPriorities(el, owner, ['taskPriority'], reporter);
    }
  }

  private reportNoImplementation({ el, owner, label, reporter, set }: ImplementationSite, topic: string | undefined, opts: { decisionRef?: boolean; event?: BpmnElement }): void {
    if (opts.event) {
      const misplaced = ['class', 'delegateExpression', 'expression', 'type', 'topic'].some((attributeName) => this.c7(opts.event, attributeName) !== undefined);
      if (!misplaced) {
        reporter.runtime({ code: 'W_C7_MESSAGE_NO_IMPLEMENTATION', element: el, owner, subject: 'impl', message: `${label} has no implementation: it sends nothing and behaves like a none event at run time`, hint: `Give it one: ${set(`${this.prefix}:type=external ${this.prefix}:topic=<topic>`)} (or ${this.prefix}:delegateExpression=\${...}).` });
      }
      return;
    }
    const hint = topic !== undefined ? `It has a ${this.prefix}:topic but no ${this.prefix}:type: ${set(`${this.prefix}:type=external`)}.` : `Give it one: ${set(`${this.prefix}:type=external ${this.prefix}:topic=<topic>`)} (or ${this.prefix}:delegateExpression=\${...}, ${this.prefix}:class=..., ${this.prefix}:expression=\${...}${opts.decisionRef ? `, ${this.prefix}:decisionRef=<decisionId>` : ''}).`;
    reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: 'impl', message: `${label} has no implementation (${this.prefix}:class, delegateExpression, expression, type=external${opts.decisionRef ? ', decisionRef' : ''} or a connector); the engines refuse the file`, hint });
  }

  private reportUnsupportedType({ el, owner, label, reporter, set }: ImplementationSite, type: string): void {
    const mail = type.toLowerCase() === 'mail' ? ' (the standard engine distributions cannot load the mail task)' : '';
    reporter.deploy({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: el, owner, subject: 'impl:type', message: `${this.prefix}:type="${type}" on ${label} is not supported (only "external" and "shell")${mail}; the engines refuse the file`, hint: `Use an external task: ${set(`${this.prefix}:type=external ${this.prefix}:topic=<topic>`)}, or remove it: ${this.unsetCommand(el, owner, `${this.prefix}:type`)}.` });
  }

  private checkResultVariable({ el, owner, label, reporter }: ImplementationSite): void {
    if (this.c7(el, 'resultVariable') !== undefined && (this.nonEmpty(this.c7(el, 'class')) || this.nonEmpty(this.c7(el, 'delegateExpression')))) {
      reporter.deploy({ code: 'W_C7_DEPLOY_RESULT_VARIABLE', element: el, owner, subject: 'resultVariable', message: `${label} combines ${this.prefix}:resultVariable with ${this.nonEmpty(this.c7(el, 'class')) ? `${this.prefix}:class` : `${this.prefix}:delegateExpression`}; the engines support a result variable only with ${this.prefix}:expression and refuse the file`, hint: `Remove it: ${this.unsetCommand(el, owner, `${this.prefix}:resultVariable`)} (or switch to ${this.prefix}:expression=\${...}).` });
    }
  }
}
