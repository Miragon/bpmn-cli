import type { ViewAnnotation, ViewData } from '../facts/index.js';
import { ElementLine, FlowLine, Phrase, type ElementRef, type MessageFlowEnds } from '../lines/index.js';
import { ProcessOutline, type ViewLane, type ViewNode, type ViewProcess } from './ProcessOutline.js';

interface ViewParticipant extends ElementRef {
  process?: ElementRef | undefined;
}

export interface ViewCollaboration extends ElementRef {
  participants: ViewParticipant[];
  messageFlows: Array<ElementRef & MessageFlowEnds>;
  annotations?: ViewAnnotation[] | undefined;
}

export interface ViewGroup extends ElementRef {
  members: ElementRef[];
}

export interface ViewRoot extends ElementRef {
  code?: string | undefined;
  correlationKey?: string | undefined;
}

interface CutCount {
  shown: number;
  total: number;
}

export interface ModelCut {
  in?: ElementRef | undefined;
  around?: ElementRef | undefined;
  depth?: number | undefined;
  nodes: CutCount;
  flows: CutCount;
}

export interface ModelViewData {
  kind: 'model';
  file?: string | undefined;
  definitions: { id: string; targetNamespace?: string | undefined; namespaces: string[] };
  collaboration?: ViewCollaboration | undefined;
  processes: ViewProcess[];
  groups?: ViewGroup[] | undefined;
  rootElements: ViewRoot[];
  importWarnings?: string[] | undefined;
  cut?: ModelCut | undefined;
}

export class ModelViewText {
  private static readonly MAX_LINES = 150;
  private static readonly ANNOTATION_MAX = 120;

  private readonly out: string[] = [];

  constructor(private readonly view: ModelViewData) {}

  static dataLine(data: ViewData): string {
    const ids = (refs: ViewData['from']): string => refs.map(({ id }) => id).join(', ');
    const links = [...(data.from.length ? [`from ${ids(data.from)}`] : []), ...(data.to.length ? [`to ${ids(data.to)}`] : [])].join('; ');
    return `${new ElementLine(data).ref}${links ? ` (${links})` : ''}`;
  }

  static annotationLine({ id, text, attachedTo }: ViewAnnotation): string {
    const shown = text ? ` ${new Phrase(text).cutQuoted(ModelViewText.ANNOTATION_MAX)}` : '';
    return `${id}${shown}${attachedTo.length ? ` ~ ${attachedTo.map((end) => end.id).join(', ')}` : ''}`;
  }

