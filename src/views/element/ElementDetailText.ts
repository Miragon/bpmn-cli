import type { DataLinks, ExtensionInfo, PartnerFlow } from '../facts/index.js';
import { ElementLine, ExtensionLine, FlowLine, Phrase, type ElementRef, type FlowTraits } from '../lines/index.js';
import type { ElementCatch, EventSubProcessCatch } from './ElementCatches.js';
import type { ElementMessage } from './ElementMessages.js';

export interface ElementLink extends ElementRef {
  flow: ElementRef & FlowTraits;
  pool?: ElementRef | undefined;
}

export interface ElementLane extends ElementRef {
  via?: ElementRef | undefined;
  parents?: ElementRef[] | undefined;
}

export interface ElementDetailData {
  kind: 'element';
  element: ElementRef;
  ancestors: ElementRef[];
  pool?: ElementRef | undefined;
  lane?: ElementLane | undefined;
  host?: ElementCatch | undefined;
  from?: ElementLink[] | undefined;
  to?: ElementLink[] | undefined;
  boundary: ElementCatch[];
  caughtBy: ElementCatch[];
  eventSubProcesses: EventSubProcessCatch[];
  children?: ElementRef[] | undefined;
  members?: ElementRef[] | undefined;
  message?: ElementMessage | undefined;
  messageFlows: PartnerFlow[];
  usedBy?: ElementRef[] | undefined;
  data?: DataLinks | undefined;
  annotations: Array<{ id: string; text?: string | undefined }>;
  attachedTo?: ElementRef[] | undefined;
  attrs: Record<string, unknown>;
  extensions: ExtensionInfo[];
}

export class ElementDetailText {
  private static readonly ANNOTATION_MAX = 120;

  constructor(private readonly detail: ElementDetailData) {}

  private static named(element: ElementRef): string {
    return new ElementLine(element).named;
  }

  private static ids(elements: readonly ElementRef[] | undefined): string {
    return (elements ?? []).map(ElementDetailText.named).join(', ');
  }

  private static link(link: ElementLink): string {
    const flow = [link.flow.id, ...new FlowLine(link.flow).traits(true)].join(' ');
    return `${link.id} (${flow})${link.pool ? ` in ${ElementDetailText.named(link.pool)}` : ''}`;
  }

  private static caught(caught: ElementCatch): string {
    const facts = [caught.trigger, caught.nonInterrupting ? 'non-interrupting' : undefined].filter(Boolean).join(', ');
    return `${caught.id}${facts ? ` (${facts})` : ''}${caught.on ? ` on ${caught.on.id}` : ''}${caught.to?.length ? ` -> ${caught.to.map(({ id }) => id).join(', ')}` : ''}`;
  }

  private static eventSubProcess(host: EventSubProcessCatch): string {
    return `${host.id} in ${host.in.id}${host.start ? ` [${ElementDetailText.caught(host.start)}]` : ''}`;
  }

  private static partnerFlow(flow: PartnerFlow): string {
    const pool = flow.pool ? ` in ${ElementDetailText.named(flow.pool)}` : '';
    return `${flow.direction} ${ElementDetailText.named(flow)} ${flow.direction === 'out' ? '->' : '<-'} ${ElementDetailText.named(flow.partner)}${pool}${flow.message ? ` [message ${flow.message}]` : ''}${flow.at ? ` (at pool ${flow.at})` : ''}`;
  }

  private static attr([key, value]: [string, unknown]): string {
    const text = ElementLine.scalar(value);
    return `${key}=${/\s/.test(text) ? new Phrase(text).quoted : text}`;
  }

  private static listed(label: string, values: readonly string[]): string[] {
    return values.length ? [`${label}: ${values.join('; ')}`] : [];
  }

  text(): string {
    const { detail } = this;
    return [new ElementLine(detail.element).ref, ...this.where(), ...this.flows(), ...this.catches(), ...this.messages(), ...this.data(), ...this.attrs(), ...this.extensions()].join('\n');
  }

  private where(): string[] {
    const { ancestors, pool, lane, host } = this.detail;
    const place = [...(pool ? [pool] : []), ...ancestors].map(({ id }) => id).join(' > ');
    const via = lane?.via ? `via ${lane.via.id}` : undefined;
    const within = lane?.parents?.length ? `within ${lane.parents.map(({ id }) => id).join(' > ')}` : undefined;
    const notes = [via, within].filter(Boolean).join('; ');
    const laneText = lane ? `lane ${lane.id}${notes ? ` (${notes})` : ''}` : undefined;
    const line = [place || undefined, laneText].filter(Boolean).join(' · ');
    return [...(line ? [`in: ${line}`] : []), ...(host ? [`on: ${host.id}${host.nonInterrupting ? ' (non-interrupting)' : ''}`] : [])];
  }

  private flows(): string[] {
    const { from, to, children, members, attachedTo } = this.detail;
    const ends = [...(from?.length ? [`from: ${from.map(ElementDetailText.link).join(', ')}`] : []), ...(to ? [`to: ${to.map(ElementDetailText.link).join(', ') || 'none'}`] : [])];
    return [
      ...(ends.length ? [ends.join('   ')] : []),
      ...ElementDetailText.listed('children', [ElementDetailText.ids(children)].filter(Boolean)),
      ...ElementDetailText.listed('members', [ElementDetailText.ids(members)].filter(Boolean)),
      ...ElementDetailText.listed('attached to', [ElementDetailText.ids(attachedTo)].filter(Boolean)),
    ];
  }

  private catches(): string[] {
    const { boundary, caughtBy, eventSubProcesses } = this.detail;
    return [
      ...ElementDetailText.listed('boundary', boundary.map(ElementDetailText.caught)),
      ...ElementDetailText.listed('caught by', caughtBy.map(ElementDetailText.caught)),
      ...ElementDetailText.listed('event sub-processes', eventSubProcesses.map(ElementDetailText.eventSubProcess)),
    ];
  }

  private messages(): string[] {
    const { message, messageFlows, usedBy, annotations } = this.detail;
    const key = message?.correlationKey !== undefined ? ` [correlationKey=${new Phrase(message.correlationKey).flag()}]` : '';
    return [
      ...(message ? [`message: ${ElementDetailText.named(message)}${key}`] : []),
      ...ElementDetailText.listed('message flows', messageFlows.map(ElementDetailText.partnerFlow)),
      ...ElementDetailText.listed('used by', (usedBy ?? []).map((user) => new ElementLine(user).ref)),
      ...ElementDetailText.listed('annotations', annotations.map(({ id, text }) => `${id}${text ? ` ${new Phrase(text).cutQuoted(ElementDetailText.ANNOTATION_MAX)}` : ''}`)),
    ];
  }

  private data(): string[] {
    const { reads, writes, readBy, writtenBy } = this.detail.data ?? {};
    const lines: Array<[string, readonly ElementRef[] | undefined]> = [
      ['reads', reads],
      ['writes', writes],
      ['read by', readBy],
      ['written by', writtenBy],
    ];
    return lines.flatMap(([label, refs]) => ElementDetailText.listed(label, refs?.length ? [ElementDetailText.ids(refs)] : []));
  }

  private attrs(): string[] {
    const attrs = Object.entries(this.detail.attrs);
    return attrs.length ? [`attrs: ${attrs.map(ElementDetailText.attr).join(' ')}`] : [];
  }

  private extensions(): string[] {
    return this.detail.extensions.flatMap((extension) => new ExtensionLine(extension).lines(`ext ${extension.slot ? `${extension.slot}.` : ''}${extension.index}: `));
  }
}
