import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRules.js';
import { ElementKinds } from '../ElementKinds.js';

import { Shell } from '../Shell.js';
import { Values } from '../Values.js';

const DI_TYPE = /^(bpmndi|dc|di):/;

/**
 * BPMN schema violations: extension elements on bpmn:definitions, and ids that are no valid XML
 * name.
 * Camunda 8 validates the file against the BPMN schema and refuses it.
 *
 * - `c8-schema`: extension elements on bpmn:definitions; an id that is no XML NCName (a colon, a
 *   leading digit, a space).
 *
 * @example an id with a colon
 * <bpmn:serviceTask id="Check:Order" />  <!-- no colon in an id -->
 */
class C8Schema extends C8Rule {
  protected visit(node: ModdleElement): void {
    if (node.$descriptor?.isGeneric) return;
    if (is(node, 'bpmn:Definitions') && node.extensionElements?.values?.length) this.report('c8-schema', node, 'bpmn:definitions carries bpmn:extensionElements, which the BPMN schema does not allow there; Camunda 8 refuses the file', { path: ['extensionElements'], type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: node.extensionElements, hint: `Move the content to the process: \`bpmn ext remove <file> ${node.id ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.` });
    this.checkId(node);
  }

  private checkId(node: ModdleElement): void {
    const id = node.id;
    if (typeof id !== 'string' || !id || Values.isNcName(id.trim())) return;
    const isDi = DI_TYPE.test(node.$type);
    const name = String(node.$type).startsWith('bpmn:') ? ElementKinds.describe(node) : `${node.$type} ${id}`;
    const what = isDi ? node.$type : name;
    const suggestedValue = id.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_');
    this.report('c8-schema', node, `${what} has the id "${id}", which is no XML NCName (${id.includes(':') ? 'a colon is not allowed in an id' : 'letters, digits, _ . - and no leading digit'}); Camunda 8 validates the file against the BPMN schema and refuses it`, { path: ['id'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'id', suggestedValue, hint: isDi ? 'Rename it in the XML (or redraw the diagram: `bpmn layout <file>`).' : `\`bpmn set <file> ${Shell.quote(id)} id=${suggestedValue}\`.` });
  }
}

export default defineRule({ ruleName: 'c8-schema', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-schema': ['W_C8_DEPLOY_SCHEMA', 'deploy'] } }, C8Schema);
