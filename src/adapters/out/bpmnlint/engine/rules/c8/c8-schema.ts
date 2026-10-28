import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, type ModdleElement } from '../CamundaRules.js';

import { sh } from '../shell.js';

const NCNAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const NCNAME = new RegExp(`^[${NCNAME_START}][${NCNAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, 'u');
const DI_TYPE = /^(bpmndi|dc|di):/;

/**
 * Reports what Camunda 8 refuses when it validates the file against the BPMN schema and the moddle
 * tree shows: extension elements on `bpmn:definitions`, and ids that are no XML NCName. Attributes
 * without a namespace prefix are bpmn-cli's UnprefixedAttributes, which reads its own model.
 */
class C8Schema extends C8Rule {
  protected visit(node: ModdleElement): void {
    if (node.$descriptor?.isGeneric) return;
    if (is(node, 'bpmn:Definitions') && node.extensionElements?.values?.length) this.report('c8-schema', node, 'bpmn:definitions carries bpmn:extensionElements, which the BPMN schema does not allow there; Camunda 8 refuses the file', { path: ['extensionElements'], type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: node.extensionElements, hint: `Move the content to the process: \`bpmn ext remove <file> ${node.id ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.` });
    this.checkId(node);
  }

  private checkId(node: ModdleElement): void {
    const id = node.id;
    if (typeof id !== 'string' || !id || NCNAME.test(id.trim())) return;
    const isDi = DI_TYPE.test(node.$type);
    const name = String(node.$type).startsWith('bpmn:') ? describeElement(node) : `${node.$type} ${id}`;
    const what = isDi ? node.$type : name;
    const suggestedValue = id.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_');
    this.report('c8-schema', node, `${what} has the id "${id}", which is no XML NCName (${id.includes(':') ? 'a colon is not allowed in an id' : 'letters, digits, _ . - and no leading digit'}); Camunda 8 validates the file against the BPMN schema and refuses it`, { path: ['id'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'id', suggestedValue, hint: isDi ? 'Rename it in the XML (or redraw the diagram: `bpmn layout <file>`).' : `\`bpmn set <file> ${sh(id)} id=${suggestedValue}\`.` });
  }
}

export default defineRule({ ruleName: 'c8-schema', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-schema': ['W_C8_DEPLOY_SCHEMA', 'deploy'] } }, C8Schema);
