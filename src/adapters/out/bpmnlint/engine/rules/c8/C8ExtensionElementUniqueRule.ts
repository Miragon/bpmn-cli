import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { RuleKit } from '../RuleKit.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host, ZeebeValue } from './support/C8Host.js';

/**
 * Two or more of a zeebe extension element Camunda 8 reads once per element, reported on the
 * second.
 * Camunda 8 reads one and refuses the file.
 *
 * @example two task definitions
 * <zeebe:taskDefinition type="charge" />
 * <zeebe:taskDefinition type="refund" />  <!-- one too many -->
 */
class C8ExtensionElementUniqueRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    const byName = new Map<string, ZeebeValue[]>();
    for (const value of host.zeebeValues()) {
      if (value.placement === 'read' && RuleKit.kit.ZEEBE.isSingle(value.type.name)) {
        byName.set(value.type.name, [...(byName.get(value.type.name) ?? []), value]);
      }
    }
    const hint = host.hint();
    for (const [name, values] of byName) {
      const [, second] = values;
      if (second) {
        this.reportOn(host, `${host.describe()} has ${values.length} ${host.spell(name)} elements; Camunda 8 reads one and refuses the file`, { path: host.extensionPath(second.index), type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, node: host.node, extensionElement: second.value, hint: hint ? `Merge them into one: ${hint.rebuild(hint.nameOf(second.value)).replace(/^See it/, 'see them')}` : 'Merge them into one: fix it in the XML.' });
      }
    }
  }
}

export default defineRule({ ruleName: 'c8-extension-element-unique', code: 'W_C8_DEPLOY_DUPLICATE_EXTENSION', impact: 'deploy' }, C8ExtensionElementUniqueRule);
