import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

/** How Camunda 8 reads the trigger of an event and the message of an element. */
export class C8Events {
  /**
   * The one event definition Camunda 8 checks an event by. None for an event with several (refused
   * as a whole) and for a triggered start event of an embedded sub-process (refused for that).
   */
  static definitionOf(event: ModdleElement): ModdleElement | undefined {
    const definitions: ModdleElement[] = event.eventDefinitions ?? [];
    if (definitions.length !== 1) {
      return undefined;
    }
    if (is(event, 'bpmn:StartEvent') && C8Events.isEmbeddedSubProcess(event.$parent)) {
      return undefined;
    }
    return definitions[0];
  }

  /** The element that references the message: the task itself, or its first message event definition. */
  static messageHolderOf(el: ModdleElement): ModdleElement | undefined {
    if (is(el, 'bpmn:ReceiveTask') || is(el, 'bpmn:SendTask')) {
      return el;
    }
    return (el.eventDefinitions ?? []).find((definition: ModdleElement) =>
      is(definition, 'bpmn:MessageEventDefinition'),
    );
  }

  /** The message a task or event sends or waits for. */
  static messageOf(el: ModdleElement): ModdleElement | undefined {
    return C8Events.messageHolderOf(el)?.messageRef;
  }

  private static isEmbeddedSubProcess(parent: ModdleElement): boolean {
    return (
      !!parent &&
      is(parent, 'bpmn:SubProcess') &&
      parent.triggeredByEvent !== true &&
      !is(parent, 'bpmn:AdHocSubProcess')
    );
  }
}
