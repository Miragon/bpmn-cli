import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { C7FlowGraph } from './C7FlowGraph.js';

/** The outgoing flows of an exclusive gateway as the engines read them: the default flow and the flows without condition besides it. */
export class C7ExclusiveGateway {
  readonly outgoing: ModdleElement[];
  readonly defaultFlow: ModdleElement | undefined;

  constructor(readonly node: ModdleElement) {
    this.outgoing = C7FlowGraph.forElement(node).outgoing(node);
    this.defaultFlow = node.default;
  }

  /** The flows that are neither the default flow nor have a condition. */
  unconditioned(): ModdleElement[] {
    return this.outgoing.filter((flow) => flow !== this.defaultFlow && !flow.conditionExpression);
  }
}
