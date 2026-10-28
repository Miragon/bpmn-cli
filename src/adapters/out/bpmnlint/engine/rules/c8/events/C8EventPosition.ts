import { is, isAny } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

/**
 * Where an element sits as Camunda 8 reads it: in an executable process (a transaction's content
 * is not read, the engine refuses the transaction as a whole), in which (sub-)process, and the one
 * event definition of an event the engine goes on to check.
 */
export class C8EventPosition {
  /** Whether `node` is (in) an executable process and neither is nor sits in a transaction. */
  static isExecutable(node: ModdleElement): boolean {
    for (let ancestor = node; ancestor; ancestor = ancestor.$parent) {
      if (is(ancestor, 'bpmn:Transaction')) {
        return false;
      }
      if (is(ancestor, 'bpmn:Process')) {
        return ancestor.get('isExecutable') === true;
      }
    }
    return false;
  }

  /** Whether `node` is (in) an executable process, wherever in it: what camunda-compat checks. */
  static isInExecutableProcess(node: ModdleElement): boolean {
    for (let ancestor = node; ancestor; ancestor = ancestor.$parent) {
      if (is(ancestor, 'bpmn:Process')) {
        return ancestor.get('isExecutable') === true;
      }
    }
    return false;
  }

  /**
   * Where a report on an event definition goes: on its event, with the path to the definition, or
   * on the definition itself when no event holds it (a root element).
   */
  static definitionOwner(definition: ModdleElement): {
    owner: ModdleElement;
    path: (string | number)[];
  } {
    const event = definition.$parent;
    if (event && is(event, 'bpmn:Event')) {
      return {
        owner: event,
        path: ['eventDefinitions', event.get('eventDefinitions').indexOf(definition)],
      };
    }
    return { owner: definition, path: [] };
  }

  /** The event's definition when it is its only one and of `type`. */
  static onlyDefinition(event: ModdleElement, type: string): ModdleElement | undefined {
    const definitions = event.get('eventDefinitions') ?? [];
    return definitions.length === 1 && is(definitions[0], type) ? definitions[0] : undefined;
  }

  static isEventSubProcess(el: ModdleElement): boolean {
    return !!el && is(el, 'bpmn:SubProcess') && el.get('triggeredByEvent') === true;
  }

  /** A start event of an embedded sub-process (not an event or ad-hoc sub-process). */
  static isEmbeddedSubProcessStart(event: ModdleElement): boolean {
    const parent = event.$parent;
    return (
      is(event, 'bpmn:StartEvent') &&
      is(parent, 'bpmn:SubProcess') &&
      !C8EventPosition.isEventSubProcess(parent) &&
      !isAny(parent, ['bpmn:AdHocSubProcess', 'bpmn:Transaction'])
    );
  }

  /** The (sub-)process an element is in. */
  static scopeOf(el: ModdleElement): ModdleElement | undefined {
    for (let ancestor = el.$parent; ancestor; ancestor = ancestor.$parent) {
      if (isAny(ancestor, ['bpmn:Process', 'bpmn:SubProcess'])) {
        return ancestor;
      }
    }
    return undefined;
  }

  /**
   * The event definition Camunda 8 checks further: the only one of the event, unless the event has
   * none or several, or sits where the engine refuses it outright (a cancel event, a triggered
   * start of an embedded sub-process, a compensation start of an event sub-process).
   */
  static checkedDefinition(event: ModdleElement): ModdleElement | undefined {
    const definitions = event.get('eventDefinitions') ?? [];
    if (definitions.length !== 1) {
      return undefined;
    }
    const [definition] = definitions;
    const refused =
      is(definition, 'bpmn:CancelEventDefinition') ||
      C8EventPosition.isEmbeddedSubProcessStart(event) ||
      (is(event, 'bpmn:StartEvent') &&
        C8EventPosition.isEventSubProcess(event.$parent) &&
        is(definition, 'bpmn:CompensateEventDefinition'));
    return refused ? undefined : definition;
  }

  /** The checked definition of `event` when it is of `type`. */
  static definitionOfType(event: ModdleElement, type: string): ModdleElement | undefined {
    const definition = C8EventPosition.checkedDefinition(event);
    return definition && is(definition, type) ? definition : undefined;
  }
}
