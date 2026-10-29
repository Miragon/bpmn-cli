import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { VendorElementsRule } from '../VendorElementsRule.js';

/**
 * A camunda:inputParameter or outputParameter directly in the extension elements, outside the
 * camunda:inputOutput it belongs in.
 * The engines ignore it. The typed parse drops it with an import warning that names neither the
 * element nor where it sat, so the rule reads the extension elements as the file writes them.
 *
 * @example a loose input parameter
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><camunda:inputParameter name="amount">10</camunda:inputParameter></bpmn:extensionElements>  <!-- inside camunda:inputOutput -->
 * </bpmn:serviceTask>
 */
class C7IoParameterInInputOutputRule extends VendorElementsRule {
  protected readonly engine: Engine = 'c7';

  protected checkValue(host: ModdleElement, parameter: ModdleElement, index: number): void {
    const local = this.localName(parameter.$type);
    if (!this.vendor.type(local) || !this.isMisplaced(host, local)) return;
    const { id, slot } = this.address(host);
    const name: string | undefined = parameter.name ?? parameter.$attrs?.name;
    const body: string | undefined = parameter.$body;
    const add = id ? `: \`bpmn ext add <file> ${id} ${slot}camunda:${local}${name ? ` name=${name}` : ''}${body ? ` --body ${body}` : ''}\`` : '';
    const remove = id ? `\`bpmn ext remove <file> ${id} ${slot}${index}\`` : 'remove it from the XML';
    const reported = slot ? this.model.typed(host.$parent) : this.node;
    this.report(reported, `${this.prefix}:${local} sits directly in the extension elements of ${this.where(host)}, but belongs inside ${this.prefix}:inputOutput; the engines ignore it`, { path: null, type: ERROR_TYPES.CHILD_ELEMENT_TYPE_NOT_ALLOWED, writtenAt: this.model.position(host), subject: `ext:${local}`, hint: `Remove it (${remove}) and add it again, \`bpmn ext add\` files it into its container${add}.` });
  }
}

export default defineRule({ ruleName: 'c7-io-parameter-in-input-output', code: 'W_C7_MISPLACED_EXTENSION', impact: 'runtime' }, C7IoParameterInInputOutputRule);
