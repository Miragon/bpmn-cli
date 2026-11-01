import { BpmnError, Kinds, Triggers, type BpmnDocument, type BpmnElement } from '../../model/index.js';
import { FlowOrder } from '../../checks/index.js';

export interface NeighbourhoodWindow {
  process: BpmnElement;
  depth: number;
  distances: Map<BpmnElement, number>;
}

export class NeighbourhoodWalk {
  private static readonly DEFAULT_DEPTH = 1;

  constructor(private readonly document: BpmnDocument) {}

  private static seedsOf(element: BpmnElement, id: string): BpmnElement[] {
    if (element.is('bpmn:FlowNode')) {
      return [element];
    }
    if (element.is('bpmn:SequenceFlow')) {
      return [element.peek<BpmnElement>('sourceRef'), element.peek<BpmnElement>('targetRef')].filter((end): end is BpmnElement => !!end);
    }
    const isContainer = element.is('bpmn:Process') || element.is('bpmn:Participant') || element.is('bpmn:Lane');
    throw BpmnError.usage(`--around needs a flow node or a sequence flow; "${id}" is a ${Kinds.labelOrType(element)}`, {
      hint: isContainer ? 'Use `bpmn show <file> --in <id>` for a whole pool, process or lane.' : 'Pick a node it belongs to (`bpmn show <file> <id>` names it).',
    });
  }

  window(id: string, depth = NeighbourhoodWalk.DEFAULT_DEPTH): NeighbourhoodWindow {
    if (!Number.isInteger(depth) || depth < 0) {
      throw BpmnError.usage(`--depth must be a whole number >= 0, got ${String(depth)}`);
    }
    const element = this.document.tree.require(id);
    const seeds = NeighbourhoodWalk.seedsOf(element, id);
    const process = this.document.scopes.processOf(seeds[0] ?? element);
    if (!process) {
      throw BpmnError.usage(`"${id}" is in no process`);
    }
    const distances = new Map(seeds.map((seed) => [seed, 0]));
    let frontier = seeds;
    for (let step = 1; step <= depth && frontier.length; step++) {
      const next = frontier.flatMap((node) => this.neighbours(node)).filter((node) => node.is('bpmn:FlowNode') && !distances.has(node));
      next.forEach((node) => distances.set(node, step));
      frontier = [...new Set(next)];
    }
    return { process, depth, distances };
  }

  private isEntryOrExit(node: BpmnElement): boolean {
    const { flows } = this.document;
    return !node.is('bpmn:BoundaryEvent') && (flows.incoming(node).length === 0 || flows.outgoing(node).length === 0);
  }

  private neighbours(node: BpmnElement): BpmnElement[] {
    const { flows, scopes } = this.document;
    const scope = scopes.scopeOf(node);
    const host = node.is('bpmn:BoundaryEvent') ? node.peek<BpmnElement>('attachedToRef') : undefined;
    return [
      ...flows.outgoing(node).flatMap((flow) => flow.peek<BpmnElement>('targetRef') ?? []),
      ...flows.incoming(node).flatMap((flow) => flow.peek<BpmnElement>('sourceRef') ?? []),
      ...(node.is('bpmn:Activity') ? scopes.boundaryEventsOf(node) : []),
      ...(host ? [host] : []),
      ...this.linkPartners(node, scope),
      ...(scope?.is('bpmn:SubProcess') && this.isEntryOrExit(node) ? [scope] : []),
    ];
  }

  private linkPartners(node: BpmnElement, scope: BpmnElement | undefined): BpmnElement[] {
    const name = FlowOrder.linkNameOf(node);
    const isThrow = Triggers.isLinkThrow(node);
    if (!scope || !name || (!isThrow && !Triggers.isLinkCatch(node))) {
      return [];
    }
    const isPartner = isThrow ? Triggers.isLinkCatch : Triggers.isLinkThrow;
    return this.document.scopes.flowNodes(scope).filter((candidate) => isPartner(candidate) && FlowOrder.linkNameOf(candidate) === name);
  }
}
