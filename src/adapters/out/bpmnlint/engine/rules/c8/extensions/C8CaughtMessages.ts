import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

/**
 * The messages the executable processes of a diagram wait for or throw: those of their receive
 * tasks and of the message event definitions of their events. Camunda 8 reads their zeebe content.
 */
export class C8CaughtMessages {
  private static readonly byDefinitions = new WeakMap<object, C8CaughtMessages>();

  private readonly messages = new Set<ModdleElement>();

  private constructor(definitions: ModdleElement) {
    for (const root of definitions.rootElements ?? []) {
      if (is(root, 'bpmn:Process') && root.isExecutable === true) {
        this.collect(root);
      }
    }
  }

  /** Whether `message` is used by an executable process of its diagram. */
  static includes(message: ModdleElement): boolean {
    const definitions = message.$parent;
    if (!definitions || !is(definitions, 'bpmn:Definitions')) {
      return false;
    }
    let caught = C8CaughtMessages.byDefinitions.get(definitions);
    if (!caught) {
      caught = new C8CaughtMessages(definitions);
      C8CaughtMessages.byDefinitions.set(definitions, caught);
    }
    return caught.messages.has(message);
  }

  private collect(scope: ModdleElement): void {
    for (const node of scope.flowElements ?? []) {
      const message = this.messageOf(node);
      if (message) {
        this.messages.add(message);
      }
      if (node.flowElements) {
        this.collect(node);
      }
    }
  }

  private messageOf(node: ModdleElement): ModdleElement | undefined {
    if (is(node, 'bpmn:ReceiveTask')) {
      return node.messageRef;
    }
    if (!is(node, 'bpmn:Event')) {
      return undefined;
    }
    const definition = (node.eventDefinitions ?? []).find((eventDefinition: ModdleElement) =>
      is(eventDefinition, 'bpmn:MessageEventDefinition'),
    );
    return definition?.messageRef;
  }
}
