import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { RuleKit } from '../RuleKit.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { WrittenModel } from '../support/WrittenModel.js';

/**
 * `zeebe:publishMessage` on a send task or a message throw or end event, which Camunda 8.9 checks
 * but does not run.
 * zeebe-bpmn-moddle does not define it, so the typed parse drops it and camunda-compat reports its
 * send task as one without an implementation (the engine run drops that report): the rule reads the
 * extension elements as the file writes them.
 *
 * - `c8-publish-implementation`: a zeebe:publishMessage next to a zeebe:taskDefinition.
 * - `c8-publish-message`: a zeebe:publishMessage without message reference or correlationKey.
 * - `c8-publish-unsupported`: any other zeebe:publishMessage, which deploys and does not run.
 *
 * @example a send task that publishes its message
 * <bpmn:sendTask id="Notify" messageRef="Message_Order">
 *   <bpmn:extensionElements><zeebe:publishMessage correlationKey="=orderId" /></bpmn:extensionElements>
 * </bpmn:sendTask>
 */
class C8PublishMessageRule extends C8Rule {
  private model!: WrittenModel;
  private prefix = 'zeebe';

  protected visit(node: ModdleElement): boolean | void {
    if (is(node, 'bpmn:Definitions')) return;
    if (!EngineScope.inExecutableProcess(node)) return false;
    const model = WrittenModel.of(node);
    const el = model?.written(node);
    if (!el) return;
    this.model = model!;
    this.prefix = this.model.file.namespaces.prefixOf(RuleKit.kit.ZEEBE.uri) ?? 'zeebe';
    if (is(el, 'bpmn:SendTask')) this.checkPublish(node, el, el);
    else if (is(el, 'bpmn:IntermediateThrowEvent') || is(el, 'bpmn:EndEvent')) {
      const definition = (el.eventDefinitions ?? []).find((candidate: ModdleElement) => is(candidate, 'bpmn:MessageEventDefinition'));
      if (definition) this.checkPublish(node, el, definition);
    }
  }

  private checkPublish(node: ModdleElement, el: ModdleElement, host: ModdleElement): void {
    const publish = this.zeebe(host, 'publishMessage')[0];
    if (!publish) return;
    const id: string = el.id;
    const writtenAt = this.model.position(el);
    const label = ElementKinds.describe(el);
    const name = `${this.prefix}:publishMessage`;
    const slot = host === el ? '' : 'definition.';
    if (this.zeebe(el, 'taskDefinition').length) {
      this.report('c8-publish-implementation', node, `${label} has both a ${this.prefix}:taskDefinition and a ${name}; Camunda 8 needs exactly one of them and refuses the file`, { path: null, type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, writtenAt, subject: 'impl:both', hint: `Keep one: \`bpmn ext remove <file> ${id} ${this.prefix}:taskDefinition\` (or \`bpmn ext remove <file> ${id} ${slot}${name}\`).` });
      return;
    }
    if (!host.messageRef) this.report('c8-publish-message', node, `${label} publishes no message (no message reference); Camunda 8 refuses the file`, { path: null, type: ERROR_TYPES.PROPERTY_REQUIRED, writtenAt, subject: 'publish:messageRef', hint: `\`bpmn set <file> ${id} message=<MessageName>\`.` });
    const correlationKey: string | undefined = publish.correlationKey;
    if (correlationKey === undefined || correlationKey === '') this.report('c8-publish-message', node, `The ${name} of ${label} has no correlationKey; Camunda 8 refuses the file`, { path: null, type: ERROR_TYPES.PROPERTY_REQUIRED, writtenAt, subject: 'publish:correlationKey', hint: `\`bpmn ext add <file> ${id} ${slot}${name} correlationKey==<expression>\`.` });
    const send = is(el, 'bpmn:SendTask');
    this.report('c8-publish-unsupported', node, `${label} publishes its message with ${name}: Camunda 8.9 accepts the file but does not run it (${send ? 'the instance gets an incident: only job worker send tasks are supported' : 'the event completes without sending anything'})`, { path: null, type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, writtenAt, subject: 'publishMessage', hint: `Use a job worker: \`bpmn ext remove <file> ${id} ${slot}${name}\`, then \`bpmn ext add <file> ${id} ${this.prefix}:taskDefinition type=<jobType>\`.` });
  }

  private zeebe(el: ModdleElement, local: string): ModdleElement[] {
    return (el.extensionElements?.values ?? []).filter((value: ModdleElement) => this.model.file.namespaces.uriOfElement(value) === RuleKit.kit.ZEEBE.uri && value.$type.slice(value.$type.indexOf(':') + 1) === local);
  }
}

export default defineRule(
  {
    ruleName: 'c8-publish-message',
    kind: 'engine-specific',
    targetEngine: 'c8',
    findings: {
      'c8-publish-implementation': ['W_C8_DEPLOY_IMPLEMENTATION', 'deploy'],
      'c8-publish-message': ['W_C8_DEPLOY_MESSAGE', 'deploy'],
      'c8-publish-unsupported': ['W_C8_UNSUPPORTED_IMPLEMENTATION', 'runtime'],
    },
  },
  C8PublishMessageRule,
);
