import type { BpmnDocument, BpmnElement } from '../../model/index.js';
import { ElementContainer, ElementFacts, ElementLinks, type ViewAnnotation, type ViewData } from '../facts/index.js';
import type { ElementRef } from '../lines/index.js';
import type { ModelCut, ModelViewData } from './ModelViewText.js';
import { ProcessOutline, type ViewLane, type ViewNode, type ViewProcess } from './ProcessOutline.js';

export class OutlineCut {
  private readonly container: ElementContainer;
  private readonly links: ElementLinks;

  constructor(
    private readonly document: BpmnDocument,
    id: string,
  ) {
    this.container = new ElementContainer(document, id);
    this.links = new ElementLinks(document);
  }

  private static idsOf(nodes: readonly ViewNode[]): string[] {
    return nodes.flatMap((node) => [node.id, ...OutlineCut.idsOf([...(node.boundary ?? []), ...(node.children ?? [])])]);
  }

  private static laneNamed(lanes: readonly ViewLane[], id: string): ViewLane[] {
    return lanes.flatMap((lane) => (lane.id === id ? [lane] : OutlineCut.laneNamed(lane.lanes ?? [], id)));
  }

  private static touching(refs: readonly ElementRef[], shown: ReadonlySet<string>): boolean {
    return refs.some(({ id }) => shown.has(id));
  }

  of(whole: ModelViewData): ModelViewData {
    const { process } = this.container;
    const outlined = whole.processes.filter(({ id }) => id === process.id).map((viewed) => this.cut(viewed));
    const shown = new Set([process.id, ...this.pool(), ...outlined.flatMap(({ nodes }) => OutlineCut.idsOf(nodes))]);
    const collaboration = whole.collaboration && {
      ...whole.collaboration,
      participants: whole.collaboration.participants.filter(({ process: drawn }) => drawn?.id === process.id),
      messageFlows: whole.collaboration.messageFlows.filter(({ source, target }) => shown.has(source.id) || shown.has(target.id)),
      annotations: whole.collaboration.annotations?.filter(({ attachedTo }) => OutlineCut.touching(attachedTo, shown)),
    };
    const groups = (whole.groups ?? []).filter(({ members }) => members.some(({ id }) => this.holdsId(id)));
    return { ...whole, collaboration, processes: outlined, groups: groups.length ? groups : undefined, cut: this.cutOf(whole, outlined) };
  }

  private pool(): string[] {
    const pool = this.links.poolOf(this.container.process);
    return pool ? [pool.id] : [];
  }

  private holdsId(id: string): boolean {
    const element = this.document.tree.byId(id);
    return !!element && this.container.holds(element);
  }

  private cut(process: ViewProcess): ViewProcess {
    const { element, isLane } = this.container;
    if (element.is('bpmn:Process')) {
      return process;
    }
    const nodes = this.kept(process.nodes, element);
    const shown = new Set(OutlineCut.idsOf(nodes));
    const data = process.data.filter(({ from, to }: ViewData) => OutlineCut.touching([...from, ...to], shown));
    const annotations = process.annotations.filter(({ attachedTo }: ViewAnnotation) => OutlineCut.touching(attachedTo, shown));
    return { ...process, lanes: isLane ? OutlineCut.laneNamed(process.lanes, element.id) : [], nodes, data, annotations };
  }

  private kept(nodes: readonly ViewNode[], element: BpmnElement): ViewNode[] {
    return nodes.flatMap((node) => (node.id === element.id || this.holdsId(node.id) ? [node] : this.kept(node.children ?? [], element)));
  }

  private cutOf(whole: ModelViewData, outlined: readonly ViewProcess[]): ModelCut {
    const [shown, total] = [outlined, whole.processes].map((processes) => ProcessOutline.sizeOf(processes.flatMap(({ nodes }) => nodes))) as [ReturnType<typeof ProcessOutline.sizeOf>, ReturnType<typeof ProcessOutline.sizeOf>];
    return { in: new ElementFacts(this.container.element).ref(), nodes: { shown: shown.nodes, total: total.nodes }, flows: { shown: shown.flows, total: total.flows } };
  }
}
