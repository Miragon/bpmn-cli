import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement, type Reporter, type ReportPath } from '../CamundaRules.js';

import { C8CheckedElement, type ZeebeValue } from './extensions/C8CheckedElement.js';
import { sh } from '../shell.js';

const BINDING_TYPES = ['deployment', 'latest', 'versionTag'];

/** The extension element camunda-compat's `version-tag` checks on each host: the first of its type. */
const VERSION_TAG_CHECKED_BY_COMPAT: Record<string, string> = {
  'zeebe:calledDecision': 'bpmn:BusinessRuleTask',
  'zeebe:calledElement': 'bpmn:CallActivity',
  'zeebe:formDefinition': 'bpmn:UserTask',
};

/**
 * Reports zeebe extension content Camunda 8 refuses to deploy and camunda-compat does not check:
 * an unknown binding type, a linked resource without resource type or version tag, conditional
 * filter variable events other than create and update, a version tag binding without version tag
 * where camunda-compat does not look, and a task header key twice in a header list it skips.
 */
class C8Extension extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    const checked = C8CheckedElement.forNode(node);
    if (!checked) {
      return;
    }

    const read = checked.zeebeValues().filter((zeebeValue) => zeebeValue.placement === 'read');
    for (const zeebeValue of read) {
      const name = zeebeValue.type.name;
      if (name in VERSION_TAG_CHECKED_BY_COMPAT) {
        this.checkBinding(checked, zeebeValue, reporter);
      } else if (name === 'zeebe:linkedResources') {
        this.checkLinkedResources(checked, zeebeValue, reporter);
      } else if (name === 'zeebe:conditionalFilter') {
        this.checkConditionalFilter(checked, zeebeValue, reporter);
      } else if (name === 'zeebe:taskHeaders' && zeebeValue !== this.firstOf(read, name)) {
        this.checkHeaders(
          checked,
          zeebeValue.value,
          checked.extensionPath(zeebeValue.index),
          '',
          reporter,
        );
      } else if (name === 'zeebe:executionListeners' && zeebeValue !== this.firstOf(read, name)) {
        this.checkListenerHeaders(checked, zeebeValue, reporter);
      }
    }
  }

  private checkBinding(
    checked: C8CheckedElement,
    zeebeValue: ZeebeValue,
    reporter: Reporter,
  ): void {
    const { value, index, type } = zeebeValue;
    const bindingType: string | undefined = value.bindingType;
    if (bindingType === undefined) {
      return;
    }
    const subject = `${checked.spell(type.name)} of ${checked.describe()}`;
    const hint = checked.hint();
    const replaced = (fix: Record<string, string>) =>
      hint ? hint.replace(value, fix) : 'Fix it in the XML.';
    if (!BINDING_TYPES.includes(bindingType)) {
      this.reportBindingType(
        checked,
        value,
        subject,
        checked.extensionPath(index, 'bindingType'),
        replaced({ bindingType: 'latest' }),
        reporter,
      );
    } else if (this.lacksVersionTag(value) && !this.isCheckedByCompat(checked, zeebeValue)) {
      this.reportVersionTag(
        checked,
        value,
        subject,
        checked.extensionPath(index, 'versionTag'),
        replaced({ versionTag: '<versionTag>' }),
        reporter,
      );
    }
  }

  private checkLinkedResources(
    checked: C8CheckedElement,
    { value, index }: ZeebeValue,
    reporter: Reporter,
  ): void {
    const rebuild = this.rebuildHint(checked, value);
    (value.values ?? []).forEach((resource: ModdleElement, resourceIndex: number) => {
      const subject = `Linked resource ${resource.linkName ?? resourceIndex + 1} of ${checked.describe()}`;
      const path = (property: string) =>
        checked.extensionPath(index, 'values', resourceIndex, property);
      if (resource.resourceType === undefined || resource.resourceType === '') {
        checked.report(
          reporter,
          `${subject} has no resourceType; Camunda 8 refuses the file`,
          path('resourceType'),
          {
            type: ERROR_TYPES.PROPERTY_REQUIRED,
            node: resource,
            requiredProperty: 'resourceType',
            hint: rebuild,
          },
        );
      }
      const bindingType: string | undefined = resource.bindingType;
      if (bindingType !== undefined && !BINDING_TYPES.includes(bindingType)) {
        this.reportBindingType(checked, resource, subject, path('bindingType'), rebuild, reporter);
      } else if (bindingType === 'versionTag' && this.lacksVersionTag(resource)) {
        this.reportVersionTag(checked, resource, subject, path('versionTag'), rebuild, reporter);
      }
    });
  }

  private checkConditionalFilter(
    checked: C8CheckedElement,
    { value, index }: ZeebeValue,
    reporter: Reporter,
  ): void {
    const variableEvents: string | undefined = value.variableEvents;
    if (variableEvents === undefined) {
      return;
    }
    const unknown = variableEvents
      .split(',')
      .map((eventName) => eventName.trim())
      .filter((eventName) => eventName && eventName !== 'create' && eventName !== 'update');
    if (!unknown.length) {
      return;
    }
    checked.report(
      reporter,
      `${checked.spell('zeebe:conditionalFilter')} of ${checked.describe()} lists the variable events ${unknown.join(', ')}; Camunda 8 knows create and update only and refuses the file`,
      checked.extensionPath(index, 'variableEvents'),
      {
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        node: value,
        property: 'variableEvents',
        hint: `${this.rebuildHint(checked, value)} (variableEvents=create,update)`,
      },
    );
  }

  private checkListenerHeaders(
    checked: C8CheckedElement,
    { value, index }: ZeebeValue,
    reporter: Reporter,
  ): void {
    (value.listeners ?? []).forEach((listener: ModdleElement, listenerIndex: number) => {
      if (listener.headers) {
        const path = checked.extensionPath(index, 'listeners', listenerIndex, 'headers');
        this.checkHeaders(
          checked,
          listener.headers,
          path,
          `execution listener ${listenerIndex + 1}`,
          reporter,
        );
      }
    });
  }

  private checkHeaders(
    checked: C8CheckedElement,
    headers: ModdleElement,
    headersPath: ReportPath,
    listenerLabel: string,
    reporter: Reporter,
  ): void {
    const where = `${listenerLabel ? `${listenerLabel} of ` : ''}${checked.describe()}`;
    const hint = checked.hint();
    const seen = new Set<string>();
    (headers.values ?? []).forEach((header: ModdleElement, headerIndex: number) => {
      const key: string | undefined = header.key;
      if (key === undefined || key.trim() === '') {
        return;
      }
      if (seen.has(key)) {
        checked.report(
          reporter,
          `${where} has the task header "${key}" twice; Camunda 8 refuses the file`,
          [...headersPath, 'values', headerIndex, 'key'],
          {
            type: ERROR_TYPES.PROPERTY_VALUE_DUPLICATED,
            node: headers,
            duplicatedProperty: 'key',
            duplicatedPropertyValue: key,
            propertiesName: 'values',
            hint:
              hint && checked.el.id && !listenerLabel
                ? `Keep one: \`bpmn ext remove <file> ${checked.el.id} ${sh(`${hint.name('taskHeaders')}/${hint.name('header')}[${headerIndex}]`)}\`.`
                : 'Remove one in the XML.',
          },
        );
      }
      seen.add(key);
    });
  }

  private reportBindingType(
    checked: C8CheckedElement,
    element: ModdleElement,
    subject: string,
    path: ReportPath,
    hint: string,
    reporter: Reporter,
  ): void {
    checked.report(
      reporter,
      `${subject} has bindingType="${element.bindingType}"; Camunda 8 accepts ${BINDING_TYPES.join(', ')} only and refuses the file`,
      path,
      { type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: element, property: 'bindingType', hint },
    );
  }

  private reportVersionTag(
    checked: C8CheckedElement,
    element: ModdleElement,
    subject: string,
    path: ReportPath,
    hint: string,
    reporter: Reporter,
  ): void {
    checked.report(
      reporter,
      `${subject} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`,
      path,
      { type: ERROR_TYPES.PROPERTY_REQUIRED, node: element, requiredProperty: 'versionTag', hint },
    );
  }

  /** How to rebuild a zeebe element with child elements (`zeebe:linkedResources`). */
  private rebuildHint(checked: C8CheckedElement, element: ModdleElement): string {
    const hint = checked.hint();
    return hint ? hint.rebuild(hint.nameOf(element)) : 'Fix it in the XML.';
  }

  private lacksVersionTag(element: ModdleElement): boolean {
    return element.bindingType === 'versionTag' && !element.versionTag?.trim();
  }

  /** camunda-compat reports an empty version tag of the first such element on its host. */
  private isCheckedByCompat(checked: C8CheckedElement, { value, type }: ZeebeValue): boolean {
    const first = checked
      .zeebeValues()
      .find((zeebeValue) => zeebeValue.type.name === type.name)?.value;
    const versionTag: string | undefined = value.versionTag;
    return (
      first === value &&
      is(checked.el, VERSION_TAG_CHECKED_BY_COMPAT[type.name] ?? '') &&
      (versionTag === undefined || versionTag === '')
    );
  }

  private firstOf(read: ZeebeValue[], name: string): ZeebeValue | undefined {
    return read.find((zeebeValue) => zeebeValue.type.name === name);
  }
}

export default defineRule(
  { ruleName: 'c8-extension', kind: 'engine-specific', targetEngine: 'c8', impact: 'deploy' },
  C8Extension,
);
