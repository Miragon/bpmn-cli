import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRules.js';

import { Shell } from '../Shell.js';
import { Values } from '../Values.js';
import { C7Diagram } from './C7Diagram.js';
import { CamundaAttributes } from './CamundaAttributes.js';
import { ImplementationHost } from './ImplementationHost.js';

const SHELL_FLAGS = ['wait', 'redirectError', 'cleanEnv'];
const IMPLEMENTATIONS = ['class', 'delegateExpression', 'expression', 'type'];

/**
 * Tasks and message throw events that do not tell Camunda 7 what to run, or tell it in a way it
 * cannot run.
 * Camunda 7 refuses to deploy most of them; a message throw event without implementation deploys
 * and sends nothing.
 *
 * - `c7-implementation`: a service, send or business rule task without class, expression, delegate
 *   expression, external type, decision or connector; a camunda:type other than external or shell;
 *   a shell task without command field, with a flag other than true or false, or with a field given
 *   as expression.
 * - `c7-message-implementation`: a message throw or end event without implementation.
 * - `c7-external-topic`: an external task without topic.
 * - `c7-result-variable`: a result variable next to a class or delegate expression.
 * - `c7-script`: a script task with neither script nor resource.
 *
 * @example a service task without implementation
 * <bpmn:serviceTask id="Charge" />  <!-- no camunda:class, expression or type -->
 */
class C7Implementation extends C7Rule {
  protected visit(node: ModdleElement): boolean {
    if (is(node, 'bpmn:Process') && node.get('isExecutable') !== true) return false;
    for (const host of ImplementationHost.forElement(node)) this.checkHost(node, host);
    if (is(node, 'bpmn:ScriptTask')) this.checkScript(node);
    return !is(node, 'bpmn:AdHocSubProcess');
  }

