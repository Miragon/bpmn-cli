import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C7ExtensionContentRule } from './C7ExtensionContentRule.js';
import type { C7Host, HostExtension } from './support/C7Host.js';

/**
 * A camunda:in or camunda:out without source (or sourceExpression) or without target, and without
 * variables="all" (or a businessKey of camunda:in).
 * Camunda 7 refuses to deploy the file.
 *
 * @example a call activity mapping without target
 * <camunda:in source="orderId" />  <!-- target="orderId" -->
 */
class C7CallMappingNeedsSourceAndTargetRule extends C7ExtensionContentRule {
  protected checkHost(host: C7Host, read: HostExtension[]): void {
    for (const extension of read) {
      if (extension.local === 'in' || extension.local === 'out') {
        this.checkBinding(host, extension);
      }
    }
  }

  private checkBinding(host: C7Host, extension: HostExtension): void {
    const { value, index, local } = extension;
    if (value.get('variables') !== undefined || (local === 'in' && value.get('businessKey') !== undefined)) {
      return;
    }
    const hasSource = value.get('source') !== undefined || value.get('sourceExpression') !== undefined;
    const hasTarget = value.get('target') !== undefined;
    if (hasSource && hasTarget) return;
    const missing = [!hasSource ? 'source or sourceExpression' : '', !hasTarget ? 'target' : ''].filter(Boolean).join(' and ');
    const fix = { ...(hasSource ? {} : { source: '<var>' }), ...(hasTarget ? {} : { target: '<var>' }) };
    this.reportOn(host, `${host.typeName(local)} of ${host.describe()} has no ${missing} (and no variables="all"${local === 'in' ? ' / businessKey' : ''}); the engines refuse the file`, { path: hasSource ? host.extensionPath(index, 'target') : host.extensionPath(index), type: ERROR_TYPES.PROPERTY_REQUIRED, node: value, requiredProperty: hasSource ? 'target' : ['source', 'sourceExpression', ...(hasTarget ? [] : ['target'])], hint: `${host.rebuild(extension, fix).replace(/\.$/, '')} (or with variables=all instead of source and target).` });
  }
}

export default defineRule({ ruleName: 'c7-call-mapping-needs-source-and-target', code: 'W_C7_DEPLOY_EXTENSION', impact: 'deploy' }, C7CallMappingNeedsSourceAndTargetRule);
