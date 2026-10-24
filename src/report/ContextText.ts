/**
 * `bpmn show <file> <id> --context`: the element's line (kind, id, name, its
 * own facts), `implementation:` (vendor values, extension elements compact),
 * `message:` (a message element's message: id, name, correlation key), then
 * one line per context: `in:` (pool > process > sub-processes; a message
 * flow: its collaboration), `lane:`, `host:`, `from:` / `to:` (neighbours
 * with names and the connecting flow; a message flow's ends with their
 * pools), `boundary:` (its own), `caught by:` (every boundary event of the
 * sub-processes around it), `event sub-processes:`, `annotations:`,
 * `message flows:` (`(at pool P)`: a flow of its message drawn to its pool),
 * `used by:` (a message, signal, error, escalation), `reads:` / `writes:`;
 * lines without content are left out.
 */
import type { ContextCatch, ContextLink, ContextMessage, ContextRef, ElementContext } from '../query/context.js';
import { truncate } from '../query/utils/view.js';
import { detailMessageFlowText, DOC_MAX, flagValue, implementationFlags, named, q, scalar } from './utils/view-lines.js';

export class ContextText {
  constructor(private readonly c: ElementContext) {}

  text(): string {
    const c = this.c;
    const out: string[] = [];
    const flags: string[] = [];
    if (c.trigger) flags.push(c.trigger);
    if (c.nonInterrupting) flags.push('non-interrupting');
    for (const [k, v] of Object.entries(c.props ?? {})) flags.push(`${k}=${scalar(v)}`);
    if (c.documentation) flags.push(`doc: ${q(truncate(c.documentation, DOC_MAX))}`);
    out.push(`${c.kind} ${named(c.id, c.name)}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
    const impl = implementationFlags(c.implementation);
    if (impl.length) out.push(`implementation: ${impl.join(', ')}`);
    if (c.message) out.push(`message: ${ContextText.messageText(c.message)}`);
    const where = [...(c.pool ? [`participant ${named(c.pool.id, c.pool.name)}`] : []), ...c.ancestors.map(ContextText.refText)];
    if (where.length) out.push(`in: ${where.join(' > ')}`);
    if (c.lane) {
      const extra = [c.lane.via ? `via ${c.lane.via}` : '', c.lane.parents?.length ? `within ${c.lane.parents.map((l) => named(l.id, l.name)).join(' > ')}` : ''].filter(Boolean);
      out.push(`lane: ${named(c.lane.id, c.lane.name)}${extra.length ? ` (${extra.join('; ')})` : ''}`);
    }
    if (c.host) out.push(`host: ${ContextText.refText(c.host)}`);
    if (c.from.length) out.push(`from: ${c.from.map(ContextText.linkText).join('; ')}`);
    if (c.to.length) out.push(`to: ${c.to.map(ContextText.linkText).join('; ')}`);
    if (c.boundary.length) out.push(`boundary: ${c.boundary.map(ContextText.catchText).join('; ')}`);
    if (c.caughtBy.length) out.push(`caught by: ${c.caughtBy.map(ContextText.catchText).join('; ')}`);
    if (c.eventSubProcesses.length) {
      out.push(`event sub-processes: ${c.eventSubProcesses.map((e) => `${ContextText.refText(e)} in ${e.in}${e.start ? ` [${ContextText.catchText(e.start)}]` : ''}`).join('; ')}`);
    }
    if (c.annotations.length) out.push(`annotations: ${c.annotations.map((a) => `${a.id}${a.text ? ` ${q(truncate(a.text, 120))}` : ''}`).join('; ')}`);
    if (c.messageFlows.length) out.push(`message flows: ${c.messageFlows.map(detailMessageFlowText).join('; ')}`);
    if (c.usedBy?.length) out.push(`used by: ${c.usedBy.map(ContextText.refText).join('; ')}`);
    if (c.data?.reads?.length) out.push(`reads: ${c.data.reads.map((d) => named(d.id, d.name)).join(', ')}`);
    if (c.data?.writes?.length) out.push(`writes: ${c.data.writes.map((d) => named(d.id, d.name)).join(', ')}`);
    if (c.data?.readBy?.length) out.push(`read by: ${c.data.readBy.join(', ')}`);
    if (c.data?.writtenBy?.length) out.push(`written by: ${c.data.writtenBy.join(', ')}`);
    return out.join('\n');
  }

  private static refText(r: ContextRef): string {
    return `${r.kind} ${named(r.id, r.name)}`;
  }

  private static linkText(l: ContextLink): string {
    const flow = [l.flow];
    if (l.flowName) flow.push(q(l.flowName));
    if (l.condition) flow.push(`if ${truncate(l.condition, 120)}`);
    if (l.default) flow.push('default');
    return `${ContextText.refText(l)} (${flow.join(' ')})${l.pool ? ` in ${named(l.pool, l.poolName)}` : ''}`;
  }

  private static messageText(m: ContextMessage): string {
    return `${named(m.id, m.name)}${m.correlationKey !== undefined ? ` [correlationKey=${flagValue(m.correlationKey)}]` : ''}`;
  }

  private static catchText(c: ContextCatch): string {
    const flags = [c.trigger, c.nonInterrupting ? 'non-interrupting' : undefined].filter(Boolean);
    return `${ContextText.refText(c)}${c.on ? ` on ${c.on}` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}${c.to?.length ? ` -> ${c.to.join(', ')}` : ''}`;
  }
}
