import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ModdlePath } from '../support/ModdlePath.js';
import { Values } from '../support/Values.js';
import { C8FeelRule } from './C8FeelRule.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';
import { C8Host } from './support/C8Host.js';
import { ZeebeHint } from './support/ZeebeHint.js';

/**
 * The correlation key of a message a receive task or catch event waits for that is a static value
 * (a process start event correlates no key).
 * Camunda 8 evaluates the key as a FEEL expression when the instance subscribes and refuses the
 * file.
 *
 * @example a static correlation key
 * <bpmn:message id="Paid" name="Paid">
 *   <bpmn:extensionElements><zeebe:subscription correlationKey="orderId" /></bpmn:extensionElements>  <!-- =orderId -->
 * </bpmn:message>
 */
class C8CorrelationKeyNeedsFeelRule extends C8FeelRule {
  protected visit(el: ModdleElement): void {
    if (this.runs(el) && (is(el, 'bpmn:ReceiveTask') || this.catchesMessage(el))) {
      this.checkCorrelationKey(el);
    }
  }

  private catchesMessage(el: ModdleElement): boolean {
    const definition = is(el, 'bpmn:Event') ? C8EventDefinitions.definitionOf(el) : undefined;
    return !!definition && is(definition, 'bpmn:MessageEventDefinition') && is(el, 'bpmn:CatchEvent');
  }

  private checkCorrelationKey(el: ModdleElement): void {
    const holder = C8EventDefinitions.messageHolderOf(el);
    const message = holder?.messageRef;
    if (!message || !Values.hasName(message) || (is(el, 'bpmn:StartEvent') && is(el.$parent, 'bpmn:Process'))) {
      return;
    }
    const subscriptions = C8Host.valuesOf(message, 'zeebe:Subscription');
    const [subscription] = subscriptions;
    const key = subscription?.correlationKey;
    if (subscriptions.length !== 1 || !Values.nonEmpty(key) || Values.isFeel(key)) {
      return;
    }
    const site = { owner: el, holder: subscription, property: 'correlationKey', path: [...ModdlePath.between(el, holder), 'messageRef', ...ModdlePath.between(message, subscription), 'correlationKey'], related: message };
    this.reportAt(site, `The correlationKey "${key}" of message ${message.id} is a static value; Camunda 8 needs a FEEL expression (=${key.trim()}) and refuses the file`, ERROR_TYPES.EXPRESSION_REQUIRED, ZeebeHint.fix(message, subscription, { correlationKey: `=${key.trim()}` }));
  }
}

export default defineRule({ ruleName: 'c8-correlation-key-needs-feel', code: 'W_C8_DEPLOY_EXPRESSION', impact: 'deploy' }, C8CorrelationKeyNeedsFeelRule);
