import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { LinkEvents } from '../support/LinkEvents.js';
import { Shell } from '../support/Shell.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';

/**
 * A link throw event without a link catch event of its name in its scope.
 * Camunda 8 resolves a link within its (sub-)process and refuses the file.
 *
 * @example a link throw without its catch
 * <bpmn:intermediateThrowEvent id="GoOn">
 *   <bpmn:linkEventDefinition name="Resume" />  <!-- no catch event named Resume -->
 * </bpmn:intermediateThrowEvent>
 */
class C8LinkThrowNeedsCatchRule extends C8Rule {
  protected visit(process: ModdleElement): void {
    if (!is(process, 'bpmn:Process') || !EngineScope.C8.contains(process)) return;
    const links = new LinkEvents(process, (node) => C8EventDefinitions.onlyDefinition(node, 'bpmn:LinkEventDefinition')?.get('name'));
    for (const { el, name, scope } of links.unmatchedThrows()) {
      this.report(el, `Link throw event ${el.id} goes to "${name}", but ${scope.id} has no link catch event of that name; Camunda 8 refuses the file`, { path: ['eventDefinitions', 0, 'name'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: el.get('eventDefinitions')[0], property: 'name', hint: `\`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${scope.id} --link ${Shell.quote(name)}\`, then continue from it (or rename the link: \`bpmn set <file> ${el.id} link=<Name>\`).` });
    }
  }
}

export default defineRule({ ruleName: 'c8-link-throw-needs-catch', code: 'W_C8_DEPLOY_LINK', impact: 'deploy' }, C8LinkThrowNeedsCatchRule);
