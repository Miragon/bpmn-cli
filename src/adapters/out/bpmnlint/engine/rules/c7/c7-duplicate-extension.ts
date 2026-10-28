import { defineRule } from '../CamundaRules.js';

import { CamundaDuplicatesRule, type DuplicatedExtension } from './extensions/CamundaDuplicatesRule.js';

/**
 * Reports a second camunda:inputOutput, connector, formData or failedJobRetryTimeCycle where the
 * Camunda 7 engines read one; they refuse the file (ENGINE-01009).
 */
class C7DuplicateExtension extends CamundaDuplicatesRule {
  protected readonly reportsRead = true;

  protected messageOf({ host, local, typeName, count }: DuplicatedExtension): string {
    return `${host.describe()} has ${count} ${typeName} elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name ${local})`;
  }
}

export default defineRule(
  { ruleName: 'c7-duplicate-extension', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7DuplicateExtension,
);
