import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8CheckedElement, type ZeebeValue } from './extensions/C8CheckedElement.js';
import { ZeebeSchema } from './extensions/ZeebeSchema.js';

/**
 * Reports two or more of a zeebe extension element Camunda 8 reads once per element (two
 * `zeebe:taskDefinition`, two `zeebe:ioMapping`, ...): it refuses the file.
 */
class C8DuplicateExtension extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    const checked = C8CheckedElement.forNode(node);
    if (!checked) {
      return;
    }

    const byName = new Map<string, ZeebeValue[]>();
    for (const zeebeValue of checked.zeebeValues()) {
      if (zeebeValue.placement === 'read' && ZeebeSchema.instance.isSingle(zeebeValue.type)) {
        byName.set(zeebeValue.type.name, [...(byName.get(zeebeValue.type.name) ?? []), zeebeValue]);
      }
    }

    for (const [name, zeebeValues] of byName) {
      const [, second] = zeebeValues;
      if (!second) {
        continue;
      }
      checked.report(
        reporter,
        `${checked.describe()} has ${zeebeValues.length} ${checked.spell(name)} elements; Camunda 8 reads one and refuses the file`,
        checked.extensionPath(second.index),
        {
          type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
          node: checked.el,
          extensionElement: second.value,
          hint: this.hintFor(checked, second.value),
        },
      );
    }
  }

  private hintFor(checked: C8CheckedElement, duplicate: ModdleElement): string {
    const hint = checked.hint();
    if (!hint) {
      return 'Merge them into one: fix it in the XML.';
    }
    const rebuild = hint.rebuild(hint.nameOf(duplicate)).replace(/^See it/, 'see them');
    return `Merge them into one: ${rebuild}`;
  }
}

export default defineRule(
  { ruleName: 'c8-duplicate-extension', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-duplicate-extension': ['W_C8_DEPLOY_DUPLICATE_EXTENSION', 'deploy'] } },
  C8DuplicateExtension,
);