  private static processHead(process: ViewProcess): string {
    const flags = ElementLine.vendorFlags(process);
    return `process ${new ElementLine(process).named} ${process.executable ? 'executable' : 'non-executable'}${process.participant ? ` in ${process.participant.id}` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
  }

  private static nodeLine(node: ViewNode): string {
    const line = new ElementLine(node).flagged(ElementLine.flagsOf(node, { vendor: ElementLine.vendorFlags(node) }));
    const flows = node.outgoing.length ? ` -> ${node.outgoing.map(FlowLine.outgoing).join(', ')}` : '';
    return `${node.unreachable ? '! unreachable: ' : ''}${line}${flows}`;
  }

  private static rootText(root: ViewRoot): string {
    const key = root.correlationKey !== undefined ? ` [correlationKey=${new Phrase(root.correlationKey).flag()}]` : '';
    return `${new ElementLine(root).ref}${root.code ? ` (${root.code})` : ''}${key}`;
  }

  private static groupLine(group: ViewGroup): string {
    return `${new ElementLine(group).named}: ${group.members.map(({ id }) => id).join(', ') || '(empty)'}`;
  }

  text(): string {
    const { view, out } = this;
    if (view.cut) {
      const { nodes, flows } = view.cut;
      out.push(`in ${view.cut.in?.id}: ${nodes.shown} of ${nodes.total} nodes, ${flows.shown} of ${flows.total} flows`);
    }
    out.push(...(view.importWarnings ?? []).map((warning) => `import: ${warning}`));
    if (view.definitions.namespaces.length) {
      out.push(`namespaces: ${view.definitions.namespaces.join(', ')}`);
    }
    if (view.collaboration) {
      this.collaboration(view.collaboration);
    }
    view.processes.forEach((process) => this.process(process));
    this.section('groups:', 0, (view.groups ?? []).map(ModelViewText.groupLine));
    if (view.rootElements.length) {
      out.push(`root: ${view.rootElements.map(ModelViewText.rootText).join(', ')}`);
    }
    return out.join('\n');
  }

  private get spent(): boolean {
    return this.out.length >= ModelViewText.MAX_LINES;
  }

  private collaboration({ id, participants, messageFlows, annotations }: ViewCollaboration): void {
    this.out.push(`collaboration ${id}`);
    this.section('', 1, participants.map((participant) => `participant ${new ElementLine(participant).named} ${participant.process ? `= ${participant.process.id}` : '(black box)'}`), 'participants');
    this.section('', 1, messageFlows.map(FlowLine.message), 'message flows');
    this.section('annotations:', 1, (annotations ?? []).map(ModelViewText.annotationLine));
  }

  private section(title: string, depth: number, lines: readonly string[], noun = title.replace(':', '')): void {
    if (!lines.length) {
      return;
    }
    const pad = ElementLine.INDENT.repeat(depth);
    const room = Math.max(0, ModelViewText.MAX_LINES - this.out.length - (title ? 1 : 0));
    if (room && title) {
      this.out.push(`${pad}${title}`);
    }
    this.out.push(...lines.slice(0, room).map((line) => `${pad}${title ? ElementLine.INDENT : ''}${line}`));
    if (lines.length > room) {
      this.out.push(`${pad}${noun}: ${lines.length - room} left out, --json lists them`);
    }
  }

  private process(process: ViewProcess): void {
    const { out } = this;
    const size = ProcessOutline.sizeOf(process.nodes).nodes;
    if (this.spent) {
      out.push(`${ModelViewText.processHead(process)}: ${size} nodes, show --in ${process.id}`);
      return;
    }
    out.push(ModelViewText.processHead(process));
    if (process.nodes.length) {
      this.nodes(process.nodes, 1, process);
    } else {
      out.push('  (empty)');
    }
    this.section('lanes:', 1, this.laneLines(process.lanes, 0));
    this.section('data:', 1, process.data.map(ModelViewText.dataLine));
    this.section('annotations:', 1, process.annotations.map(ModelViewText.annotationLine));
  }

  private nodes(nodes: readonly ViewNode[], depth: number, process: ViewProcess): void {
    for (const [index, node] of nodes.entries()) {
      if (this.spent) {
        this.leftOut(nodes.slice(index), depth, process);
        return;
      }
      this.node(node, depth, process);
    }
  }

  private node(node: ViewNode, depth: number, process: ViewProcess): void {
    const pad = ElementLine.INDENT.repeat(depth);
    const inner = ProcessOutline.sizeOf(node.children ?? []).nodes;
    const collapsed = inner > 0 && this.out.length + inner >= ModelViewText.MAX_LINES;
    this.out.push(`${pad}${ModelViewText.nodeLine(node)}${collapsed ? `: ${inner} nodes, show --in ${node.id}` : ''}`);
    this.nodes(node.boundary ?? [], depth + 1, process);
    if (!collapsed) {
      this.nodes(node.children ?? [], depth + 1, process);
    }
  }

  private leftOut(nodes: readonly ViewNode[], depth: number, process: ViewProcess): void {
    const byLane = new Map<string | undefined, number>();
    for (const node of nodes) {
      byLane.set(node.lane?.id, (byLane.get(node.lane?.id) ?? 0) + ProcessOutline.sizeOf([node]).nodes);
    }
    const total = ProcessOutline.sizeOf(process.nodes).nodes;
    for (const [lane, count] of byLane) {
      this.out.push(`${ElementLine.INDENT.repeat(depth)}${count} of ${total} nodes left out: ${lane ? `show --in ${lane}` : `find --in ${process.id}`}`);
    }
  }

  private laneLines(lanes: readonly ViewLane[], depth: number): string[] {
    return lanes.flatMap((lane) => {
      const empty = !lane.members.length && !lane.lanes?.length ? ' (empty)' : '';
      return [`${ElementLine.INDENT.repeat(depth)}${new ElementLine(lane).named}${empty}`, ...this.laneLines(lane.lanes ?? [], depth + 1)];
    });
  }
}
