import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { BINDING_TYPES, type BindingSite, C8BindingRule } from './C8BindingRule.js';
import type { C8Host } from './support/C8Host.js';

/**
 * A binding type other than deployment, latest or versionTag, of a called decision, element or
 * form, or of a linked resource.
 * Camunda 8 cannot resolve the resource and refuses the file.
 *
 * @example an unknown binding type
 * <zeebe:calledElement processId="Billing" bindingType="newest" />  <!-- latest -->
 */
class C8BindingTypeKnownRule extends C8BindingRule {
  protected checkBinding(host: C8Host, { element, subject, path, hint }: BindingSite): void {
    const bindingType: string | undefined = element.bindingType;
    if (bindingType === undefined || BINDING_TYPES.includes(bindingType)) return;
    this.reportOn(host, `${subject} has bindingType="${bindingType}"; Camunda 8 accepts ${BINDING_TYPES.join(', ')} only and refuses the file`, { path: path('bindingType'), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: element, property: 'bindingType', hint: hint({ bindingType: 'latest' }) });
  }
}

export default defineRule({ ruleName: 'c8-binding-type-known', code: 'W_C8_DEPLOY_EXTENSION', impact: 'deploy' }, C8BindingTypeKnownRule);
