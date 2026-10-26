import type { ContextCatch, ContextLink, ContextMessage, ContextRef, ElementContext } from '../../../domain/views/context.js';
import { truncate } from '../../../domain/views/utils/view.js';
import { detailMessageFlowText, DOC_MAX, flagValue, implementationFlags, named, quote, scalar } from './utils/view-lines.js';

/**
 * `bpmn show <file> <id> --context`: the element's line, then one line per context
 * (`in:`, `lane:`, `from:` / `to:`, `caught by:`, ...); lines without content are left out.
 */
export class ContextText {
  constructor(private readonly context: ElementContext) {}

  text(): string {
    const context = this.context;
    const out: string[] = [];
    const flags: string[] = [];
    if (context.trigger) flags.push(context.trigger);
    if (context.nonInterrupting) flags.push('non-interrupting');
    for (const [key, value] of Object.entries(context.props ?? {})) flags.push(`${key}=${scalar(value)}`);
    if (context.documentation) flags.push(`doc: ${quote(truncate(context.documentation, DOC_MAX))}`);
    out.push(`${context.kind} ${named(context.id, context.name)}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
    const impl = implementationFlags(context.implementation);
    if (impl.length) out.push(`implementation: ${impl.join(', ')}`);
    if (context.message) out.push(`message: ${ContextText.messageText(context.message)}`);
    const where = [...(context.pool ? [`participant ${named(context.pool.id, context.pool.name)}`] : []), ...context.ancestors.map(ContextText.refText)];
    if (where.length) out.push(`in: ${where.join(' > ')}`);
    if (context.lane) {
      const extra = [context.lane.via ? `via ${context.lane.via}` : '', context.lane.parents?.length ? `within ${context.lane.parents.map((lane) => named(lane.id, lane.name)).join(' > ')}` : ''].filter(Boolean);
      out.push(`lane: ${named(context.lane.id, context.lane.name)}${extra.length ? ` (${extra.join('; ')})` : ''}`);
    }
    if (context.host) out.push(`host: ${ContextText.refText(context.host)}`);
    if (context.from.length) out.push(`from: ${context.from.map(ContextText.linkText).join('; ')}`);
    if (context.to.length) out.push(`to: ${context.to.map(ContextText.linkText).join('; ')}`);
    if (context.boundary.length) out.push(`boundary: ${context.boundary.map(ContextText.catchText).join('; ')}`);
    if (context.caughtBy.length) out.push(`caught by: ${context.caughtBy.map(ContextText.catchText).join('; ')}`);
    if (context.eventSubProcesses.length) {
      out.push(`event sub-processes: ${context.eventSubProcesses.map((eventSubProcess) => `${ContextText.refText(eventSubProcess)} in ${eventSubProcess.in}${eventSubProcess.start ? ` [${ContextText.catchText(eventSubProcess.start)}]` : ''}`).join('; ')}`);
    }
    if (context.annotations.length) out.push(`annotations: ${context.annotations.map((annotation) => `${annotation.id}${annotation.text ? ` ${quote(truncate(annotation.text, 120))}` : ''}`).join('; ')}`);
    if (context.messageFlows.length) out.push(`message flows: ${context.messageFlows.map(detailMessageFlowText).join('; ')}`);
    if (context.usedBy?.length) out.push(`used by: ${context.usedBy.map(ContextText.refText).join('; ')}`);
    if (context.data?.reads?.length) out.push(`reads: ${context.data.reads.map((data) => named(data.id, data.name)).join(', ')}`);
    if (context.data?.writes?.length) out.push(`writes: ${context.data.writes.map((data) => named(data.id, data.name)).join(', ')}`);
    if (context.data?.readBy?.length) out.push(`read by: ${context.data.readBy.join(', ')}`);
    if (context.data?.writtenBy?.length) out.push(`written by: ${context.data.writtenBy.join(', ')}`);
    return out.join('\n');
  }

  private static refText(ref: ContextRef): string {
    return `${ref.kind} ${named(ref.id, ref.name)}`;
  }

  private static linkText(link: ContextLink): string {
    const flow = [link.flow];
    if (link.flowName) flow.push(quote(link.flowName));
    if (link.condition) flow.push(`if ${truncate(link.condition, 120)}`);
    if (link.default) flow.push('default');
    return `${ContextText.refText(link)} (${flow.join(' ')})${link.pool ? ` in ${named(link.pool, link.poolName)}` : ''}`;
  }

  private static messageText(message: ContextMessage): string {
    return `${named(message.id, message.name)}${message.correlationKey !== undefined ? ` [correlationKey=${flagValue(message.correlationKey)}]` : ''}`;
  }

  private static catchText(caught: ContextCatch): string {
    const flags = [caught.trigger, caught.nonInterrupting ? 'non-interrupting' : undefined].filter(Boolean);
    return `${ContextText.refText(caught)}${caught.on ? ` on ${caught.on}` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}${caught.to?.length ? ` -> ${caught.to.join(', ')}` : ''}`;
  }
}
