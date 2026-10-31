import { is } from 'bpmnlint-utils';
import { C7Rule, type ModdleElement } from '../CamundaRule.js';

/**
 * The base of the Camunda 7 rules on what the engines run: a rule implements `check(node)` for each
 * element of an executable process, the content of an ad-hoc sub-process left out.
 * The engines deploy no process that is not executable, and run no ad-hoc sub-process, so neither
 * holds anything they could refuse.
 *
 * @example a process the rules skip
 * <bpmn:process id="Sketch" isExecutable="false" />
 */
export abstract class C7ExecutableRule extends C7Rule {
  protected visit(node: ModdleElement): boolean {
    if (is(node, 'bpmn:Process') && node.isExecutable !== true) return false;
    this.checkNode(node);
    return !is(node, 'bpmn:AdHocSubProcess');
  }

  protected abstract checkNode(node: ModdleElement): void;
}
