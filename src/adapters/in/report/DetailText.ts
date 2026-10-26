import type { ElementDetail, ViewFlow } from '../../../domain/views/model-view.js';
import { truncate } from '../../../domain/views/utils/view.js';
import { detailMessageFlowText, extensionLines, INDENT, named, quote, scalar } from './utils/view-lines.js';

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
    for (const [key, value] of head) {
      if (value === undefined) continue;
      out.push(`${key}: ${value}`);
      printed.add(key);
    }
    const deferred: Array<[string, unknown]> = [];
    for (const [key, value] of Object.entries(detail.properties)) {
      if (value === undefined || value === null || value === '' || printed.has(key)) continue;
      if (key.includes(':')) {
        deferred.push([key, value]);
        continue;
      }
      out.push(`${key}: ${scalar(value)}`);
      printed.add(key);
    }
    if (detail.incoming.length) out.push(`incoming: ${detail.incoming.map(DetailText.incomingText).join('; ')}`);
    if (detail.outgoing.length) out.push(`outgoing: ${detail.outgoing.map(DetailText.outgoingText).join('; ')}`);
    if (detail.boundary?.length) out.push(`boundary: ${detail.boundary.join(', ')}`);
    if (detail.children?.length) out.push(`children: ${detail.children.join(', ')}`);
    if (detail.messageFlows?.length) out.push(`message flows: ${detail.messageFlows.map(detailMessageFlowText).join('; ')}`);
    if (detail.data?.reads?.length) out.push(`reads: ${detail.data.reads.map((data) => named(data.id, data.name)).join(', ')}`);
    if (detail.data?.writes?.length) out.push(`writes: ${detail.data.writes.map((data) => named(data.id, data.name)).join(', ')}`);
    if (detail.data?.readBy?.length) out.push(`read by: ${detail.data.readBy.join(', ')}`);
    if (detail.data?.writtenBy?.length) out.push(`written by: ${detail.data.writtenBy.join(', ')}`);
    if (detail.annotations?.length) out.push(`annotations: ${detail.annotations.map((annotation) => `${annotation.id}${annotation.text ? ` ${quote(truncate(annotation.text, 120))}` : ''}`).join('; ')}`);
    if (detail.attachedTo?.length) out.push(`attached to: ${detail.attachedTo.join(', ')}`);
    if (detail.extensions.length) {
      out.push('extensions:');
      for (const ext of detail.extensions) out.push(...extensionLines(ext, INDENT));
    }
    for (const [key, value] of deferred) {
      out.push(`${key}: ${scalar(value)}`);
      printed.add(key);
    }
    for (const [key, value] of Object.entries(detail.attrs)) if (!printed.has(key)) out.push(`${key}: ${value}`);
    for (const [slot, nestedDetail] of Object.entries(detail.nested ?? {})) {
      if (!nestedDetail) continue;
      if (nestedDetail.id && !printed.has(`${slot}.id`)) out.push(`${slot}.id: ${nestedDetail.id}`);
      for (const [key, value] of Object.entries(nestedDetail.attrs)) if (!printed.has(`${slot}.${key}`)) out.push(`${slot}.${key}: ${value}`);
      if (nestedDetail.extensions.length) {
        out.push(`${slot}.extensions:`);
        for (const ext of nestedDetail.extensions) out.push(...extensionLines(ext, INDENT));
      }
    }
    return out.join('\n');
  }

  private static incomingText(flow: ElementDetail['incoming'][number] & { conditionResource?: string }): string {
    const parts = [flow.id, 'from', flow.source];
    if (flow.name) parts.push(quote(flow.name));
    if (flow.condition) parts.push(`if ${flow.condition}`);
    else if (flow.conditionResource) parts.push(`if resource ${flow.conditionResource}`);
    if (flow.default) parts.push('default');
    return parts.join(' ');
  }

  private static outgoingText(flow: ViewFlow): string {
    const parts = [flow.id, 'to', flow.target];
    if (flow.name) parts.push(quote(flow.name));
    if (flow.condition) parts.push(`if ${flow.condition}`);
    else if (flow.conditionResource) parts.push(`if resource ${flow.conditionResource}`);
    if (flow.default) parts.push('default');
    return parts.join(' ');
  }
}
