import { is } from 'bpmnlint-utils';
import { C7Rule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { FirstOfKey } from '../support/FirstOfKey.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';

/**
 * The base of the Camunda 7 rules on message and signal subscriptions with one name in one engine
 * scope: a rule names the `kind`. The scopes are the start events of a process; the event
 * sub-process starts of a scope with the boundary events on it; the boundary events of one
 * activity with its own receive-task message (multi-instance: separate scopes).
 * Camunda 7 refuses to deploy a file with two subscriptions of one name in a scope.
 *
 * @example two boundary events of one task waiting for the same message
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:messageEventDefinition messageRef="Cancel" /></bpmn:boundaryEvent>
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:messageEventDefinition messageRef="Cancel" /></bpmn:boundaryEvent>  <!-- same message -->
 */
export abstract class C7SubscriptionUniqueRule extends C7Rule {
  protected abstract readonly kind: 'message' | 'signal';

  protected visit(node: ModdleElement): void {
    if (is(node, 'bpmn:Process') && EngineScope.C7.contains(node)) {
      this.checkSubscriptions(node);
    }
  }

  private checkSubscriptions(scope: ModdleElement, firsts = new FirstOfKey<ModdleElement>()): void {
    const { kind } = this;
    for (const node of scope.flowElements ?? []) {
      if (kind === 'message' && is(node, 'bpmn:ReceiveTask')) {
        this.checkSubscription(firsts, node, `scope:${node.id}`, node.messageRef?.name, ['messageRef']);
      }
      const subscriptionScope = this.subscriptionScope(node);
      const definitions = new C7EventDefinitions(node);
      const definition = subscriptionScope ? definitions.ofType(`bpmn:${kind.charAt(0).toUpperCase()}${kind.slice(1)}EventDefinition`) : undefined;
      if (definition) {
        this.checkSubscription(firsts, node, subscriptionScope!, definition.get(`${kind}Ref`)?.name, definitions.pathTo(definition, `${kind}Ref`));
      }
      if (is(node, 'bpmn:SubProcess') && !is(node, 'bpmn:AdHocSubProcess')) {
        this.checkSubscriptions(node, firsts);
      }
    }
  }

  private checkSubscription(firsts: FirstOfKey<ModdleElement>, el: ModdleElement, scope: string, name: string | undefined, path: (string | number)[]): void {
    const { kind } = this;
    const first = name ? firsts.repeats(`${scope}\u0000${name}`, el) : undefined;
    if (!first) return;
    this.report(el, `${ElementKinds.describe(el)} waits for ${kind} "${name}" like ${first.id} in the same scope; the engines refuse two ${kind} subscriptions with one name`, { path, type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, duplicatedProperty: 'name', duplicatedPropertyValue: name, first, hint: `Use another ${kind}: \`bpmn set <file> ${el.id} ${kind}=<OtherName>\`.` });
  }

  private subscriptionScope(node: ModdleElement): string | undefined {
    if (is(node, 'bpmn:StartEvent')) {
      if (is(node.$parent, 'bpmn:Process')) return `start:${node.$parent.id}`;
      return EngineScope.isEventSubProcess(node.$parent) ? `scope:${EngineScope.scopeOf(node.$parent)?.id}` : undefined;
    }
    if (!is(node, 'bpmn:BoundaryEvent') || !node.attachedToRef) return undefined;
    const loop = node.attachedToRef.loopCharacteristics;
    return `${loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics') ? 'body' : 'scope'}:${node.attachedToRef.id}`;
  }
}
