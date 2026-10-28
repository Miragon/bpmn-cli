import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

/**
 * Where the Camunda 7 engines run content: executable processes, but not the content of an ad-hoc
 * sub-process, which they skip like a non-executable process.
 */
export class C7ExecutableScope {
  /** Whether the engines run `node`: it is in an executable process and in no ad-hoc sub-process. */
  static contains(node: ModdleElement): boolean {
    for (let ancestor = node; ancestor; ancestor = ancestor.$parent) {
      if (is(ancestor, 'bpmn:AdHocSubProcess')) {
        return false;
      }
      if (is(ancestor, 'bpmn:Process')) {
        return ancestor.isExecutable === true;
      }
    }
    return false;
  }

  /** The process or sub-process whose flow elements hold `node`. */
  static scopeOf(node: ModdleElement): ModdleElement | undefined {
    for (let ancestor = node.$parent; ancestor; ancestor = ancestor.$parent) {
      if (is(ancestor, 'bpmn:Process') || is(ancestor, 'bpmn:SubProcess')) {
        return ancestor;
      }
    }
    return undefined;
  }

  static isEventSubProcess(node: ModdleElement): boolean {
    return !!node && is(node, 'bpmn:SubProcess') && node.triggeredByEvent === true;
  }
}
