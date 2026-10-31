import { defineRule, ERROR_TYPES, type ReportData } from '../CamundaRule.js';
import { ZEEBE_URI } from '../support/DiagramNamespaces.js';
import { C7VendorContentRule } from './C7VendorContentRule.js';
import { CamundaPlacement } from './support/CamundaPlacement.js';
import type { C7Host } from './support/C7Host.js';

/**
 * Camunda 8 content in a Camunda 7 model: zeebe attributes, of BPMN elements and inside the camunda
 * extension elements the engines read, and zeebe extension elements.
 * Camunda 7 deploys the file and ignores them.
 *
 * @example a Camunda 8 job type in a Camunda 7 model
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><zeebe:taskDefinition type="charge" /></bpmn:extensionElements>  <!-- camunda:type="external" -->
 * </bpmn:serviceTask>
 */
class C7NoZeebeContentRule extends C7VendorContentRule {
  protected checkHost(host: C7Host): void {
    for (const { key, local, uri } of host.foreignAttributes()) {
      if (uri === ZEEBE_URI) {
        this.reportForeignAttribute(host, host.describe(), key, { property: `zeebe:${local}`, path: host.path(`zeebe:${local}`), hint: `Remove it: ${host.unset(key) ?? 'edit the XML'}, and use the camunda attribute instead (\`bpmn kinds\` lists them).` });
      }
    }
    if (host.isDefinitions()) return;
    const read = new CamundaPlacement(host).readExtensions().map(({ index }) => index);
    for (const extension of host.extensions()) {
      const type = String(extension.value.$type);
      if (extension.uri === ZEEBE_URI) {
        this.reportContent(host, `${host.describe()} contains the Camunda 8 extension ${type}, which Camunda 7 ignores`, { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: extension.value, path: host.extensionPath(extension.index), node: extension.value, hint: host.address ? `Remove it: ${host.address.extRemove(type)}.` : 'Remove it from the XML.' });
      }
      if (!read.includes(extension.index)) continue;
      for (const { element, where, path, key, local, uri } of host.treeAttributes(extension)) {
        if (uri === ZEEBE_URI) {
          this.reportForeignAttribute(host, where, key, { property: `zeebe:${local}`, path: [...path, `zeebe:${local}`], node: element, hint: host.rebuild(extension) });
        }
      }
    }
  }

  private reportForeignAttribute(host: C7Host, where: string, key: string, data: Pick<ReportData, 'path'> & Record<string, unknown>): void {
    this.reportContent(host, `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, ...data });
  }
}

export default defineRule({ ruleName: 'c7-no-zeebe-content', code: 'W_C7_FOREIGN_CONTENT', impact: 'runtime' }, C7NoZeebeContentRule);
