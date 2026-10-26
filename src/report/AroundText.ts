import type { AroundNode, AroundScope, AroundView } from '../query/context.js';
import { truncate } from '../query/utils/view.js';
import { annotationLine, DOC_MAX, flowText, implementationFlags, INDENT, messageFlowLine, named, quote, scalar } from './utils/view-lines.js';

/**
 * `bpmn show <file> --around <id>`: a header with what is shown and left out, then the window's
 * nodes in the grammar of `show`, incoming flows from outside after `<-`.
 */
export class AroundText {
  private readonly out: string[] = [];
  private readonly scopes: Map<string, AroundScope>;
  private readonly headed = new Set<string>();

  constructor(private readonly view: AroundView) {
    this.scopes = new Map(view.scopes.map((scope) => [scope.id, scope]));
  }

  text(): string {
    const { view, out } = this;
    const { shown, omitted } = view;
    out.push(
      `around ${view.around} (depth ${view.depth}${view.inner ? ', inner' : ''}): ${shown.nodes} of ${shown.nodes + omitted.nodes} nodes, ${shown.flows} of ${shown.flows + omitted.flows} flows` +
        (omitted.nodes || omitted.flows ? `; ${omitted.nodes} nodes, ${omitted.flows} flows omitted` : ''),
    );
    const process = view.process;
    out.push(`process ${named(process.id, process.name)}${process.participant ? ` in ${named(process.participant, process.participantName)}` : ''}`);
    const shownIds = new Set(view.nodes.map((node) => node.id));
    for (const node of view.nodes) {
      this.heading(node.scope);
      const hostShown = !!node.host && shownIds.has(node.host);
      const parts = [node.kind, node.id];
      if (node.name) parts.push(quote(node.name));
      const flags = AroundText.flags(node, hostShown);
      if (flags.length) parts.push(`[${flags.join(', ')}]`);
      let line = parts.join(' ');
      if (node.from?.length) line += ` <- ${node.from.map((flow) => `${flow.source} (${flow.id}${flow.name ? ` ${quote(flow.name)}` : ''})`).join(', ')}`;
      if (node.outgoing.length) line += ` -> ${node.outgoing.map(flowText).join(', ')}`;
      out.push(INDENT.repeat(this.level(node.scope) + 1 + (hostShown ? 1 : 0)) + line);
    }
    if (view.messageFlows.length) {
      out.push('message flows:');
      for (const mf of view.messageFlows) out.push(INDENT + messageFlowLine(mf));
    }
    if (view.annotations.length) {
      out.push('annotations:');
      for (const annotation of view.annotations) out.push(INDENT + annotationLine(annotation));
    }
    if (view.data.length) {
      out.push('data:');
      for (const data of view.data) {
        const links = [data.from.length ? `from ${data.from.join(', ')}` : '', data.to.length ? `to ${data.to.join(', ')}` : ''].filter(Boolean).join('; ');
        out.push(`${INDENT}${data.kind} ${named(data.id, data.name)}${links ? ` (${links})` : ''}`);
      }
    }
    return out.join('\n');
  }

  private level(id: string): number {
    const scope = this.scopes.get(id);
    return scope?.parent ? this.level(scope.parent) + 1 : 0;
  }

  private heading(id: string): void {
    const scope = this.scopes.get(id);
    if (!scope || !scope.parent || scope.inWindow || this.headed.has(id)) return;
    this.heading(scope.parent);
    this.headed.add(id);
    this.out.push(`${INDENT.repeat(this.level(id))}in ${scope.kind} ${named(scope.id, scope.name)}${scope.lane ? ` [lane=${scope.lane}]` : ''}:`);
  }

  private static flags(node: AroundNode, hostShown: boolean): string[] {
    const flags: string[] = [];
    if (node.host && !hostShown) flags.push(`on ${node.host}`);
    if (node.lane) flags.push(`lane=${node.lane}`);
    if (node.trigger) flags.push(node.trigger);
    if (node.nonInterrupting) flags.push('non-interrupting');
    if (node.expanded !== undefined) flags.push(node.expanded ? 'expanded' : 'collapsed');
    if (node.content) flags.push(`content: ${node.content} node${node.content === 1 ? '' : 's'}`);
    for (const [key, value] of Object.entries(node.props ?? {})) flags.push(`${key}=${scalar(value)}`);
    flags.push(...implementationFlags(node.impl));
    if (node.documentation) flags.push(`doc: ${quote(truncate(node.documentation, DOC_MAX))}`);
    return flags;
  }
}
