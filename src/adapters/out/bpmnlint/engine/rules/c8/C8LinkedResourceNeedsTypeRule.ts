import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { type BindingSite, C8BindingRule } from './C8BindingRule.js';
import type { C8Host } from './support/C8Host.js';

/**
 * A linked resource without resource type.
 * Camunda 8 cannot tell what the resource is and refuses the file.
 *
 * @example a linked resource without type
 * <zeebe:linkedResources><zeebe:linkedResource linkName="tools" resourceId="toolbox" /></zeebe:linkedResources>  <!-- resourceType="RPA" -->
 */
class C8LinkedResourceNeedsTypeRule extends C8BindingRule {
  protected checkBinding(host: C8Host, { element, subject, path, hint, linked }: BindingSite): void {
    if (!linked || (element.resourceType !== undefined && element.resourceType !== '')) {
      return;
    }
    this.reportOn(host, `${subject} has no resourceType; Camunda 8 refuses the file`, { path: path('resourceType'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: element, requiredProperty: 'resourceType', hint: hint({}) });
  }
}

export default defineRule({ ruleName: 'c8-linked-resource-needs-type', code: 'W_C8_DEPLOY_EXTENSION', impact: 'deploy' }, C8LinkedResourceNeedsTypeRule);
