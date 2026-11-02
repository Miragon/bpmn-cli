import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { RuleKit } from '../RuleKit.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host } from './support/C8Host.js';
import { ZeebeHint } from './support/ZeebeHint.js';

/**
 * A zeebe attribute on a BPMN element that does not carry it (`zeebe:modelerTemplate` on a lane).
 * Camunda 8 deploys the file and silently ignores the attribute.
 *
 * @example a template reference on a lane
 * <bpmn:lane id="Sales" zeebe:modelerTemplate="io.camunda.connectors.Slack" />  <!-- read on tasks and events -->
 */
class C8ZeebeAttributePlacementRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    const hint = host.hint();
    const prefix = ZeebeHint.prefixOf(host.node);
    for (const key of host.zeebeAttributeKeys()) {
      const local = key.slice(key.indexOf(':') + 1);
      const owners = RuleKit.kit.ZEEBE.attr(local)?.owners;
      if (owners && !owners.some((owner) => host.node.$instanceOf(owner))) {
        this.reportContent(host, `${prefix}:${local} on ${host.describe()} has no effect: Camunda 8 reads it on ${ElementKinds.list(owners)} only`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: key, path: host.path(key), hint: `Remove it: ${hint ? hint.unset(`${prefix}:${local}`) : 'edit the XML'}.` });
      }
    }
  }
}

export default defineRule({ ruleName: 'c8-zeebe-attribute-placement', code: 'W_C8_MISPLACED_ATTRIBUTE', impact: 'runtime' }, C8ZeebeAttributePlacementRule);
