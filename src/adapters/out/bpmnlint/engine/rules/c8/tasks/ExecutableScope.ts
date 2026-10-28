import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { C8Events } from './C8Events.js';

/**
 * The part of a Camunda 8 diagram the engine checks element by element: the executable processes,
 * without the content of a transaction (refused as a whole), and the messages their events and
 * receive tasks wait for.
 */
export class ExecutableScope {
  private static readonly caughtByDefinitions = new WeakMap<object, Set<ModdleElement>>();

  /** Whether `node` is in an executable process and not inside a transaction. */
  static covers(node: ModdleElement): boolean {
    let ancestor = node;
    while (ancestor && !is(ancestor, 'bpmn:Process')) {
      ancestor = ancestor.$parent;
      if (ancestor && is(ancestor, 'bpmn:Transaction')) {
        return false;
      }
    }
    return ancestor?.isExecutable === true;
  }

  /** Whether Camunda 8 reads the extension elements of `host`: covered, or a message it waits for. */
  static coversHost(host: ModdleElement): boolean {
    return ExecutableScope.covers(host) || ExecutableScope.isCaughtMessage(host);
  }

  private static isCaughtMessage(node: ModdleElement): boolean {
    if (!is(node, 'bpmn:Message') || !node.$parent || !is(node.$parent, 'bpmn:Definitions')) {
      return false;
    }
    const definitions = node.$parent;
    let caught = ExecutableScope.caughtByDefinitions.get(definitions);
    if (!caught) {
      caught = ExecutableScope.caughtMessages(definitions);
      ExecutableScope.caughtByDefinitions.set(definitions, caught);
    }
    return caught.has(node);
  }

  private static caughtMessages(definitions: ModdleElement): Set<ModdleElement> {
    const caught = new Set<ModdleElement>();
    const executable = (definitions.rootElements ?? []).filter(
      (root: ModdleElement) => is(root, 'bpmn:Process') && root.isExecutable === true,
    );
    const pending: ModdleElement[] = [...executable];
    while (pending.length) {
      const container = pending.pop();
      for (const element of container.flowElements ?? []) {
        if (is(element, 'bpmn:Event') || is(element, 'bpmn:ReceiveTask')) {
          const message = C8Events.messageOf(element);
          if (message) {
            caught.add(message);
          }
        }
        if (element.flowElements) {
          pending.push(element);
        }
      }
    }
    return caught;
  }
}
