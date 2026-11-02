import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { Shell } from '../support/Shell.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import { C7MultiInstanceLoop } from './support/C7MultiInstanceLoop.js';

/**
 * A camunda:elementVariable of a multi-instance loop with a cardinality but no collection; a loop
 * with neither is the cardinality-or-collection rule's.
 * Camunda 7 refuses to deploy the file.
 *
 * @example an element variable without collection
 * <bpmn:multiInstanceLoopCharacteristics camunda:elementVariable="reviewer">
 *   <bpmn:loopCardinality>3</bpmn:loopCardinality>  <!-- camunda:collection="${reviewers}" -->
 * </bpmn:multiInstanceLoopCharacteristics>
 */
class C7ElementVariableNeedsCollectionRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    const multiInstance = C7MultiInstanceLoop.of(node);
    if (!multiInstance?.cardinality || multiInstance.hasCollection || multiInstance.attributes.defined('elementVariable') === undefined) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    this.report(node, `Multi-instance ${ElementKinds.describe(node)} has ${prefix}:elementVariable but no ${prefix}:collection; the engines refuse the file`, { path: ['loopCharacteristics', 'collection'], type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED, node: multiInstance.loop, property: 'elementVariable', dependentRequiredProperty: 'collection', hint: `\`bpmn set <file> ${node.id} ${Shell.quote(`loop.${prefix}:collection=\${items}`)}\` (or remove it: \`bpmn set <file> ${node.id} loop.${prefix}:elementVariable=\`).` });
  }
}

export default defineRule({ ruleName: 'c7-element-variable-needs-collection', code: 'W_C7_DEPLOY_MULTI_INSTANCE', impact: 'deploy' }, C7ElementVariableNeedsCollectionRule);
