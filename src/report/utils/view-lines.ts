import type { DetailMessageFlow, FindHit, ViewAnnotation, ViewFlow, ViewMessageFlow } from '../../query/model-view.js';
import type { Implementation } from '../../query/context.js';
import { truncate } from '../../query/utils/view.js';

export const INDENT = '  ';
export const DOC_MAX = 80;
const VALUE_MAX = 60;

/** Identifiers (topics, classes) up to this length stay whole in the around / context views. */
const IMPL_VALUE_MAX = 120;

export function quote(text: string): string {
  return `"${text.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"')}"`;
}

export function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value.join(', ');
  return JSON.stringify(value);
}

export function flagValue(value: string, max = VALUE_MAX): string {
  return /^[^\s,[\]"]+$/.test(value) && value.length <= max ? value : quote(truncate(value, max));
}

function extensionList(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts].map(([type, count]) => (count > 1 ? `${type} x${count}` : type)).join(', ');
}

export function vendorFlags(item: { attrs?: Record<string, string>; extensions?: string[]; extensionElements?: string[] }): string[] {
  const flags = Object.entries(item.attrs ?? {}).map(([key, value]) => `${key}=${flagValue(value)}`);
  // views built without extensionElements fall back to the type names in `extensions`
  const types = item.extensionElements ?? (item.extensions ?? []).filter((extension) => !(extension in (item.attrs ?? {})));
  if (types.length) flags.push(`ext: ${extensionList(types)}`);
  return flags;
}

export function flowText(flow: ViewFlow): string {
  const parts = [flow.id];
  if (flow.name) parts.push(quote(flow.name));
  if (flow.condition) parts.push(`if ${truncate(flow.condition, 120)}`);
  else if (flow.conditionResource) parts.push(`if resource ${flow.conditionResource}`);
  if (flow.default) parts.push('default');
  const flags = [...(flow.language ? [`language=${flow.language}`] : []), ...vendorFlags(flow)];
  if (flags.length) parts.push(`[${flags.join(', ')}]`);
  return `${flow.target} (${parts.join(' ')})`;
}

export function named(id: string, name?: string): string {
  return name ? `${id} ${quote(name)}` : id;
}

/** `messageFlow <id> ["name"]: <source> ["name"] -> <target> ["name"] [message M]` */
export function messageFlowLine(mf: ViewMessageFlow): string {
  const head = `messageFlow ${mf.id}${mf.name ? ` ${quote(mf.name)}` : ''}`;
  return `${head}: ${named(mf.source, mf.sourceName)} -> ${named(mf.target, mf.targetName)}${mf.message ? ` [message ${mf.message}]` : ''}`;
}

export function annotationLine(annotation: ViewAnnotation): string {
  return `${annotation.id}${annotation.text ? ` ${quote(truncate(annotation.text, 120))}` : ''}${annotation.attachedTo.length ? ` ~ ${annotation.attachedTo.join(', ')}` : ''}`;
}

export function implementationFlags(impl: Implementation | undefined): string[] {
  return [...Object.entries(impl?.attrs ?? {}).map(([key, value]) => `${key}=${flagValue(value, IMPL_VALUE_MAX)}`), ...(impl?.ext ?? [])];
}

/**
 * One line per element, children two spaces deeper, so the XML can be rebuilt for --replace;
 * a multi-line body follows line by line behind `| `, exactly as written.
 */
export function extensionLines(ext: unknown, indent = '', lead = ''): string[] {
  if (!ext || typeof ext !== 'object') return [`${indent}${lead}${scalar(ext)}`];
  const extension = ext as { type?: string; attrs?: Record<string, string>; body?: string; children?: unknown[] };
  const parts = [extension.type ?? 'extension'];
  for (const [key, value] of Object.entries(extension.attrs ?? {})) parts.push(`${key}=${quote(value)}`);
  const inner = `${indent}${' '.repeat(lead.length)}${INDENT}`;
  const block = extension.body ? bodyBlock(extension.body) : undefined;
  if (block) parts.push('body:');
  else if (extension.body?.trim()) parts.push(`body="${extension.body.trim().replace(/"/g, '\\"')}"`);
  const out = [`${indent}${lead}${parts.join(' ')}`];
  for (const line of block ?? []) out.push(`${inner}|${line ? ` ${line}` : ''}`);
  for (const child of extension.children ?? []) out.push(...extensionLines(child, inner));
  return out;
}

function bodyBlock(body: string): string[] | undefined {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.length > 1 ? lines.map((line) => line.replace(/\s+$/, '')) : undefined;
}

/** `bpmn ext list`: `<index>: <type> attr="value" ...` per element, children indented below. */
export function renderExtensionList(items: ReadonlyArray<{ index: number; slot?: string; type: string; attrs: Record<string, string>; body?: string; children?: unknown[] }>): string {
  if (!items.length) return 'no extension elements';
  return items.flatMap((item) => extensionLines(item, '', `${item.slot ? `${item.slot}.` : ''}${item.index}: `)).join('\n');
}

/** `out Flow_9 "Order" -> Activity_Receive "Receive" in Participant_Bank "Bank" [message Order]` */
export function detailMessageFlowText(mf: DetailMessageFlow): string {
  const pool = mf.pool ? ` in ${named(mf.pool, mf.poolName)}` : '';
  return `${mf.direction} ${mf.id}${mf.name ? ` ${quote(mf.name)}` : ''} ${mf.direction === 'out' ? '->' : '<-'} ${named(mf.partner, mf.partnerName)}${pool}${mf.message ? ` [message ${mf.message}]` : ''}${mf.at ? ` (at pool ${mf.at})` : ''}`;
}

/** `<kind> <id> ["name"]  (in <scope>)  [<matched vendor value>]` */
export function renderFind(hits: readonly FindHit[]): string {
  if (!hits.length) return 'no matches';
  return hits.map((hit) => `${hit.kind} ${hit.id}${hit.name ? ` ${quote(hit.name)}` : ''}${hit.scope ? `  (in ${hit.scope})` : ''}${hit.match ? `  [${truncate(hit.match, 100)}]` : ''}`).join('\n');
}
