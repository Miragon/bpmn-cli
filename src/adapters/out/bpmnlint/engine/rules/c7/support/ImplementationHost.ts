import { is, isAny } from 'bpmnlint-utils';

import type { ModdleElement, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
import { ElementKinds } from '../../support/ElementKinds.js';
import { SetCommand } from '../../support/SetCommand.js';
import { Values } from '../../support/Values.js';
import { C7Diagram } from './C7Diagram.js';
import { C7EventDefinitions } from './C7EventDefinitions.js';
import { CamundaAttributes } from './CamundaAttributes.js';

const SERVICE_LIKE = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask'];
const THROW_EVENTS = ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'];

/**
 * Where Camunda 7 reads how work is implemented: a service, send or business rule task, or the
 * message definition of a message throw or end event. Reports go on the task or the event; `path`
 * leads from there to the host.
 */
export class ImplementationHost {
  readonly attributes: CamundaAttributes;
  /** The prefix the file writes camunda content with (`operaton` in an Operaton file). */
  readonly prefix: string;
  /** `bpmn set` on the host: the task, or the message definition through its event. */
  readonly command: SetCommand;

  private constructor(
    /** The task, or the event of a message definition. */
    readonly reported: ModdleElement,
    /** The task, or the message definition. */
    readonly element: ModdleElement,
    readonly path: ReportPath,
  ) {
    this.attributes = new CamundaAttributes(element);
    this.prefix = C7Diagram.of(reported).prefix;
    this.command = typeof path[1] === 'number' ? SetCommand.forDefinition(reported, path[1]) : new SetCommand(reported.id);
  }

  /** The implementation hosts of `node`: none, the task itself, or its read message definitions. */
  static forElement(node: ModdleElement): ImplementationHost[] {
    if (isAny(node, SERVICE_LIKE)) return [new ImplementationHost(node, node, [])];
    if (!isAny(node, THROW_EVENTS)) return [];
    return new C7EventDefinitions(node).indexedOfType('bpmn:MessageEventDefinition').map(({ definition, index }) => new ImplementationHost(node, definition, ['eventDefinitions', index]));
  }

  /** `serviceTask X`, or `endEvent X` for a message definition. */
  get label(): string {
    return ElementKinds.describe(this.reported);
  }

  get isEvent(): boolean {
    return this.reported !== this.element;
  }

  get readsDecisionRef(): boolean {
    return is(this.element, 'bpmn:BusinessRuleTask');
  }

  get type(): string | undefined {
    return this.attributes.defined('type');
  }

  get isExternal(): boolean {
    return this.type?.toLowerCase() === 'external';
  }

  get isShell(): boolean {
    return this.type?.toLowerCase() === 'shell';
  }

  /** Whether the engines find an implementation: a delegate, an external or shell task, a connector or a decision. */
  get hasImplementation(): boolean {
    return ['class', 'delegateExpression', 'expression'].some((local) => Values.nonEmpty(this.attributes.defined(local))) || this.isExternal || this.isShell || this.hasConnector() || (this.readsDecisionRef && this.attributes.defined('decisionRef') !== undefined);
  }

  /** The path from the reported element to `property` of the host. */
  pathTo(...property: ReportPath): ReportPath {
    return [...this.path, ...property];
  }

  /** The `camunda:Field` extension elements of the host, with their index in `values`. */
  fields(): Array<{ field: ModdleElement; index: number }> {
    return this.extensionValues(this.element).map((field, index) => ({ field, index })).filter(({ field }) => is(field, 'camunda:Field'));
  }

  private hasConnector(): boolean {
    return (this.isEvent ? [this.element, this.reported] : [this.element]).some((host) => this.extensionValues(host).some((value) => is(value, 'camunda:Connector')));
  }

  private extensionValues(host: ModdleElement): ModdleElement[] {
    return host.get('extensionElements')?.get('values') ?? [];
  }
}
