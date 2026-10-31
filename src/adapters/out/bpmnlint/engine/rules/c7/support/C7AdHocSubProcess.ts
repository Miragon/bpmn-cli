import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { C7FlowGraph } from './C7FlowGraph.js';

/** What connects an ad-hoc sub-process, which the engines do not run, and how to make it one they run. */
export class C7AdHocSubProcess {
  readonly incoming: ModdleElement[];
  readonly flows: ModdleElement[];
  readonly boundaryEvents: ModdleElement[];

  constructor(readonly node: ModdleElement) {
    const graph = C7FlowGraph.forElement(node);
    this.incoming = graph.incoming(node);
    this.flows = [...this.incoming, ...graph.outgoing(node)];
    this.boundaryEvents = graph.boundaryEvents(node);
  }

  get isConnected(): boolean {
    return this.flows.length > 0 || this.boundaryEvents.length > 0;
  }

  get retypeHint(): string {
    const { id } = this.node;
    return `Make it an embedded sub-process: \`bpmn retype <file> ${id} subProcess\`, then give its content a start event and flows (\`bpmn add <file> startEvent "<Name>" --in ${id}\`, \`bpmn connect <file> <fromId> <toId>\`)`;
  }
}
