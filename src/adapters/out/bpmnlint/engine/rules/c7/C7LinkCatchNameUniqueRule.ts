import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { C7Links } from './support/C7Links.js';

/**
 * Two link catch events with one name in a process, sub-processes included.
 * Camunda 7 refuses to deploy the file.
 *
 * @example two catch events of one link
 * <bpmn:intermediateCatchEvent id="Ship"><bpmn:linkEventDefinition name="Shipping" /></bpmn:intermediateCatchEvent>
 * <bpmn:intermediateCatchEvent id="ShipAgain"><bpmn:linkEventDefinition name="Shipping" /></bpmn:intermediateCatchEvent>
 */
class C7LinkCatchNameUniqueRule extends C7Rule {
  protected visit(node: ModdleElement): void {
    if (!is(node, 'bpmn:Process') || !EngineScope.C7.contains(node)) return;
    for (const { first, el, name } of C7Links.of(node).duplicateCatches()) {
      this.report(el, `Link catch events ${first.id} and ${el.id} are both named "${name}"; the engines refuse two link catch events with one name in a process (sub-processes included)`, { path: C7Links.namePath(el), type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, duplicatedProperty: 'name', duplicatedPropertyValue: name, first, hint: `\`bpmn set <file> ${el.id} link=<OtherName>\` (and its throw events too).` });
    }
  }
}

export default defineRule({ ruleName: 'c7-link-catch-name-unique', code: 'W_C7_DEPLOY_LINK', impact: 'deploy' }, C7LinkCatchNameUniqueRule);
