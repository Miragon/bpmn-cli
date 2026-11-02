import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { RuleKit } from '../RuleKit.js';
import { VendorElementsRule } from '../VendorElementsRule.js';

/**
 * A known zeebe extension element the typed parse drops where it sits: one that belongs inside a
 * container (a loose zeebe:input), or zeebe:publishMessage on an element Camunda 8 does not read it
 * on (an end event instead of its message event definition).
 * Camunda 8 ignores it. The typed parse drops it with an import warning that names neither the
 * element nor where it sat, so the rule reads the extension elements as the file writes them.
 *
 * @example a loose input mapping
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><zeebe:input source="=amount" target="amount" /></bpmn:extensionElements>  <!-- inside zeebe:ioMapping -->
 * </bpmn:serviceTask>
 */
class C8ZeebeElementPlacementRule extends VendorElementsRule {
  protected readonly engine: Engine = 'c8';

  protected checkValue(host: ModdleElement, value: ModdleElement, index: number): void {
    const local = this.localName(value.$type);
    const { ZEEBE } = RuleKit.kit;
    const type = ZEEBE.type(local);
    if (!type || !this.isMisplaced(host, local)) return;
    const id: string | undefined = host.id;
    const remove = id ? `\`bpmn ext remove <file> ${id} ${index}\`` : 'remove it from the XML';
    const name = `${this.prefix}:${local}`;
    if (ZEEBE.nestedOnly(local)) {
      const container = ZEEBE.containersOf(local)[0]!;
      const add = id ? `: \`bpmn ext add <file> ${id} ${name} ...\`` : '';
      return this.reportMisplaced(host, local, `${name} sits directly in the extension elements of ${this.where(host)}, but belongs inside ${this.prefix}:${this.localName(container)}; Camunda 8 ignores it`, `Remove it (${remove}) and add it again, \`bpmn ext add\` files it into its container${add}.`);
    }
    const hosts = type.allowedIn.filter((allowed) => allowed.startsWith('bpmn:')).map((allowed) => `${allowed.charAt(5).toLowerCase()}${allowed.slice(6)}`);
    this.reportMisplaced(host, local, `${name} on ${this.where(host)} has no effect: Camunda 8 reads it on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')} only`, `Remove it: ${remove}.`);
  }

  private reportMisplaced(host: ModdleElement, local: string, message: string, hint: string): void {
    this.report(this.node, message, { path: null, type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, writtenAt: this.model.position(host), subject: `ext:${local}`, hint });
  }
}

export default defineRule({ ruleName: 'c8-zeebe-element-placement', code: 'W_C8_MISPLACED_EXTENSION', impact: 'runtime' }, C8ZeebeElementPlacementRule);
