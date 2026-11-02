import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { Shell } from '../support/Shell.js';
import { Values } from '../support/Values.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import { C7MultiInstanceLoop } from './support/C7MultiInstanceLoop.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

/**
 * A multi-instance loop with nothing to iterate over: neither a loop cardinality nor a collection,
 * or an empty cardinality and no collection.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a loop without cardinality or collection
 * <bpmn:userTask id="Review">
 *   <bpmn:multiInstanceLoopCharacteristics />  <!-- camunda:collection="${reviewers}" -->
 * </bpmn:userTask>
 */
class C7MultiInstanceNeedsCardinalityOrCollectionRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    const multiInstance = C7MultiInstanceLoop.of(node);
    if (!multiInstance || multiInstance.hasCollection) return;
    const { loop, cardinality } = multiInstance;
    const prefix = C7Diagram.of(node).prefix;
    const label = ElementKinds.describe(node);
    const id = node.id;
    if (!cardinality) {
      const misplaced = new CamundaAttributes(node).any('collection');
      const elementVariable = new CamundaAttributes(node).any('elementVariable');
      const variable = elementVariable !== undefined ? ` ${prefix}:elementVariable= ${Shell.quote(`loop.${prefix}:elementVariable=${elementVariable}`)}` : '';
      const hint = misplaced !== undefined ? `Move it onto the loop: \`bpmn set <file> ${id} ${prefix}:collection= ${Shell.quote(`loop.${prefix}:collection=${misplaced}`)}${variable}\`.` : `\`bpmn set <file> ${id} ${Shell.quote(`loop.${prefix}:collection=\${items}`)} loop.${prefix}:elementVariable=item\` (or \`bpmn set <file> ${id} cardinality=3\`).`;
      this.report(node, `Multi-instance ${label} has neither a loop cardinality nor ${prefix}:collection${misplaced !== undefined ? ` (${prefix}:collection sits on the activity, not on the loop)` : ''}; the engines refuse the file`, { path: ['loopCharacteristics', 'collection'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: loop, requiredProperty: ['loopCardinality', 'collection'], hint });
    } else if (!Values.nonEmpty(cardinality.get('body'))) {
      this.report(node, `Multi-instance ${label} has an empty loop cardinality; the engines refuse the file`, { path: ['loopCharacteristics', 'loopCardinality'], type: ERROR_TYPES.EXPRESSION_REQUIRED, node: loop, property: 'loopCardinality', hint: `\`bpmn set <file> ${id} cardinality=3\` (a number or \${...}).` });
    }
  }
}

export default defineRule({ ruleName: 'c7-multi-instance-needs-cardinality-or-collection', code: 'W_C7_DEPLOY_MULTI_INSTANCE', impact: 'deploy' }, C7MultiInstanceNeedsCardinalityOrCollectionRule);
