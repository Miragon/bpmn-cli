import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';

/**
 * A link event definition without name or with an empty one, anywhere in the file.
 * The BPMN schema requires a name, and Camunda 8 refuses an empty one. camunda-compat checks the
 * first definition of an intermediate event in an executable process; this rule checks the others.
 *
 * @example a link catch event without name
 * <bpmn:intermediateCatchEvent id="Resume">
 *   <bpmn:linkEventDefinition />  <!-- no name -->
 * </bpmn:intermediateCatchEvent>
 */
class C8LinkEventNeedsNameRule extends C8Rule {
  protected visit(definition: ModdleElement): void {
    if (!is(definition, 'bpmn:LinkEventDefinition')) return;
    const name = definition.get('name');
    const event = definition.$parent;
    const checkedByCompat = isAny(event, ['bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent']) && event.get('eventDefinitions')[0] === definition && EngineScope.inExecutableProcess(event);
    if ((name !== undefined && name !== null && name !== '') || checkedByCompat) {
      return;
    }
    const { owner, path } = C8EventDefinitions.definitionOwner(definition);
    this.report(owner, `The link event definition of ${owner === definition ? definition.$type : ElementKinds.describe(owner)} has ${name === '' ? 'an empty name' : 'no name, which the BPMN schema requires'}; Camunda 8 refuses the file`, { path: [...path, 'name'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: definition, requiredProperty: 'name', hint: owner.id ? `\`bpmn set <file> ${owner.id} link=<Name>\` (the throw and the catch event of a pair share the name).` : 'Fix it in the XML.' });
  }
}

export default defineRule({ ruleName: 'c8-link-event-needs-name', code: 'W_C8_DEPLOY_LINK', impact: 'deploy' }, C8LinkEventNeedsNameRule);
