/**
 * `bpmn show <file> --around <id>`: a header with what is shown and what was
 * left out, the process line, then the window's nodes in the grammar of
 * `show` (nested like there; a sub-process outside the window that holds
 * window nodes is a `in <kind> <id> "name":` heading); incoming flows from
 * outside the window follow `<-`. Then the message flows, annotations and
 * data of the window's nodes.
 */
import type { AroundNode, AroundScope, AroundView } from '../query/context.js';
import { truncate } from '../query/utils/view.js';
import { annotationLine, DOC_MAX, flowText, implementationFlags, INDENT, messageFlowLine, named, q, scalar } from './utils/view-lines.js';

export class AroundText {
  private readonly out: string[] = [];
  private readonly scopes: Map<string, AroundScope>;
  private readonly headed = new Set<string>();

  constructor(private readonly view: AroundView) {
    this.scopes = new Map(view.scopes.map((s) => [s.id, s]));
  }

  text(): string {
    const { view, out } = this;
    const { shown, omitted } = view;
    out.push(
      `around ${view.around} (depth ${view.depth}${view.inner ? ', inner' : ''}): ${shown.nodes} of ${shown.nodes + omitted.nodes} nodes, ${shown.flows} of ${shown.flows + omitted.flows} flows` +
        (omitted.nodes || omitted.flows ? `; ${omitted.nodes} nodes, ${omitted.flows} flows omitted` : ''),
    );
    const p = view.process;
    out.push(`process ${named(p.id, p.name)}${p.participant ? ` in ${named(p.participant, p.participantName)}` : ''}`);
    const shownIds = new Set(view.nodes.map((n) => n.id));
    for (const n of view.nodes) {
      this.heading(n.scope);
      const hostShown = !!n.host && shownIds.has(n.host);
      const parts = [n.kind, n.id];
      if (n.name) parts.push(q(n.name));
      const flags = AroundText.flags(n, hostShown);
      if (flags.length) parts.push(`[${flags.join(', ')}]`);
      let line = parts.join(' ');
      if (n.from?.length) line += ` <- ${n.from.map((f) => `${f.source} (${f.id}${f.name ? ` ${q(f.name)}` : ''})`).join(', ')}`;
      if (n.outgoing.length) line += ` -> ${n.outgoing.map(flowText).join(', ')}`;
      out.push(INDENT.repeat(this.level(n.scope) + 1 + (hostShown ? 1 : 0)) + line);
    }
    if (view.messageFlows.length) {
      out.push('message flows:');
      for (const mf of view.messageFlows) out.push(INDENT + messageFlowLine(mf));
    }
    if (view.annotations.length) {
      out.push('annotations:');
      for (const a of view.annotations) out.push(INDENT + annotationLine(a));
    }
    if (view.data.length) {
      out.push('data:');
      for (const d of view.data) {
        const links = [d.from.length ? `from ${d.from.join(', ')}` : '', d.to.length ? `to ${d.to.join(', ')}` : ''].filter(Boolean).join('; ');
        out.push(`${INDENT}${d.kind} ${named(d.id, d.name)}${links ? ` (${links})` : ''}`);
      }
    }
    return out.join('\n');
  }

  private level(id: string): number {
    const s = this.scopes.get(id);
    return s?.parent ? this.level(s.parent) + 1 : 0;
  }

  private heading(id: string): void {
    const s = this.scopes.get(id);
    if (!s || !s.parent || s.inWindow || this.headed.has(id)) return;
    this.heading(s.parent);
    this.headed.add(id);
    this.out.push(`${INDENT.repeat(this.level(id))}in ${s.kind} ${named(s.id, s.name)}${s.lane ? ` [lane=${s.lane}]` : ''}:`);
  }

  private static flags(n: AroundNode, hostShown: boolean): string[] {
    const flags: string[] = [];
    if (n.host && !hostShown) flags.push(`on ${n.host}`);
    if (n.lane) flags.push(`lane=${n.lane}`);
    if (n.trigger) flags.push(n.trigger);
    if (n.nonInterrupting) flags.push('non-interrupting');
    if (n.expanded !== undefined) flags.push(n.expanded ? 'expanded' : 'collapsed');
    if (n.content) flags.push(`content: ${n.content} node${n.content === 1 ? '' : 's'}`);
    for (const [k, v] of Object.entries(n.props ?? {})) flags.push(`${k}=${scalar(v)}`);
    flags.push(...implementationFlags(n.impl));
    if (n.documentation) flags.push(`doc: ${q(truncate(n.documentation, DOC_MAX))}`);
    return flags;
  }
}
