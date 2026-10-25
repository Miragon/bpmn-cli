import type { ElementDetail, ViewFlow } from '../query/model-view.js';
import { truncate } from '../query/utils/view.js';
import { detailMessageFlowText, extensionLines, INDENT, named, q, scalar } from './utils/view-lines.js';

/** `bpmn show <id>` as `key: value` lines (property keys are `set` keys). */
export class DetailText {
  private readonly out: string[] = [];
  private readonly printed = new Set<string>();

  constructor(private readonly detail: ElementDetail) {}

  text(): string {
    const { detail, out, printed } = this;
    const head: Array<[string, string | undefined]> = [
      ['id', detail.id],
      ['kind', detail.kind],
      ['type', detail.type],
      ['name', detail.name],
      ['scope', detail.scope],
      ['process', detail.process],
      ['lane', detail.lane],
      ['host', detail.host],
    ];
    for (const [k, v] of head) {
      if (v === undefined) continue;
      out.push(`${k}: ${v}`);
      printed.add(k);
    }
    const deferred: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(detail.properties)) {
      if (v === undefined || v === null || v === '' || printed.has(k)) continue;
      if (k.includes(':')) {
        deferred.push([k, v]);
        continue;
      }
      out.push(`${k}: ${scalar(v)}`);
      printed.add(k);
    }
    if (detail.incoming.length) out.push(`incoming: ${detail.incoming.map(DetailText.incomingText).join('; ')}`);
    if (detail.outgoing.length) out.push(`outgoing: ${detail.outgoing.map(DetailText.outgoingText).join('; ')}`);
    if (detail.boundary?.length) out.push(`boundary: ${detail.boundary.join(', ')}`);
    if (detail.children?.length) out.push(`children: ${detail.children.join(', ')}`);
    if (detail.messageFlows?.length) out.push(`message flows: ${detail.messageFlows.map(detailMessageFlowText).join('; ')}`);
    if (detail.data?.reads?.length) out.push(`reads: ${detail.data.reads.map((d) => named(d.id, d.name)).join(', ')}`);
    if (detail.data?.writes?.length) out.push(`writes: ${detail.data.writes.map((d) => named(d.id, d.name)).join(', ')}`);
    if (detail.data?.readBy?.length) out.push(`read by: ${detail.data.readBy.join(', ')}`);
    if (detail.data?.writtenBy?.length) out.push(`written by: ${detail.data.writtenBy.join(', ')}`);
    if (detail.annotations?.length) out.push(`annotations: ${detail.annotations.map((a) => `${a.id}${a.text ? ` ${q(truncate(a.text, 120))}` : ''}`).join('; ')}`);
    if (detail.attachedTo?.length) out.push(`attached to: ${detail.attachedTo.join(', ')}`);
    if (detail.extensions.length) {
      out.push('extensions:');
      for (const ext of detail.extensions) out.push(...extensionLines(ext, INDENT));
    }
    for (const [k, v] of deferred) {
      out.push(`${k}: ${scalar(v)}`);
      printed.add(k);
    }
    for (const [k, v] of Object.entries(detail.attrs)) if (!printed.has(k)) out.push(`${k}: ${v}`);
    for (const [slot, n] of Object.entries(detail.nested ?? {})) {
      if (!n) continue;
      if (n.id && !printed.has(`${slot}.id`)) out.push(`${slot}.id: ${n.id}`);
      for (const [k, v] of Object.entries(n.attrs)) if (!printed.has(`${slot}.${k}`)) out.push(`${slot}.${k}: ${v}`);
      if (n.extensions.length) {
        out.push(`${slot}.extensions:`);
        for (const ext of n.extensions) out.push(...extensionLines(ext, INDENT));
      }
    }
    return out.join('\n');
  }

  private static incomingText(f: ElementDetail['incoming'][number] & { conditionResource?: string }): string {
    const parts = [f.id, 'from', f.source];
    if (f.name) parts.push(q(f.name));
    if (f.condition) parts.push(`if ${f.condition}`);
    else if (f.conditionResource) parts.push(`if resource ${f.conditionResource}`);
    if (f.default) parts.push('default');
    return parts.join(' ');
  }

  private static outgoingText(f: ViewFlow): string {
    const parts = [f.id, 'to', f.target];
    if (f.name) parts.push(q(f.name));
    if (f.condition) parts.push(`if ${f.condition}`);
    else if (f.conditionResource) parts.push(`if resource ${f.conditionResource}`);
    if (f.default) parts.push('default');
    return parts.join(' ');
  }
}