  private checkHost(node: ModdleElement, host: ImplementationHost): void {
    const { prefix, command, label } = host;
    if (host.type !== undefined && !host.isExternal && !host.isShell) {
      const mail = host.type!.toLowerCase() === 'mail' ? ' (the standard engine distributions cannot load the mail task)' : '';
      this.report('c7-implementation', node, `${prefix}:type="${host.type}" on ${label} is not supported (only "external" and "shell")${mail}; the engines refuse the file`, { path: host.pathTo('type'), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: host.element, property: 'type', hint: `Use an external task: ${command.of(`${prefix}:type=external`, `${prefix}:topic=<topic>`)}, or remove it: ${command.of(`${prefix}:type=`)}.` });
      return;
    }
    if (host.isShell) this.checkShell(node, host);
    if (!host.hasImplementation && !host.isEvent) {
      const decision = host.readsDecisionRef ? `, ${prefix}:decisionRef=<decisionId>` : '';
      const hint = host.attributes.defined('topic') !== undefined ? `It has a ${prefix}:topic but no ${prefix}:type: ${command.of(`${prefix}:type=external`)}.` : `Give it one: ${command.of(`${prefix}:type=external`, `${prefix}:topic=<topic>`)} (or ${prefix}:delegateExpression=\${...}, ${prefix}:class=..., ${prefix}:expression=\${...}${decision}).`;
      this.report('c7-implementation', node, `${label} has no implementation (${prefix}:class, delegateExpression, expression, type=external${host.readsDecisionRef ? ', decisionRef' : ''} or a connector); the engines refuse the file`, { path: host.pathTo('type'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: host.element, requiredProperty: host.readsDecisionRef ? [...IMPLEMENTATIONS, 'decisionRef'] : IMPLEMENTATIONS, hint });
    }
    if (host.isEvent && !host.hasImplementation && !this.hasMisplacedImplementation(node)) this.report('c7-message-implementation', node, `${label} has no implementation: it sends nothing and behaves like a none event at run time`, { path: host.pathTo('type'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: host.element, requiredProperty: IMPLEMENTATIONS, hint: `Give it one: ${command.of(`${prefix}:type=external`, `${prefix}:topic=<topic>`)} (or ${prefix}:delegateExpression=\${...}).` });
    const topic = host.attributes.defined('topic');
    if (host.isExternal && topic === undefined) this.report('c7-external-topic', node, `${label} is an external task without ${prefix}:topic; the engines refuse the file`, { path: host.pathTo('topic'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: host.element, requiredProperty: 'topic', hint: `${command.of(`${prefix}:topic=<topic>`)}.` });
    const delegate = ['class', 'delegateExpression'].find((local) => Values.nonEmpty(host.attributes.defined(local)));
    if (delegate && host.attributes.defined('resultVariable') !== undefined) this.report('c7-result-variable', node, `${label} combines ${prefix}:resultVariable with ${prefix}:${delegate}; the engines support a result variable only with ${prefix}:expression and refuse the file`, { path: host.pathTo('resultVariable'), type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: host.element, property: 'resultVariable', hint: `Remove it: ${command.of(`${prefix}:resultVariable=`)} (or switch to ${prefix}:expression=\${...}).` });
  }

  /** An implementation on the event instead of its message definition, which the misplaced attribute finding reports. */
  private hasMisplacedImplementation(event: ModdleElement): boolean {
    const attributes = new CamundaAttributes(event);
    return [...IMPLEMENTATIONS, 'topic'].some((local) => attributes.any(local) !== undefined);
  }

  /** `bpmn ext add` of a camunda:field, which replaces the field of that name; `otherwise` without an id to address. */
  private fieldHint(host: ImplementationHost, args: string, otherwise: string, after = '.'): string {
    const target = host.command.extTarget(`${host.prefix}:field`);
    return target ? `\`bpmn ext add <file> ${target} ${args}\`${after}` : otherwise;
  }

  /** A shell task needs a command field and fixed values, true or false for its flags; a field with no value, or with both a string attribute and element, is the extension finding's. */
  private checkShell(node: ModdleElement, host: ImplementationHost): void {
    const fields = host.fields();
    if (!fields.some(({ field }) => field.get('name') === 'command')) this.report('c7-implementation', node, `${host.label} is a shell task without a ${host.prefix}:field named command; the engines refuse the file`, { path: host.pathTo('extensionElements'), type: ERROR_TYPES.EXTENSION_ELEMENT_REQUIRED, node: host.element, requiredExtensionElement: 'camunda:Field', hint: this.fieldHint(host, 'name=command stringValue=<command>', 'Add a command field in the XML.') });
    for (const { field, index } of fields) {
      const name = field.get('name') ?? '';
      const fieldPath = host.pathTo('extensionElements', 'values', index);
      const stringValue: string | undefined = field.get('stringValue');
      const string: string | undefined = field.get('string');
      if (stringValue !== undefined && string !== undefined) continue;
      const fixed = string ?? (stringValue ? stringValue : undefined);
      const property = string !== undefined ? 'string' : 'stringValue';
      if (fixed !== undefined && SHELL_FLAGS.includes(name) && !['true', 'false'].includes(fixed.toLowerCase())) this.report('c7-implementation', node, `${host.prefix}:field "${name}" of shell task ${host.label} is "${fixed}", not true or false; the engines refuse the file`, { path: [...fieldPath, property], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: field, property, hint: this.fieldHint(host, `name=${name} stringValue=true`, 'Use true or false.', ' (or false).') });
      if (fixed === undefined && field.get('expression') !== undefined) this.report('c7-implementation', node, `${host.prefix}:field "${name}" of shell task ${host.label} is an expression; the shell task takes fixed values only and the engines refuse the file`, { path: [...fieldPath, 'expression'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: field, property: 'expression', hint: this.fieldHint(host, `name=${Shell.quote(name)} stringValue=<value>`, 'Use a stringValue.') });
    }
  }

  private checkScript(node: ModdleElement): void {
    if (Values.nonEmpty(node.get('script')) || new CamundaAttributes(node).defined('resource') !== undefined) return;
    const prefix = C7Diagram.of(node).prefix;
    this.report('c7-script', node, `Script task ${node.id} has neither a script nor ${prefix}:resource; the engines refuse the file`, { path: ['script'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: ['script', 'resource'], hint: `\`bpmn set <file> ${node.id} scriptFormat=groovy script=...\` (or ${prefix}:resource=deployment://<file>).` });
  }
}

export default defineRule(
  {
    ruleName: 'c7-implementation',
    kind: 'engine-specific',
    targetEngine: 'c7',
    findings: {
      'c7-implementation': ['W_C7_DEPLOY_IMPLEMENTATION', 'deploy'],
      'c7-message-implementation': ['W_C7_MESSAGE_NO_IMPLEMENTATION', 'runtime'],
      'c7-external-topic': ['W_C7_DEPLOY_EXTERNAL_TOPIC', 'deploy'],
      'c7-result-variable': ['W_C7_DEPLOY_RESULT_VARIABLE', 'deploy'],
      'c7-script': ['W_C7_DEPLOY_SCRIPT', 'deploy'],
    },
  },
  C7Implementation,
);
