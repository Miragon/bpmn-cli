import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C7ExtensionContentRule } from './C7ExtensionContentRule.js';
import type { C7Host, HostExtension } from './support/C7Host.js';

/**
 * A camunda:connector without camunda:connectorId.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a connector without id
 * <camunda:connector />  <!-- <camunda:connectorId>http-connector</camunda:connectorId> -->
 */
class C7ConnectorNeedsIdRule extends C7ExtensionContentRule {
  protected checkHost(host: C7Host, read: HostExtension[]): void {
    for (const extension of read) {
      const { value, index, local } = extension;
      if (local === 'connector' && value.get('connectorId') === undefined) {
        this.reportOn(host, `${host.typeName('connector')} of ${host.describe()} has no ${host.typeName('connectorId')}; the engines refuse the file`, { path: host.extensionPath(index, 'connectorId'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: value, requiredProperty: 'connectorId', hint: host.rebuild(extension) });
      }
    }
  }
}

export default defineRule({ ruleName: 'c7-connector-needs-id', code: 'W_C7_DEPLOY_EXTENSION', impact: 'deploy' }, C7ConnectorNeedsIdRule);
