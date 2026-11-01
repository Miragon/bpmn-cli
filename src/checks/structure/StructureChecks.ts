import { type BpmnDocument, type BpmnElement, ElementText, type Finding, Kinds, MirrorLists } from '../../model/index.js';
import { EventChecks } from './EventChecks.js';
import { FlowChecks } from './FlowChecks.js';
import { FlowOrder } from './FlowOrder.js';
import { LaneChecks } from './LaneChecks.js';
import { ReferenceChecks } from './ReferenceChecks.js';
import { ScopeChecks } from './ScopeChecks.js';
import { StructureFindings } from './StructureFindings.js';

export class StructureChecks {
  private readonly findings = new StructureFindings();
  private readonly flows: FlowChecks;
  private readonly events: EventChecks;
  private readonly lanes: LaneChecks;
  private readonly scopes: ScopeChecks;

  constructor(private readonly document: BpmnDocument) {
    this.flows = new FlowChecks(document, this.findings);
    this.events = new EventChecks(document, this.findings);
    this.lanes = new LaneChecks(document, this.findings);
    this.scopes = new ScopeChecks(document, this.findings);
  }

  all(): Finding[] {
    const references = new ReferenceChecks(this.document, this.findings);
    new MirrorLists(this.document.tree.definitions).complete();
    references.checkDuplicateIds();
    references.checkReferences();
    references.checkRoots();
    for (const scope of this.allScopes()) {
      this.checkScope(scope);
    }
    this.flows.checkMessageFlows();
    this.scopes.checkDuplicateNames();
    return this.findings.all;
  }

  private checkScope(scope: BpmnElement): void {
    for (const element of this.document.scopes.flowElements(scope)) {
      this.checkFlowElement(element, scope);
    }
    if (scope.is('bpmn:Process')) {
      this.lanes.checkLanes(scope);
    }
    this.scopes.checkScope(scope, new FlowOrder(this.document, scope));
  }

  private checkFlowElement(element: BpmnElement, scope: BpmnElement): void {
    const rejected = Kinds.REJECTED_TYPES[element.type];
    if (rejected) {
      const id = ElementText.shownId(element);
      this.findings.error('E_UNSUPPORTED_KIND', `${element.type} ${id} is not supported: ${rejected}`, id, { hint: `Remove it: \`bpmn remove <file> ${id}\`.` });
    }
    if (element.is('bpmn:SequenceFlow')) {
      this.flows.checkSequenceFlow(element, scope);
    }
    if (element.is('bpmn:FlowNode')) {
      this.checkFlowNode(element, scope);
    }
  }

  private checkFlowNode(node: BpmnElement, scope: BpmnElement): void {
    this.flows.checkFlowLinks(node);
    this.flows.checkDefaultFlow(node);
    if (node.is('bpmn:Event')) {
      this.events.checkEvent(node, scope);
    }
    if (node.is('bpmn:BoundaryEvent')) {
      this.events.checkBoundaryEvent(node, scope);
    }
    if (Kinds.isEventSubProcess(node)) {
      this.events.checkEventSubProcess(node);
    }
  }

  private allScopes(): BpmnElement[] {
    return [...this.document.tree.walk()].filter((element) => element.is('bpmn:Process') || element.is('bpmn:SubProcess'));
  }
}
