import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host } from './support/C8Host.js';

/**
 * Variable events of a zeebe:conditionalFilter other than create and update.
 * Camunda 8 triggers a condition on create and update only and refuses the file.
 *
 * @example a Camunda 7 variable event
 * <zeebe:conditionalFilter variableEvents="create, delete" />  <!-- create, update -->
 */
class C8ConditionalFilterEventsKnownRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    for (const { value, index, type, placement } of host.zeebeValues()) {
      if (placement !== 'read' || type.name !== 'zeebe:conditionalFilter') continue;
      const unknown = (value.variableEvents as string | undefined)?.split(',').map((eventName) => eventName.trim()).filter((eventName) => eventName && eventName !== 'create' && eventName !== 'update') ?? [];
      if (unknown.length) {
        this.reportOn(host, `${host.spell('zeebe:conditionalFilter')} of ${host.describe()} lists the variable events ${unknown.join(', ')}; Camunda 8 knows create and update only and refuses the file`, { path: host.extensionPath(index, 'variableEvents'), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: value, property: 'variableEvents', hint: `${this.rebuildHint(host, value)} (variableEvents=create,update)` });
      }
    }
  }
}

export default defineRule({ ruleName: 'c8-conditional-filter-events-known', code: 'W_C8_DEPLOY_EXTENSION', impact: 'deploy' }, C8ConditionalFilterEventsKnownRule);
