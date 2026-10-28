import { is } from 'bpmnlint-utils';
import { defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { CamundaAttributes } from './implementation/CamundaAttributes.js';
import { sh } from '../shell.js';
import { nonEmpty } from './implementation/utils/values.js';
import { C7Diagram } from './C7Diagram.js';

/**
 * Reports a multi-instance loop Camunda 7 refuses to deploy: no loop cardinality and no collection,
 * an empty cardinality, or an element variable without a collection. A `loopDataInputRef` counts as
 * a collection, as the engines read it as a variable name.
 */
class C7MultiInstance extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:Activity')) {
      return;
    }
    const loop = node.get('loopCharacteristics');
    if (!loop || !is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
      return;
    }
    const loopAttributes = new CamundaAttributes(loop);
    const cardinality = loop.get('loopCardinality');
    const hasCollection =
      loopAttributes.defined('collection') !== undefined || !!loop.get('loopDataInputRef');
    const prefix = C7Diagram.of(node).prefix;
    const id = node.id;
    if (!cardinality && !hasCollection) {
      this.reportNoInput(node, loop, prefix, reporter);
      return;
    }
    if (cardinality && !nonEmpty(cardinality.get('body')) && !hasCollection) {
      reportErrors(node, reporter, {
        message: `Multi-instance ${describeElement(node)} has an empty loop cardinality; the engines refuse the file`,
        path: ['loopCharacteristics', 'loopCardinality'],
        data: {
          type: ERROR_TYPES.EXPRESSION_REQUIRED,
          node: loop,
          parentNode: node,
          property: 'loopCardinality',
          hint: `\`bpmn set <file> ${id} cardinality=3\` (a number or \${...}).`,
        },
      });
    }
    if (loopAttributes.defined('elementVariable') !== undefined && !hasCollection) {
      reportErrors(node, reporter, {
        message: `Multi-instance ${describeElement(node)} has ${prefix}:elementVariable but no ${prefix}:collection; the engines refuse the file`,
        path: ['loopCharacteristics', 'collection'],
        data: {
          type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
          node: loop,
          parentNode: node,
          property: 'elementVariable',
          dependentRequiredProperty: 'collection',
          hint: `\`bpmn set <file> ${id} ${sh(`loop.${prefix}:collection=\${items}`)}\` (or remove it: \`bpmn set <file> ${id} loop.${prefix}:elementVariable=\`).`,
        },
      });
    }
  }

  private reportNoInput(
    activity: ModdleElement,
    loop: ModdleElement,
    prefix: string,
    reporter: Reporter,
  ): void {
    const misplaced = new CamundaAttributes(activity).any('collection');
    const note =
      misplaced !== undefined ? ` (${prefix}:collection sits on the activity, not on the loop)` : '';
    reportErrors(activity, reporter, {
      message: `Multi-instance ${describeElement(activity)} has neither a loop cardinality nor ${prefix}:collection${note}; the engines refuse the file`,
      path: ['loopCharacteristics', 'collection'],
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node: loop,
        parentNode: activity,
        requiredProperty: ['loopCardinality', 'collection'],
        hint:
          misplaced !== undefined
            ? this.moveOntoLoopHint(activity, misplaced, prefix)
            : this.noInputHint(activity.id, prefix),
      },
    });
  }

  private noInputHint(id: string, prefix: string): string {
    return `\`bpmn set <file> ${id} ${sh(`loop.${prefix}:collection=\${items}`)} loop.${prefix}:elementVariable=item\` (or \`bpmn set <file> ${id} cardinality=3\`).`;
  }

  /** Moves `camunda:collection`, and an element variable next to it, from the activity onto its loop. */
  private moveOntoLoopHint(activity: ModdleElement, collection: string, prefix: string): string {
    const elementVariable = new CamundaAttributes(activity).any('elementVariable');
    const variable =
      elementVariable !== undefined
        ? ` ${prefix}:elementVariable= ${sh(`loop.${prefix}:elementVariable=${elementVariable}`)}`
        : '';
    return `Move it onto the loop: \`bpmn set <file> ${activity.id} ${prefix}:collection= ${sh(`loop.${prefix}:collection=${collection}`)}${variable}\`.`;
  }
}

export default defineRule(
  { ruleName: 'c7-multi-instance', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7MultiInstance,
);
