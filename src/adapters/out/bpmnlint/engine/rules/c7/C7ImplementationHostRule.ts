import type { ModdleElement } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { ImplementationHost } from './support/ImplementationHost.js';

/**
 * The base of the Camunda 7 rules on how a task or a message throw event is implemented: a rule
 * implements `checkHost(node, host)` for each implementation host of the element, one with a
 * camunda:type the engines do not support left out.
 * The engines refuse an unsupported type before they read the rest of the implementation, so
 * that one finding says what to fix.
 *
 * @example a service task the implementation rules read
 * <bpmn:serviceTask id="Charge" camunda:type="external" camunda:topic="charge" />
 */
export abstract class C7ImplementationHostRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    for (const host of ImplementationHost.forElement(node)) {
      if (!host.hasUnsupportedType) this.checkHost(node, host);
    }
  }

  protected abstract checkHost(node: ModdleElement, host: ImplementationHost): void;
}
