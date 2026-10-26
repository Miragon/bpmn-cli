import type { ModelView, ViewLane, ViewNode } from '../../../domain/views/model-view.js';
import { truncate } from '../../../domain/views/utils/view.js';
import { renderProblems } from './utils/result-lines.js';
import { annotationLine, DOC_MAX, flagValue, flowText, INDENT, messageFlowLine, quote, scalar, vendorFlags } from './utils/view-lines.js';

/**
 * The model view as text, the default output of `show`: one line per node with its flows inline
 * and every id visible, e.g. `userTask Activity_Check "Check" [lane=Lane_Sales] -> Gateway_Ok`.
 * Deterministic, compact, no coordinates.
 */
export class ModelViewText {
  private readonly out: string[] = [];

  constructor(private readonly view: ModelView) {}

  text(): string {
    const { view, out } = this;
    for (const warning of view.importWarnings ?? []) out.push(`import: ${warning}`);
    if (view.definitions.namespaces.length) out.push(`namespaces: ${view.definitions.namespaces.join(', ')}`);
    if (view.collaboration) {
      out.push(`collaboration ${view.collaboration.id}`);
      for (const participant of view.collaboration.participants) {
        out.push(`${INDENT}participant ${participant.id}${participant.name ? ` ${quote(participant.name)}` : ''} ${participant.process ? `= ${participant.process}` : '(black box)'}`);
      }
      for (const mf of view.collaboration.messageFlows) out.push(INDENT + messageFlowLine(mf));
      if (view.collaboration.annotations?.length) {
        out.push(`${INDENT}annotations:`);
        for (const annotation of view.collaboration.annotations) out.push(`${INDENT}${INDENT}${annotationLine(annotation)}`);
      }
    }
    for (const process of view.processes) {
      const flags = vendorFlags(process);
      out.push(`process ${process.id}${process.name ? ` ${quote(process.name)}` : ''} ${process.executable ? 'executable' : 'non-executable'}${process.participant ? ` in ${process.participant}` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
      if (process.nodes.length) this.nodes(process.nodes, 1);
      else out.push(`${INDENT}(empty)`);
      if (process.lanes.length) {
        out.push(`${INDENT}lanes:`);
        this.lanes(process.lanes, 2);
      }
      if (process.data.length) {
        out.push(`${INDENT}data:`);
        for (const data of process.data) {
          const links = [data.from.length ? `from ${data.from.join(', ')}` : '', data.to.length ? `to ${data.to.join(', ')}` : ''].filter(Boolean).join('; ');
          out.push(`${INDENT}${INDENT}${data.kind} ${data.id}${data.name ? ` ${quote(data.name)}` : ''}${links ? ` (${links})` : ''}`);
        }
      }
      if (process.annotations.length) {
        out.push(`${INDENT}annotations:`);
        for (const annotation of process.annotations) out.push(`${INDENT}${INDENT}${annotationLine(annotation)}`);
      }
    }
    if (view.groups?.length) {
      out.push('groups:');
      for (const group of view.groups) out.push(`${INDENT}${group.id}${group.name ? ` ${quote(group.name)}` : ''}: ${group.members.join(', ') || '(empty)'}`);
    }
    if (view.rootElements.length) {
      out.push(`root: ${view.rootElements.map((root) => `${root.kind} ${root.id}${root.name ? ` ${quote(root.name)}` : ''}${root.code ? ` (${root.code})` : ''}${root.correlationKey !== undefined ? ` [correlationKey=${flagValue(root.correlationKey)}]` : ''}`).join(', ')}`);
    }
    if (view.problems.length) {
      out.push('problems:');
      for (const line of renderProblems(view.problems).split('\n')) out.push(INDENT + line);
    } else {
      out.push('problems: none');
    }
    return out.join('\n');
  }

  private nodes(nodes: ViewNode[], depth: number): void {
    const pad = INDENT.repeat(depth);
    for (const node of nodes) {
      this.out.push(pad + ModelViewText.nodeLine(node));
      if (node.boundary?.length) this.nodes(node.boundary, depth + 1);
      if (node.children?.length) this.nodes(node.children, depth + 1);
    }
  }

  /** Names only: the members carry `lane=<id>` in their node line. */
  private lanes(lanes: ViewLane[], depth: number): void {
    const pad = INDENT.repeat(depth);
    for (const lane of lanes) {
      const empty = !lane.members.length && !lane.lanes?.length ? ' (empty)' : '';
      this.out.push(`${pad}${lane.id}${lane.name ? ` ${quote(lane.name)}` : ''}${empty}`);
      if (lane.lanes?.length) this.lanes(lane.lanes, depth + 1);
    }
  }

  private static nodeLine(node: ViewNode): string {
    const parts = [node.kind, node.id];
    if (node.name) parts.push(quote(node.name));
    const flags = ModelViewText.nodeFlags(node);
    if (flags.length) parts.push(`[${flags.join(', ')}]`);
    let line = parts.join(' ');
    if (node.outgoing.length) line += ` -> ${node.outgoing.map(flowText).join(', ')}`;
    return node.unreachable ? `! unreachable: ${line}` : line;
  }

  private static nodeFlags(node: ViewNode): string[] {
    const flags: string[] = [];
    if (node.lane) flags.push(`lane=${node.lane}`);
    if (node.trigger) flags.push(node.trigger);
    if (node.nonInterrupting) flags.push('non-interrupting');
    if (node.expanded !== undefined) flags.push(node.expanded ? 'expanded' : 'collapsed');
    for (const [key, value] of Object.entries(node.props ?? {})) flags.push(`${key}=${scalar(value)}`);
    flags.push(...vendorFlags(node));
    if (node.documentation) flags.push(`doc: ${quote(truncate(node.documentation, DOC_MAX))}`);
    return flags;
  }
}
