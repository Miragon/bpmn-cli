import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8CheckedElement } from './extensions/C8CheckedElement.js';
import { ZeebeHint } from './extensions/ZeebeHint.js';
import { ZeebeSchema } from './extensions/ZeebeSchema.js';

/**
 * Reports a zeebe attribute on a BPMN element that does not carry it (`zeebe:modelerTemplate` on a
 * lane, `zeebe:retryCounter` on a user task): Camunda 8 reads it on other elements only.
 */
class C8MisplacedAttribute extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    const checked = C8CheckedElement.forNode(node);
    if (!checked) {
      return;
    }

    const hint = checked.hint();
    const prefix = ZeebeHint.prefixOf(node);
    for (const key of checked.zeebeAttributeKeys()) {
      const localName = key.slice(key.indexOf(':') + 1);
      const owners = ZeebeSchema.instance.ownersOfHostAttribute(localName);
      if (!owners || owners.some((owner) => node.$instanceOf(owner))) {
        continue;
      }
      const readOn = owners
        .map((owner) => owner.slice('bpmn:'.length))
        .map((owner) => `${owner.charAt(0).toLowerCase()}${owner.slice(1)}`);
      checked.report(
        reporter,
        `${prefix}:${localName} on ${checked.describe()} has no effect: Camunda 8 reads it on ${readOn.join(', ')} only`,
        checked.path(key),
        {
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node,
          property: key,
          hint: `Remove it: ${hint ? hint.unset(`${prefix}:${localName}`) : 'edit the XML'}.`,
        },
      );
    }
  }
}

export default defineRule(
  { ruleName: 'c8-misplaced-attribute', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-misplaced-attribute': ['W_C8_MISPLACED_ATTRIBUTE', 'runtime'] } },
  C8MisplacedAttribute,
);
