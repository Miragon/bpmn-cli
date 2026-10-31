import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { SetCommand } from '../support/SetCommand.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Bindings } from './support/C7Bindings.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

/**
 * A called element, case or decision binding the engines do not know: one of a call activity or of
 * a business rule task with a decision that is not latest, deployment, version or versionTag.
 * Camunda 7 deploys the file but cannot resolve the reference as intended.
 *
 * @example an unknown binding
 * <bpmn:callActivity id="Ship" calledElement="shipping" camunda:calledElementBinding="newest" />  <!-- latest -->
 */
class C7BindingKnownRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    const attributes = new CamundaAttributes(node);
    const bindings = new C7Bindings(attributes);
    const prefix = C7Diagram.of(node).prefix;
    for (const { binding, allowed } of bindings.of(node).filter((candidate) => bindings.problemOf(candidate) === 'value')) {
      this.report(node, `${prefix}:${binding}="${attributes.defined(binding)}" on ${ElementKinds.describe(node)} is not one of ${allowed.join(', ')}; the engines accept the file but cannot resolve the reference as intended`, { path: [binding], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: binding, hint: `${new SetCommand(node.id).of(`${prefix}:${binding}=latest`)}.` });
    }
  }
}

export default defineRule({ ruleName: 'c7-binding-known', code: 'W_C7_BAD_VALUE', impact: 'runtime' }, C7BindingKnownRule);
