import type { DetailMessageFlow, FindHit, ViewAnnotation, ViewFlow, ViewMessageFlow } from '../../query/model-view.js';
import type { Implementation } from '../../query/context.js';
import { truncate } from '../../query/utils/view.js';

export const INDENT = '  ';
export const DOC_MAX = 80;
const VALUE_MAX = 60;

/** Identifiers (topics, classes) up to this length stay whole in the around / context views. */
const IMPL_VALUE_MAX = 120;

export function q(text: string): string {
  return `"${text.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"')}"`;
}

export function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.join(', ');
  return JSON.stringify(value);
}

export function flagValue(value: string, max = VALUE_MAX): string {
  return /^[^\s,[\]"]+$/.test(value) && value.length <= max ? value : q(truncate(value, max));
}

function extensionList(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(', ');
}

export function vendorFlags(item: { attrs?: Record<string, string>; extensions?: string[]; extensionElements?: string[] }): string[] {
  const flags = Object.entries(item.attrs ?? {}).map(([k, v]) => `${k}=${flagValue(v)}`);
  // views built without extensionElements fall back to the type names in `extensions`
  const types = item.extensionElements ?? (item.extensions ?? []).filter((e) => !(e in (item.attrs ?? {})));
  if (types.length) flags.push(`ext: ${extensionList(types)}`);
  return flags;
}

export function flowText(f: ViewFlow): string {
  const parts = [f.id];
  if (f.name) parts.push(q(f.name));
  if (f.condition) parts.push(`if ${truncate(f.condition, 120)}`);
  else if (f.conditionResource) parts.push(`if resource ${f.conditionResource}`);
  if (f.default) parts.push('default');
  const flags = [...(f.language ? [`language=${f.language}`] : []), ...vendorFlags(f)];
  if (flags.length) parts.push(`[${flags.join(', ')}]`);
  return `${f.target} (${parts.join(' ')})`;
}

export function named(id: string, name?: string): string {
  return name ? `${id} ${q(name)}` : id;
}

/** `messageFlow <id> ["name"]: <source> ["name"] -> <target> ["name"] [message M]` */
export function messageFlowLine(mf: ViewMessageFlow): string {
  const head = `messageFlow ${mf.id}${mf.name ? ` ${q(mf.name)}` : ''}`;
  return `${head}: ${named(mf.source, mf.sourceName)} -> ${named(mf.target, mf.targetName)}${mf.message ? ` [message ${mf.message}]` : ''}`;
}

export function annotationLine(a: ViewAnnotation): string {
  return `${a.id}${a.text ? ` ${q(truncate(a.text, 120))}` : ''}${a.attachedTo.length ? ` ~ ${a.attachedTo.join(', ')}` : ''}`;
}

export function implementationFlags(impl: Implementation | undefined): string[] {
  return [...Object.entries(impl?.attrs ?? {}).map(([k, v]) => `${k}=${flagValue(v, IMPL_VALUE_MAX)}`), ...(impl?.ext ?? [])];
}

/**
 * One line per element, children two spaces deeper, so the XML can be rebuilt for --replace;
 * a multi-line body follows line by line behind `| `, exactly as written.
 */
export function extensionLines(ext: unknown, indent = '', lead = ''): string[] {
  if (!ext || typeof ext !== 'object') return [`${indent}${lead}${scalar(ext)}`];
  const e = ext as { type?: string; attrs?: Record<string, string>; body?: string; children?: unknown[] };
  const parts = [e.type ?? 'extension'];
  for (const [k, v] of Object.entries(e.attrs ?? {})) parts.push(`${k}=${q(v)}`);
  const inner = `${indent}${' '.repeat(lead.length)}${INDENT}`;
  const block = e.body ? bodyBlock(e.body) : undefined;
  if (block) parts.push('body:');
  else if (e.body?.trim()) parts.push(`body="${e.body.trim().replace(/"/g, '\\"')}"`);
  const out = [`${indent}${lead}${parts.join(' ')}`];
  for (const line of block ?? []) out.push(`${inner}|${line ? ` ${line}` : ''}`);
  for (const c of e.children ?? []) out.push(...extensionLines(c, inner));
  return out;
}

function bodyBlock(body: string): string[] | undefined {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.length > 1 ? lines.map((l) => l.replace(/\s+$/, '')) : undefined;
}

/** `bpmn ext list`: `<index>: <type> attr="value" ...` per element, children indented below. */
export function renderExtensionList(items: ReadonlyArray<{ index: number; slot?: string; type: string; attrs: Record<string, string>; body?: string; children?: unknown[] }>): string {
  if (!items.length) return 'no extension elements';
  return items.flatMap((i) => extensionLines(i, '', `${i.slot ? `${i.slot}.` : ''}${i.index}: `)).join('\n');
}

/** `out Flow_9 "Order" -> Activity_Receive "Receive" in Participant_Bank "Bank" [message Order]` */
export function detailMessageFlowText(mf: DetailMessageFlow): string {
  const pool = mf.pool ? ` in ${named(mf.pool, mf.poolName)}` : '';
  return `${mf.direction} ${mf.id}${mf.name ? ` ${q(mf.name)}` : ''} ${mf.direction === 'out' ? '->' : '<-'} ${named(mf.partner, mf.partnerName)}${pool}${mf.message ? ` [message ${mf.message}]` : ''}${mf.at ? ` (at pool ${mf.at})` : ''}`;
}

/** `<kind> <id> ["name"]  (in <scope>)  [<matched vendor value>]` */
export function renderFind(hits: readonly FindHit[]): string {
  if (!hits.length) return 'no matches';
  return hits.map((h) => `${h.kind} ${h.id}${h.name ? ` ${q(h.name)}` : ''}${h.scope ? `  (in ${h.scope})` : ''}${h.match ? `  [${truncate(h.match, 100)}]` : ''}`).join('\n');
}
