import { defineRule, ERROR_TYPES, type ModdleElement, type ReportPath } from '../CamundaRule.js';
import { Values } from '../support/Values.js';
import { C7ExtensionContentRule } from './C7ExtensionContentRule.js';
import type { C7Host, HostExtension } from './support/C7Host.js';

/**
 * An input or output parameter without name, of camunda:inputOutput or of a connector's.
 * Camunda 7 refuses to deploy the file.
 *
 * @example an input parameter without name
 * <camunda:inputOutput><camunda:inputParameter>${amount}</camunda:inputParameter></camunda:inputOutput>  <!-- name="amount" -->
 */
class C7IoParameterNeedsNameRule extends C7ExtensionContentRule {
  protected checkHost(host: C7Host, read: HostExtension[]): void {
    for (const extension of read) {
      const { value, index, local } = extension;
      if (local === 'inputOutput') {
        this.checkParameters(host, value, host.extensionPath(index), host.rebuild(extension));
      } else if (local === 'connector' && value.get('inputOutput')) {
        this.checkParameters(host, value.get('inputOutput'), host.extensionPath(index, 'inputOutput'), host.rebuild(extension));
      }
    }
  }

  private checkParameters(host: C7Host, mapping: ModdleElement, path: ReportPath, rebuild: string): void {
    for (const kind of ['inputParameter', 'outputParameter']) {
      (mapping.get(`${kind}s`) ?? []).forEach((parameter: ModdleElement, index: number) => {
        if (!Values.nonEmpty(parameter.get('name'))) {
          this.reportOn(host, `${host.typeName(kind)} ${index + 1} of ${host.describe()} has no name; the engines refuse the file`, { path: [...path, `${kind}s`, index, 'name'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: parameter, requiredProperty: 'name', hint: rebuild });
        }
      });
    }
  }
}

export default defineRule({ ruleName: 'c7-io-parameter-needs-name', code: 'W_C7_DEPLOY_EXTENSION', impact: 'deploy' }, C7IoParameterNeedsNameRule);
