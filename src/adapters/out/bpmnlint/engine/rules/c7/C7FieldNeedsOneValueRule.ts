import { is, isAny } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement, type ReportPath } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { Shell } from '../support/Shell.js';
import { Values } from '../support/Values.js';
import { C7ExtensionContentRule } from './C7ExtensionContentRule.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';
import type { C7Host, HostExtension } from './support/C7Host.js';

const SERVICE_LIKE = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask'];

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
 * A camunda:field the engines read without value, or with both the attribute stringValue and a
 * camunda:string element: a field of a listener, or of a task or message throw event
 * implementation, that a class or a delegate expression reads.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a field without value
 * <camunda:executionListener class="org.acme.Audit" event="start">
 *   <camunda:field name="level" />  <!-- stringValue="info" -->
 * </camunda:executionListener>
 */
class C7FieldNeedsOneValueRule extends C7ExtensionContentRule {
  protected checkHost(host: C7Host, read: HostExtension[]): void {
    for (const extension of read) {
      this.checkListenerFields(host, extension);
    }
    const { node, owner } = host;
    if (SERVICE_LIKE.some((type) => is(node, type))) {
      this.checkImplementationFields(host, host.describe());
    }
    if (is(node, 'bpmn:MessageEventDefinition') && owner && isAny(owner, ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent']) && new C7EventDefinitions(owner).actedOn().includes(node)) {
      this.checkImplementationFields(host, ElementKinds.describe(owner));
    }
  }

  private checkListenerFields(host: C7Host, extension: HostExtension): void {
    const { value, index, local } = extension;
    if ((local !== 'executionListener' && local !== 'taskListener') || !this.readsFields(value)) {
      return;
    }
    const event: string | undefined = value.get('event');
    const fieldOf = host.address ? `${host.address.id} ${Shell.quote(`${host.address.slot}${host.selector(extension)}/${host.typeName('field')}`)}` : undefined;
    this.checkFields(host, value.get('fields'), { label: `${host.typeName(local)}${event ? ` (event ${event})` : ''} of ${host.describe()}`, path: host.extensionPath(index, 'fields'), fieldOf });
  }

  /** The camunda:field elements of a task or a message throw event definition, where its implementation reads them. */
  private checkImplementationFields(host: C7Host, label: string): void {
    const type: string | undefined = host.node.get('camunda:type');
    const shell = type?.toLowerCase() === 'shell';
    if (type !== undefined ? !shell : !this.readsFields(host.node, 'camunda:')) {
      return;
    }
    const fieldOf = host.address ? `${host.address.id} ${Shell.quote(`${host.address.slot}${host.typeName('field')}`)}` : undefined;
    for (const { value, index } of host.camundaExtensions('field')) {
      this.checkFields(host, [value], { label, path: host.extensionPath(index), fieldOf, indexed: false });
    }
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
      const hint = fieldOf && name !== undefined ? `Give it one: \`bpmn ext add <file> ${fieldOf} name=${Shell.quote(name)} stringValue=<value>\` (replaces the field of that name; or ${Shell.quote('expression=${...}')}).` : 'Give it a stringValue or an expression in the XML.';
      const kind = problem === 'no value' ? { path: fieldPath, type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: ['stringValue', 'expression', 'string'] } : { path: [...fieldPath, 'string'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'string' };
      this.reportOn(host, `${host.typeName('field')}${name !== undefined ? ` "${name}"` : ''} of ${label} has ${problem}; the engines refuse the file (a field needs stringValue, expression, a ${host.typeName('string')} or a ${host.typeName('expression')})`, { node: field, hint, ...kind });
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
    if (stringValue !== undefined && stringElement !== undefined) {
      return 'both the attribute stringValue and a camunda:string element';
    }
    return stringElement !== undefined || (stringValue !== undefined && stringValue.length > 0) || field.get('expression') !== undefined ? undefined : 'no value';
  }
}

export default defineRule({ ruleName: 'c7-field-needs-one-value', code: 'W_C7_DEPLOY_EXTENSION', impact: 'deploy' }, C7FieldNeedsOneValueRule);
