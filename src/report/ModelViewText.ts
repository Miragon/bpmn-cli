import type { ModelView, ViewLane, ViewNode } from '../query/model-view.js';
import { truncate } from '../query/utils/view.js';
import { renderProblems } from './utils/result-lines.js';
import { annotationLine, DOC_MAX, flagValue, flowText, INDENT, messageFlowLine, q, scalar, vendorFlags } from './utils/view-lines.js';

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
    for (const w of view.importWarnings ?? []) out.push(`import: ${w}`);
    if (view.definitions.namespaces.length) out.push(`namespaces: ${view.definitions.namespaces.join(', ')}`);
    if (view.collaboration) {
      out.push(`collaboration ${view.collaboration.id}`);
      for (const p of view.collaboration.participants) {
        out.push(`${INDENT}participant ${p.id}${p.name ? ` ${q(p.name)}` : ''} ${p.process ? `= ${p.process}` : '(black box)'}`);
      }
      for (const mf of view.collaboration.messageFlows) out.push(INDENT + messageFlowLine(mf));
      if (view.collaboration.annotations?.length) {
        out.push(`${INDENT}annotations:`);
        for (const a of view.collaboration.annotations) out.push(`${INDENT}${INDENT}${annotationLine(a)}`);
      }
    }
    for (const p of view.processes) {
      const flags = vendorFlags(p);
      out.push(`process ${p.id}${p.name ? ` ${q(p.name)}` : ''} ${p.executable ? 'executable' : 'non-executable'}${p.participant ? ` in ${p.participant}` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
      if (p.nodes.length) this.nodes(p.nodes, 1);
      else out.push(`${INDENT}(empty)`);
      if (p.lanes.length) {
        out.push(`${INDENT}lanes:`);
        this.lanes(p.lanes, 2);
      }
      if (p.data.length) {
        out.push(`${INDENT}data:`);
        for (const d of p.data) {
          const links = [d.from.length ? `from ${d.from.join(', ')}` : '', d.to.length ? `to ${d.to.join(', ')}` : ''].filter(Boolean).join('; ');
          out.push(`${INDENT}${INDENT}${d.kind} ${d.id}${d.name ? ` ${q(d.name)}` : ''}${links ? ` (${links})` : ''}`);
        }
      }
      if (p.annotations.length) {
        out.push(`${INDENT}annotations:`);
        for (const a of p.annotations) out.push(`${INDENT}${INDENT}${annotationLine(a)}`);
      }
    }
    if (view.groups?.length) {
      out.push('groups:');
      for (const g of view.groups) out.push(`${INDENT}${g.id}${g.name ? ` ${q(g.name)}` : ''}: ${g.members.join(', ') || '(empty)'}`);
    }
    if (view.rootElements.length) {
      out.push(`root: ${view.rootElements.map((r) => `${r.kind} ${r.id}${r.name ? ` ${q(r.name)}` : ''}${r.code ? ` (${r.code})` : ''}${r.correlationKey !== undefined ? ` [correlationKey=${flagValue(r.correlationKey)}]` : ''}`).join(', ')}`);
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
    for (const n of nodes) {
      this.out.push(pad + ModelViewText.nodeLine(n));
      if (n.boundary?.length) this.nodes(n.boundary, depth + 1);
      if (n.children?.length) this.nodes(n.children, depth + 1);
    }
  }

  /** Names only: the members carry `lane=<id>` in their node line. */
  private lanes(lanes: ViewLane[], depth: number): void {
    const pad = INDENT.repeat(depth);
    for (const lane of lanes) {
      const empty = !lane.members.length && !lane.lanes?.length ? ' (empty)' : '';
      this.out.push(`${pad}${lane.id}${lane.name ? ` ${q(lane.name)}` : ''}${empty}`);
      if (lane.lanes?.length) this.lanes(lane.lanes, depth + 1);
    }
  }

  private static nodeLine(n: ViewNode): string {
    const parts = [n.kind, n.id];
    if (n.name) parts.push(q(n.name));
    const flags = ModelViewText.nodeFlags(n);
    if (flags.length) parts.push(`[${flags.join(', ')}]`);
    let line = parts.join(' ');
    if (n.outgoing.length) line += ` -> ${n.outgoing.map(flowText).join(', ')}`;
    return n.unreachable ? `! unreachable: ${line}` : line;
  }

  private static nodeFlags(n: ViewNode): string[] {
    const flags: string[] = [];
    if (n.lane) flags.push(`lane=${n.lane}`);
    if (n.trigger) flags.push(n.trigger);
    if (n.nonInterrupting) flags.push('non-interrupting');
    if (n.expanded !== undefined) flags.push(n.expanded ? 'expanded' : 'collapsed');
    for (const [k, v] of Object.entries(n.props ?? {})) flags.push(`${k}=${scalar(v)}`);
    flags.push(...vendorFlags(n));
    if (n.documentation) flags.push(`doc: ${q(truncate(n.documentation, DOC_MAX))}`);
    return flags;
  }
}
