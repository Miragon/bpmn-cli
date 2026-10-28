import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement, type Reporter, type ReportPath } from '../CamundaRules.js';

import { C8CheckedElement } from './extensions/C8CheckedElement.js';
import { didYouMean } from '../didYouMean.js';
import { ZeebeHint } from './extensions/ZeebeHint.js';
import { ZeebeSchema } from './extensions/ZeebeSchema.js';
import { sh } from '../shell.js';

/**
 * Reports an attribute Camunda 8 does not know: a `zeebe:` attribute of a BPMN element the zeebe
 * descriptor does not define (most zeebe settings are extension elements), or an attribute a zeebe
 * extension element does not have. Camunda 8 ignores it.
 */
class C8UnknownAttribute extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    const checked = C8CheckedElement.forNode(node);
    if (!checked) {
      return;
    }

    this.checkBpmnAttributes(checked, reporter);
    for (const { value, index, placement } of checked.zeebeValues()) {
      if (placement === 'read') {
        const hint = checked.hint();
        const rebuild = hint ? hint.rebuild(hint.nameOf(value)) : 'Fix it in the XML.';
        this.checkZeebeElement(checked, value, checked.extensionPath(index), [], rebuild, reporter);
      }
    }
  }

  private checkBpmnAttributes(checked: C8CheckedElement, reporter: Reporter): void {
    const schema = ZeebeSchema.instance;
    const hint = checked.hint();
    const prefix = ZeebeHint.prefixOf(checked.el);
    for (const key of checked.zeebeAttributeKeys()) {
      const localName = key.slice(key.indexOf(':') + 1);
      if (schema.ownersOfHostAttribute(localName)) {
        continue;
      }
      const name = (local: string) => `${prefix}:${local}`;
      const home = schema.homeOfAttribute(localName, checked.el);
      const homeName = home && name(home.name.slice('zeebe:'.length));
      const guess = home ? undefined : didYouMean(localName, schema.hostAttributeNames());
      const where = home
        ? ` (it reads ${localName} on the ${homeName} extension element)`
        : ' (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)';
      const unset = hint ? hint.unset(name(localName)) : 'edit the XML';
      const move = home && hint ? hint.extAdd(`${homeName} ${sh(`${localName}=${checked.el.$attrs[key] ?? ''}`)}`) : 'edit the XML';
      checked.report(
        reporter,
        `${checked.describe()} has the unknown attribute ${name(localName)}${guess ? ` (did you mean ${name(guess)}?)` : ''}; Camunda 8 ignores it${where}`,
        checked.path(key),
        {
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node: checked.el,
          property: key,
          hint: home ? `Move it: ${unset}, then ${move}.` : `Remove it: ${unset}.`,
        },
      );
    }
  }

  private checkZeebeElement(
    checked: C8CheckedElement,
    element: ModdleElement,
    path: ReportPath,
    containers: string[],
    hint: string,
    reporter: Reporter,
  ): void {
    const type = ZeebeSchema.instance.typeOf(element);
    if (!type) {
      return;
    }
    const where = `${checked.spell(type.name)}${containers.length ? ` (in ${containers.join(' > ')})` : ''} of ${checked.describe()}`;
    for (const key of Object.keys(element.$attrs ?? {})) {
      if (key.includes(':') || key.startsWith('xmlns')) {
        continue;
      }
      const guess = didYouMean(key, type.attributes);
      checked.report(
        reporter,
        `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${guess}?)` : ''}; Camunda 8 ignores it`,
        [...path, key],
        { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: element, property: key, hint },
      );
    }
    for (const property of element.$descriptor?.properties ?? []) {
      if (property.isAttr) {
        continue;
      }
      const content = element.get(property.name);
      const children: ModdleElement[] = Array.isArray(content) ? content : [content];
      children.forEach((child, childIndex) => {
        const childPath = Array.isArray(content)
          ? [...path, property.name, childIndex]
          : [...path, property.name];
        this.checkZeebeElement(checked, child, childPath, [...containers, checked.spell(type.name)], hint, reporter);
      });
    }
  }
}

export default defineRule(
  { ruleName: 'c8-unknown-attribute', kind: 'engine-specific', targetEngine: 'c8', impact: 'runtime' },
  C8UnknownAttribute,
);
