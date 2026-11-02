import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { Values } from '../support/Values.js';
import { C8FeelRule } from './C8FeelRule.js';
import { C8Host } from './support/C8Host.js';
import { ZeebeHint } from './support/ZeebeHint.js';

/**
 * A multi-instance input collection, or an output element next to an output collection, that is a
 * static value.
 * Camunda 8 reads both as FEEL expressions and refuses the file.
 *
 * @example a static input collection
 * <bpmn:multiInstanceLoopCharacteristics>
 *   <bpmn:extensionElements><zeebe:loopCharacteristics inputCollection="items" /></bpmn:extensionElements>  <!-- =items -->
 * </bpmn:multiInstanceLoopCharacteristics>
 */
class C8MultiInstanceNeedsFeelRule extends C8FeelRule {
  protected visit(activity: ModdleElement): void {
    if (!this.runs(activity) || !is(activity, 'bpmn:Activity')) return;
    const loop = activity.loopCharacteristics;
    if (!loop || !is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
    const [zeebeLoop] = C8Host.valuesOf(loop, 'zeebe:LoopCharacteristics');
    if (zeebeLoop && Values.nonEmpty(zeebeLoop.inputCollection) && !Values.isFeel(zeebeLoop.inputCollection)) {
      this.reportStatic(activity, zeebeLoop, 'inputCollection');
    }
    if (zeebeLoop && zeebeLoop.outputCollection !== undefined && zeebeLoop.outputElement !== undefined && !Values.isFeel(zeebeLoop.outputElement)) {
      this.reportStatic(activity, zeebeLoop, 'outputElement');
    }
  }

  private reportStatic(activity: ModdleElement, zeebeLoop: ModdleElement, property: string): void {
    const value: string = zeebeLoop[property];
    this.reportAt(this.siteOf(activity, zeebeLoop, property), `${property}="${value}" of multi-instance ${ElementKinds.describe(activity)} is a static value; Camunda 8 needs a FEEL expression (=${value.trim()}) and refuses the file`, ERROR_TYPES.EXPRESSION_REQUIRED, ZeebeHint.fix(activity.loopCharacteristics, zeebeLoop, { [property]: `=${value.trim()}` }));
  }
}

export default defineRule({ ruleName: 'c8-multi-instance-needs-feel', code: 'W_C8_DEPLOY_EXPRESSION', impact: 'deploy' }, C8MultiInstanceNeedsFeelRule);
