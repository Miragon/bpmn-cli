import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { DiagramNamespaces } from '../../support/DiagramNamespaces.js';

/**
 * The sequence flows and boundary events of a diagram by the node they connect to, read from
 * `sourceRef`, `targetRef` and `attachedToRef`: the `incoming` / `outgoing` mirror lists are
 * optional in a file and a typed parse does not fill them in. Built once per diagram.
 */
export class C7FlowGraph {
  private static readonly byDefinitions = new WeakMap<object, C7FlowGraph>();

  private readonly incomingByNode = new Map<ModdleElement, ModdleElement[]>();
  private readonly outgoingByNode = new Map<ModdleElement, ModdleElement[]>();
  private readonly boundaryEventsByHost = new Map<ModdleElement, ModdleElement[]>();

  private constructor(definitions: ModdleElement) {
    for (const root of definitions?.rootElements ?? []) this.index(root);
  }

  /** The graph of the diagram `node` belongs to. */
  static forElement(node: ModdleElement): C7FlowGraph {
    const definitions = DiagramNamespaces.definitionsOf(node);
    const key = definitions ?? C7FlowGraph;
    let graph = C7FlowGraph.byDefinitions.get(key);
    if (!graph) {
      graph = new C7FlowGraph(definitions);
      C7FlowGraph.byDefinitions.set(key, graph);
    }
    return graph;
  }

  incoming(node: ModdleElement): ModdleElement[] {
    return this.incomingByNode.get(node) ?? [];
  }

  outgoing(node: ModdleElement): ModdleElement[] {
    return this.outgoingByNode.get(node) ?? [];
  }

  boundaryEvents(host: ModdleElement): ModdleElement[] {
    return this.boundaryEventsByHost.get(host) ?? [];
  }

  private index(container: ModdleElement): void {
    for (const element of container.flowElements ?? []) {
      if (is(element, 'bpmn:SequenceFlow')) {
        this.add(this.outgoingByNode, element.sourceRef, element);
        this.add(this.incomingByNode, element.targetRef, element);
      } else if (is(element, 'bpmn:BoundaryEvent')) {
        this.add(this.boundaryEventsByHost, element.attachedToRef, element);
      }
      this.index(element);
    }
  }

  private add(byNode: Map<ModdleElement, ModdleElement[]>, node: ModdleElement, element: ModdleElement): void {
    if (!node) return;
    const elements = byNode.get(node);
    if (elements) elements.push(element);
    else byNode.set(node, [element]);
  }
}
