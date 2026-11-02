import { ElementLine, FlowLine, Phrase } from '../lines/index.js';
import { ModelViewText, type ModelViewData, type ViewNode, type ViewProcess } from '../model/index.js';

export class NeighbourhoodViewText {
  private static readonly IMPLEMENTATION_VALUE_MAX = 120;

  private readonly out: string[] = [];

  constructor(private readonly view: ModelViewData) {}

  private static flags(node: ViewNode, hostShown: boolean): string[] {
    const attrs = Object.entries(node.impl?.attrs ?? {}).map(([key, value]) => `${key}=${new Phrase(value).flag(NeighbourhoodViewText.IMPLEMENTATION_VALUE_MAX)}`);
    return ElementLine.flagsOf(node, {
      leading: node.host && !hostShown ? [`on ${node.host.id}`] : [],
      afterState: node.content ? [`content: ${node.content} node${node.content === 1 ? '' : 's'}`] : [],
      vendor: [...attrs, ...(node.impl?.ext ?? [])],
    });
  }

  private static nodeLine(node: ViewNode, hostShown: boolean): string {
    const from = node.from?.length ? ` <- ${node.from.map((flow) => `${flow.source.id} (${[flow.id, ...new FlowLine(flow).traits()].join(' ')})`).join(', ')}` : '';
    const to = node.outgoing.length ? ` -> ${node.outgoing.map(FlowLine.outgoing).join(', ')}` : '';
    return `${new ElementLine(node).flagged(NeighbourhoodViewText.flags(node, hostShown))}${from}${to}`;
  }

  text(): string {
    const { view, out } = this;
    const { cut } = view;
    const [process] = view.processes as [ViewProcess];
    const { nodes, flows } = cut!;
    const omitted = [nodes.total - nodes.shown, flows.total - flows.shown];
    const left = omitted.some(Boolean) ? `; ${omitted[0]} nodes, ${omitted[1]} flows omitted` : '';
    out.push(`around ${cut?.around?.id} (depth ${cut?.depth}): ${nodes.shown} of ${nodes.total} nodes, ${flows.shown} of ${flows.total} flows${left}`);
    out.push(`process ${new ElementLine(process).named}${process.participant ? ` in ${new ElementLine(process.participant).named}` : ''}`);
    process.nodes.forEach((node) => this.node(node, 1));
    this.section('message flows:', (view.collaboration?.messageFlows ?? []).map(FlowLine.message));
    this.section('annotations:', process.annotations.map(ModelViewText.annotationLine));
    this.section('data:', process.data.map(ModelViewText.dataLine));
    return out.join('\n');
  }

  private section(title: string, lines: readonly string[]): void {
    if (lines.length) {
      this.out.push(title, ...lines.map((line) => `${ElementLine.INDENT}${line}`));
    }
  }

  private node(node: ViewNode, depth: number): void {
    const pad = ElementLine.INDENT.repeat(depth);
    if (node.distance === undefined) {
      this.out.push(`${pad}in ${new ElementLine(node).ref}${node.lane ? ` [lane=${node.lane.id}]` : ''}:`);
    } else {
      this.out.push(`${pad}${NeighbourhoodViewText.nodeLine(node, false)}`);
    }
    node.boundary?.forEach((event) => this.out.push(`${ElementLine.INDENT.repeat(depth + 1)}${NeighbourhoodViewText.nodeLine(event, true)}`));
    node.children?.forEach((child) => this.node(child, depth + 1));
  }
}
