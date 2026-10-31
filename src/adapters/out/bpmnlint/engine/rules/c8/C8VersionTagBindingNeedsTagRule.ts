import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { type BindingSite, C8BindingRule } from './C8BindingRule.js';
import type { C8Host } from './support/C8Host.js';

/**
 * A versionTag binding without version tag, of a called decision, element or form (beyond the one
 * camunda-compat checks), or of a linked resource.
 * Camunda 8 has no version to resolve and refuses the file.
 *
 * @example a versionTag binding without version tag
 * <zeebe:calledElement processId="Billing" bindingType="versionTag" />  <!-- versionTag="v2" -->
 */
class C8VersionTagBindingNeedsTagRule extends C8BindingRule {
  protected checkBinding(host: C8Host, { element, subject, path, hint, checkedByCompat }: BindingSite): void {
    if (element.bindingType !== 'versionTag' || element.versionTag?.trim() || checkedByCompat) {
      return;
    }
    this.reportOn(host, `${subject} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, { path: path('versionTag'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: element, requiredProperty: 'versionTag', hint: hint({ versionTag: '<versionTag>' }) });
  }
}

export default defineRule({ ruleName: 'c8-version-tag-binding-needs-tag', code: 'W_C8_DEPLOY_EXTENSION', impact: 'deploy' }, C8VersionTagBindingNeedsTagRule);
