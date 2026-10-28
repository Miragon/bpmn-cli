import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

/**
 * Reports `bpmn:extensionElements` directly under `bpmn:definitions`: the BPMN schema does not
 * allow them there, and Camunda 7 validates the file against it and refuses it.
 */
class C7DefinitionsExtension extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:Definitions')) {
      return;
    }
    const values: ModdleElement[] = node.extensionElements?.values ?? [];
    if (!values.length) {
      return;
    }
    const types = values.map((value) => this.xmlName(value.$type)).join(', ');
    reportErrors(node, reporter, {
      message: `bpmn:definitions carries bpmn:extensionElements (${types}), which the BPMN schema does not allow there; the engines refuse the file`,
      path: ['extensionElements'],
      data: {
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        node,
        parentNode: null,
        property: 'extensionElements',
        hint: `Move the content to the process: \`bpmn ext remove <file> ${node.id ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.`,
      },
    });
  }

  /** `camunda:properties` for the typed `camunda:Properties`, as the file spells it. */
  private xmlName(type: string): string {
    const colon = type.indexOf(':');
    return `${type.slice(0, colon + 1)}${type.charAt(colon + 1).toLowerCase()}${type.slice(colon + 2)}`;
  }
}

export default defineRule(
  { ruleName: 'c7-definitions-extension', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7DefinitionsExtension,
);
