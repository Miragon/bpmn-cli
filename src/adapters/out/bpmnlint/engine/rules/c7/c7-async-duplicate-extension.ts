import { defineRule } from '../CamundaRules.js';

import { CamundaDuplicatesRule, type DuplicatedExtension } from './extensions/CamundaDuplicatesRule.js';

/**
 * Reports a second camunda:failedJobRetryTimeCycle on an element that does not run
 * asynchronously yet: it deploys now, and the Camunda 7 engines refuse the file once it does.
 */
class C7AsyncDuplicateExtension extends CamundaDuplicatesRule {
  protected readonly reportsRead = false;

  protected messageOf({ host, typeName, count }: DuplicatedExtension): string {
    return `${host.describe()} has ${count} ${typeName} elements; once it runs asynchronously the engines refuse the file`;
  }
}

export default defineRule(
  { ruleName: 'c7-async-duplicate-extension', kind: 'engine-specific', targetEngine: 'c7', impact: 'practice' },
  C7AsyncDuplicateExtension,
);
