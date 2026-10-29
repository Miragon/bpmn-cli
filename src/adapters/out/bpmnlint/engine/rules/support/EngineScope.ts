import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

/** Where an engine runs content: executable processes, without the content of the sub-process kind it skips (Camunda 7: an ad-hoc sub-process; Camunda 8: a transaction, refused as a whole). */
export class EngineScope {
  static readonly C7 = new EngineScope('bpmn:AdHocSubProcess');
  static readonly C8 = new EngineScope('bpmn:Transaction');

  private constructor(private readonly skipped: string) {}

  /** Whether `node` is in (or is) an executable process and inside no skipped sub-process; the skipped one itself counts. */
  runs(node: ModdleElement): boolean {
    let ancestor = node;
    while (ancestor && !is(ancestor, 'bpmn:Process')) {
      ancestor = ancestor.$parent;
      if (ancestor && is(ancestor, this.skipped)) return false;
    }
    return ancestor?.isExecutable === true;
  }

  /** Whether the engine runs `node`, a skipped sub-process not. */
  contains(node: ModdleElement): boolean {
    return !is(node, this.skipped) && this.runs(node);
  }

  /** Whether `node` is (in) an executable process, wherever in it: what camunda-compat checks. */
  static inExecutableProcess(node: ModdleElement): boolean {
    let process = node;
    while (process && !is(process, 'bpmn:Process')) process = process.$parent;
    return process?.isExecutable === true;
  }

  /** The process or sub-process whose flow elements hold `node`. */
  static scopeOf(node: ModdleElement): ModdleElement | undefined {
    for (let ancestor = node.$parent; ancestor; ancestor = ancestor.$parent) if (is(ancestor, 'bpmn:Process') || is(ancestor, 'bpmn:SubProcess')) return ancestor;
    return undefined;
  }

  static isEventSubProcess(node: ModdleElement): boolean {
    return !!node && is(node, 'bpmn:SubProcess') && node.triggeredByEvent === true;
  }
}
