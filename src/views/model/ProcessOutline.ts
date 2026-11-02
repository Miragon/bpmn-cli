import { FlowOrder } from '../../checks/index.js';
import { ElementText, type BpmnDocument, type BpmnElement } from '../../model/index.js';
import { ElementAnnotations, ElementData, ElementFacts, ElementLinks, ElementSummaries, type ElementSummary, type Implementation, type ViewAnnotation, type ViewData } from '../facts/index.js';
import type { ElementRef, VendorFacts } from '../lines/index.js';

export interface ViewNode extends ElementSummary, VendorFacts {
  incoming: ElementRef[];
  boundary?: ViewNode[] | undefined;
  children?: ViewNode[] | undefined;
  expanded?: boolean | undefined;
  unreachable?: boolean | undefined;
  distance?: number | undefined;
  host?: ElementRef | undefined;
  content?: number | undefined;
  impl?: Implementation | undefined;
  from?: Array<ElementRef & { source: ElementRef }> | undefined;
}

export interface ViewLane extends ElementRef {
  members: ElementRef[];
  lanes?: ViewLane[] | undefined;
}

export interface ViewProcess extends ElementRef, VendorFacts {
  executable: boolean;
  participant?: ElementRef | undefined;
  lanes: ViewLane[];
  nodes: ViewNode[];
  data: ViewData[];
  annotations: ViewAnnotation[];
}

export class ProcessOutline {
  private readonly links: ElementLinks;
  private readonly data: ElementData;
  private readonly summaries: ElementSummaries;
  private readonly expansion: Map<string, boolean>;

  constructor(private readonly document: BpmnDocument) {
    this.links = new ElementLinks(document);
    this.data = new ElementData(document);
    this.summaries = new ElementSummaries(document);
    this.expansion = document.diagram.expansionState();
  }

  static sizeOf(nodes: readonly ViewNode[]): { nodes: number; flows: number } {
    const size = { nodes: nodes.length, flows: 0 };
    for (const node of nodes) {
      const inner = ProcessOutline.sizeOf([...(node.boundary ?? []), ...(node.children ?? [])]);
      size.nodes += inner.nodes;
      size.flows += inner.flows + node.outgoing.length;
    }
    return size;
  }

  static headerOf(document: BpmnDocument, process: BpmnElement): Omit<ViewProcess, 'lanes' | 'nodes' | 'data' | 'annotations'> {
    const facts = new ElementFacts(process);
    const participant = document.flows.participantOf(process);
    return {
      ...facts.ref(),
      executable: process.peek<boolean>('isExecutable') === true,
      participant: participant && new ElementFacts(participant).ref(),
      attrs: facts.vendorValues(),
      extensionElements: facts.extensionElements(),
    };
  }

  process(process: BpmnElement): ViewProcess {
    return {
      ...ProcessOutline.headerOf(this.document, process),
      lanes: process.list('laneSets').flatMap((laneSet) => this.lanes(laneSet)),
      nodes: this.nodes(process),
      data: this.dataIn(process),
      annotations: new ElementAnnotations(this.document).in(this.links.scopesWithin(process)),
    };
  }

  expanded(subProcess: BpmnElement): boolean {
    return this.expansion.get(ElementText.shownId(subProcess)) !== false;
  }

  private nodes(scope: BpmnElement): ViewNode[] {
    const { ordered, unreachable } = new FlowOrder(this.document, scope);
    return ordered.map((node) => this.node(node, unreachable));
  }

  private node(element: BpmnElement, unreachable: ReadonlySet<BpmnElement>): ViewNode {
    const facts = new ElementFacts(element);
    const isSubProcess = element.is('bpmn:SubProcess');
    const boundary = element.is('bpmn:Activity') ? this.document.scopes.boundaryEventsOf(element).map((event) => this.node(event, unreachable)) : [];
    return {
      ...this.summaries.summary(element),
      incoming: this.document.flows.incoming(element).map((flow) => new ElementFacts(flow).ref()),
      boundary: boundary.length ? boundary : undefined,
      children: isSubProcess ? this.nodes(element) : undefined,
      expanded: isSubProcess ? this.expanded(element) : undefined,
      unreachable: unreachable.has(element) ? true : undefined,
      attrs: facts.vendorValues(),
      extensionElements: facts.extensionElements(),
    };
  }

  private lanes(laneSet: BpmnElement | undefined): ViewLane[] {
    return (laneSet?.list('lanes') ?? []).map((lane) => {
      const nested = this.lanes(lane.peek<BpmnElement>('childLaneSet'));
      return { ...new ElementFacts(lane).ref(), members: lane.list('flowNodeRef').map((node) => new ElementFacts(node).ref()), lanes: nested.length ? nested : undefined };
    });
  }

  private dataIn(process: BpmnElement): ViewData[] {
    const users = this.data.nodesWithin(process).map((node) => ({ node, ...ElementData.of(node) }));
    const references = this.links.scopesWithin(process).flatMap((scope) => this.document.scopes.flowElements(scope)).filter((element) => element.is('bpmn:DataObjectReference') || element.is('bpmn:DataStoreReference'));
    return references.map((reference) => {
      const refsOf = (side: 'reads' | 'writes'): ElementRef[] => users.filter((user) => user[side].includes(reference)).map(({ node }) => ElementFacts.refOf(node));
      return { ...ElementData.empty(reference), from: refsOf('writes'), to: refsOf('reads') };
    });
  }
}
