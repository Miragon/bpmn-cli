import { is, isAny } from 'bpmnlint-utils';

import type { ModdleElement, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
import { EngineScope } from '../../support/EngineScope.js';

/** How Camunda 8 reads events: the one event definition it checks an event by, where a report on a definition goes, and the messages the executable processes use. */
export class C8EventDefinitions {
  private static readonly usedByDefinitions = new WeakMap<object, Set<ModdleElement>>();

  /**
   * The event definition Camunda 8 checks further: the only one of the event, unless the event has
   * none or several, or sits where the engine refuses it outright (a cancel event, a triggered
   * start of an embedded sub-process, a compensation start of an event sub-process).
   */
  static definitionOf(event: ModdleElement): ModdleElement | undefined {
    const definitions = event.get('eventDefinitions') ?? [];
    if (definitions.length !== 1) return undefined;
    const [definition] = definitions;
    const refused = is(definition, 'bpmn:CancelEventDefinition') || C8EventDefinitions.isEmbeddedSubProcessStart(event) || (is(event, 'bpmn:StartEvent') && EngineScope.isEventSubProcess(event.$parent) && is(definition, 'bpmn:CompensateEventDefinition'));
    return refused ? undefined : definition;
  }

  /** The checked definition of `event` when it is of `type`. */
  static definitionOfType(event: ModdleElement, type: string): ModdleElement | undefined {
    const definition = C8EventDefinitions.definitionOf(event);
    return definition && is(definition, type) ? definition : undefined;
  }

  /** The event's definition when it is its only one and of `type`. */
  static onlyDefinition(event: ModdleElement, type: string): ModdleElement | undefined {
    const definitions = event.get('eventDefinitions') ?? [];
    return definitions.length === 1 && is(definitions[0], type) ? definitions[0] : undefined;
  }

  /** A start event of an embedded sub-process (not an event or ad-hoc sub-process, not a transaction). */
  static isEmbeddedSubProcessStart(event: ModdleElement): boolean {
    const parent = event.$parent;
    return is(event, 'bpmn:StartEvent') && is(parent, 'bpmn:SubProcess') && !EngineScope.isEventSubProcess(parent) && !isAny(parent, ['bpmn:AdHocSubProcess', 'bpmn:Transaction']);
  }

  /** Where a report on an event definition goes: on its event, with the path to the definition, or on the definition itself when no event holds it (a root element). */
  static definitionOwner(definition: ModdleElement): { owner: ModdleElement; path: ReportPath } {
    const event = definition.$parent;
    if (event && is(event, 'bpmn:Event')) {
      return { owner: event, path: ['eventDefinitions', event.get('eventDefinitions').indexOf(definition)] };
    }
    return { owner: definition, path: [] };
  }

  /** The element that references the message: a receive or send task itself, or the first message event definition of an event. */
  static messageHolderOf(el: ModdleElement): ModdleElement | undefined {
    if (is(el, 'bpmn:ReceiveTask') || is(el, 'bpmn:SendTask')) return el;
    return (el.eventDefinitions ?? []).find((definition: ModdleElement) => is(definition, 'bpmn:MessageEventDefinition'));
  }

  /** The message a task or event sends or waits for. */
  static messageOf(el: ModdleElement): ModdleElement | undefined {
    return C8EventDefinitions.messageHolderOf(el)?.messageRef;
  }

  /** Whether `node` is a message an event or receive task of an executable process of its diagram uses: Camunda 8 reads its zeebe content. */
  static isUsedMessage(node: ModdleElement): boolean {
    const definitions = node.$parent;
    if (!is(node, 'bpmn:Message') || !definitions || !is(definitions, 'bpmn:Definitions')) {
      return false;
    }
    let used = C8EventDefinitions.usedByDefinitions.get(definitions);
    if (!used) {
      C8EventDefinitions.usedByDefinitions.set(definitions, (used = C8EventDefinitions.usedMessages(definitions)));
    }
    return used.has(node);
  }

  private static usedMessages(definitions: ModdleElement): Set<ModdleElement> {
    const used = new Set<ModdleElement>();
    const pending: ModdleElement[] = (definitions.rootElements ?? []).filter((root: ModdleElement) => is(root, 'bpmn:Process') && root.isExecutable === true);
    while (pending.length) {
      for (const element of pending.pop().flowElements ?? []) {
        const message = is(element, 'bpmn:Event') || is(element, 'bpmn:ReceiveTask') ? C8EventDefinitions.messageOf(element) : undefined;
        if (message) used.add(message);
        if (element.flowElements) pending.push(element);
      }
    }
    return used;
  }
}
