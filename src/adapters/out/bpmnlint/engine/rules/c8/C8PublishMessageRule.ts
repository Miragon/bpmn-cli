import { is } from 'bpmnlint-utils';
import { C8Rule, type ModdleElement } from '../CamundaRule.js';
import { RuleKit } from '../RuleKit.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { WrittenModel } from '../support/WrittenModel.js';

/** A zeebe:publishMessage as the file writes it, with what a finding about it names. */
export interface Publish {
  /** the typed element the finding goes on */
  node: ModdleElement;
  /** the send task or the message definition that holds the zeebe:publishMessage */
  host: ModdleElement;
  publish: ModdleElement;
  id: string;
  writtenAt: number;
  label: string;
  name: string;
  slot: string;
  withTaskDefinition: boolean;
  send: boolean;
}

/**
 * `zeebe:publishMessage` on a send task or a message throw or end event, which Camunda 8.9 checks
 * but does not run, for the rules on it (`C8PublishMessageNoTaskDefinitionRule`,
 * `C8PublishMessageNeedsMessageRule`, `C8PublishMessageNeedsCorrelationKeyRule`,
 * `C8PublishMessageUnsupportedRule`).
 * zeebe-bpmn-moddle does not define it, so the typed parse drops it and camunda-compat reports its
 * send task as one without an implementation (the engine run drops that report): the rules read
 * the extension elements as the file writes them.
 *
 * @example a send task that publishes its message
 * <bpmn:sendTask id="Notify" messageRef="Message_Order">
 *   <bpmn:extensionElements><zeebe:publishMessage correlationKey="=orderId" /></bpmn:extensionElements>
 * </bpmn:sendTask>
 */
export abstract class C8PublishMessageRule extends C8Rule {
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
    if (is(el, 'bpmn:SendTask')) {
      this.checkHost(node, el, el);
    } else if (is(el, 'bpmn:IntermediateThrowEvent') || is(el, 'bpmn:EndEvent')) {
      const definition = (el.eventDefinitions ?? []).find((candidate: ModdleElement) => is(candidate, 'bpmn:MessageEventDefinition'));
      if (definition) this.checkHost(node, el, definition);
    }
  }

  private checkHost(node: ModdleElement, el: ModdleElement, host: ModdleElement): void {
    const publish = this.zeebe(host, 'publishMessage')[0];
    if (!publish) return;
    const name = `${this.prefix}:publishMessage`;
    this.checkPublish({ node, host, publish, id: el.id, writtenAt: this.model.position(el), label: ElementKinds.describe(el), name, slot: host === el ? '' : 'definition.', withTaskDefinition: this.zeebe(el, 'taskDefinition').length > 0, send: is(el, 'bpmn:SendTask') }, this.prefix);
  }

  protected abstract checkPublish(publish: Publish, prefix: string): void;

  private zeebe(el: ModdleElement, local: string): ModdleElement[] {
    return (el.extensionElements?.values ?? []).filter((value: ModdleElement) => this.model.file.namespaces.uriOfElement(value) === RuleKit.kit.ZEEBE.uri && value.$type.slice(value.$type.indexOf(':') + 1) === local);
  }
}
