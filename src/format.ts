/**
 * Text rendering (default output). Deterministic, compact, no coordinates.
 *
 * CONTRACT (implemented in the "view" work package):
 *  renderView(view): e.g.
 *    process Process_Order "Order handling" executable
 *      startEvent Event_OrderReceived "Order received" -> Activity_CheckInvoice
 *      userTask Activity_CheckInvoice "Check invoice" [lane=Lane_Sales] -> Gateway_InvoiceOk
 *      exclusiveGateway Gateway_InvoiceOk "Invoice ok?" -> Activity_Book (Flow_yes "yes" if ${ok}), Activity_Clarify (Flow_no "no" default)
 *        boundaryEvent:timer Event_Timeout "2 days" [PT2D, non-interrupting] -> Activity_Remind
 *      subProcess Activity_Payment "Payment" [expanded] -> Event_Done
 *        startEvent Event_PayStart -> ...
 *      endEvent Event_Done "Invoice booked"
 *      ! unreachable: task Activity_Old "Old step"
 *    lanes: Lane_Sales "Sales" (members carry `lane=Lane_Sales`; nested lanes indented)
 *    data: dataObject DataObjectReference_Order "Order" (from Activity_CheckInvoice; to Activity_Book)
 *    annotations: TextAnnotation_1 "note text" ~ Activity_Book
 *    collaboration Collaboration_1: participant Participant_Shop "Shop" = Process_Order;
 *      messageFlow Flow_9 "Order": Activity_Send "Send order" -> Participant_Customer "Customer" [message Order];
 *      annotations owned by the collaboration (`TextAnnotation_2 "text" ~ Activity_Send`)
 *    root: message Message_OrderReceived "OrderReceived", error Error_PaymentFailed "PaymentFailed" (PAY-001)
 *    problems: E_... / W_... lines
 *  renderDetail(detail): key: value lines.
 *  A model whose import lost content (a lossy import warning, e.g. two
 *    loopCharacteristics on one task) starts with `import: <warning>` lines.
 *  renderChanges(cs): "created userTask Activity_X "name" (after Event_Y)" lines etc., warnings, notes.
 *  renderProblems(warnings): one line each `CODE element: message  (hint)`.
 *  renderLayout(layout): the layout block of a mutation result (incl. one
 *    `format <op> #<index>: ...` line per format op).
 *  renderLayoutView(view) (`show --layout`): per diagram a `columns: c0..cN`
 *    line (with the wide gaps between neighbouring columns), the frame tree
 *    with `row n: c0 id, c1 id, ...` lines (` … ` instead of `, ` where a
 *    wide gap splits the row), then colors, labels off their default side,
 *    and the layout problems with ids. renderMetrics(metrics) (`metrics`):
 *    the score, the non-zero counts and one line per problem.
 *
 * Refined grammar (one line per node, flows inline, every id visible):
 *    <kind> <id> ["name"] [flags] -> <target> (<flowId> ["name"] [if <cond>] [default] [flags]), ...
 *  - flags: lane=<laneId> (the lane the node is a member of; nodes inside a
 *    sub-process are in the sub-process's lane), trigger text, non-interrupting,
 *    expanded|collapsed, key=value props,
 *    vendor attributes with their values under their `set` keys
 *    (`camunda:assignee=demo`, `loop.camunda:collection=${items}`,
 *    `definition.camunda:topic=x`; values with spaces or commas quoted, long
 *    ones truncated), `ext: <types>` (repeated types as `type xN`),
 *    `doc: "<truncated>"`; flows: `language=<lang>`, vendor attributes, ext;
 *    a script resource condition reads `if resource <uri>`
 *  - the process line carries the process's vendor attributes and extension types
 *  - boundary events are indented under their host, sub-process children under
 *    the sub-process; unreachable nodes are prefixed with `! unreachable`.
 *  - the collaboration (pools, message flows) comes first, then each process
 *    with its `lanes:` / `data:` / `annotations:` sections, then `root:` and
 *    `problems:`.
 */
import type { AroundNode, AroundView, ContextCatch, ContextLink, ContextRef, ElementContext, Implementation } from './context.js';
import { KEYS, type LayoutMetrics, type LayoutProblem } from './diagram/metrics.js';
import type { FormatResult } from './diagram/ops.js';
import type { LayoutView } from './diagram/view.js';
import type { Warning } from './errors.js';
import type { LayoutStatus } from './pipeline.js';
import type { Change, ChangeSet } from './result.js';
import type { DetailMessageFlow, ElementDetail, FindHit, ModelView, ViewAnnotation, ViewFlow, ViewLane, ViewMessageFlow, ViewNode } from './view.js';

const INDENT = '  ';
const DOC_MAX = 80;
const VALUE_MAX = 60;

/** Single-line, double-quoted text. */
function q(text: string): string {
  return `"${text.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"')}"`;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.join(', ');
  return JSON.stringify(value);
}

/* ------------------------------------------------------------------ */
/* view                                                                 */
/* ------------------------------------------------------------------ */

/** A vendor value in a flag list: bare when unambiguous, else quoted (and truncated). */
function flagValue(value: string, max = VALUE_MAX): string {
  return /^[^\s,[\]"]+$/.test(value) && value.length <= max ? value : q(truncate(value, max));
}

/** Vendor values in the around / context views: identifiers (topics, classes) up to this length stay whole. */
const IMPL_VALUE_MAX = 120;

/** `type`, or `type xN` for repeated extension element types, in first-seen order. */
function extensionList(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(', ');
}

/** Vendor attributes (`key=value`) and extension element types of a node, process or flow. */
function vendorFlags(item: { attrs?: Record<string, string>; extensions?: string[]; extensionElements?: string[] }): string[] {
  const flags = Object.entries(item.attrs ?? {}).map(([k, v]) => `${k}=${flagValue(v)}`);
  // extensionElements is new; views built without it fall back to the type names in `extensions`
  const types = item.extensionElements ?? (item.extensions ?? []).filter((e) => !(e in (item.attrs ?? {})));
  if (types.length) flags.push(`ext: ${extensionList(types)}`);
  return flags;
}

function flowText(f: ViewFlow): string {
  const parts = [f.id];
  if (f.name) parts.push(q(f.name));
  if (f.condition) parts.push(`if ${truncate(f.condition, 120)}`);
  else if (f.conditionResource) parts.push(`if resource ${f.conditionResource}`);
  if (f.default) parts.push('default');
  const flags = [...(f.language ? [`language=${f.language}`] : []), ...vendorFlags(f)];
  if (flags.length) parts.push(`[${flags.join(', ')}]`);
  return `${f.target} (${parts.join(' ')})`;
}

function nodeFlags(n: ViewNode): string[] {
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

function nodeLine(n: ViewNode): string {
  const parts = [n.kind, n.id];
  if (n.name) parts.push(q(n.name));
  const flags = nodeFlags(n);
  if (flags.length) parts.push(`[${flags.join(', ')}]`);
  let line = parts.join(' ');
  if (n.outgoing.length) line += ` -> ${n.outgoing.map(flowText).join(', ')}`;
  return n.unreachable ? `! unreachable: ${line}` : line;
}

function renderNodes(nodes: ViewNode[], depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  for (const n of nodes) {
    out.push(pad + nodeLine(n));
    if (n.boundary?.length) renderNodes(n.boundary, depth + 1, out);
    if (n.children?.length) renderNodes(n.children, depth + 1, out);
  }
}

/** The lane tree (names only: the members carry `lane=<id>` in their node line; an empty lane says so). */
function renderLanes(lanes: ViewLane[], depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  for (const lane of lanes) {
    const empty = !lane.members.length && !lane.lanes?.length ? ' (empty)' : '';
    out.push(`${pad}${lane.id}${lane.name ? ` ${q(lane.name)}` : ''}${empty}`);
    if (lane.lanes?.length) renderLanes(lane.lanes, depth + 1, out);
  }
}

/** `<id> "name"` of an endpoint, or just the id. */
function named(id: string, name?: string): string {
  return name ? `${id} ${q(name)}` : id;
}

/** `messageFlow <id> ["name"]: <source> ["name"] -> <target> ["name"] [message M]` */
export function messageFlowLine(mf: ViewMessageFlow): string {
  const head = `messageFlow ${mf.id}${mf.name ? ` ${q(mf.name)}` : ''}`;
  return `${head}: ${named(mf.source, mf.sourceName)} -> ${named(mf.target, mf.targetName)}${mf.message ? ` [message ${mf.message}]` : ''}`;
}

function annotationLine(a: ViewAnnotation): string {
  return `${a.id}${a.text ? ` ${q(truncate(a.text, 120))}` : ''}${a.attachedTo.length ? ` ~ ${a.attachedTo.join(', ')}` : ''}`;
}

/** Renders the whole model as compact text (see contract). */
export function renderView(view: ModelView): string {
  const out: string[] = [];
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
    if (p.nodes.length) renderNodes(p.nodes, 1, out);
    else out.push(`${INDENT}(empty)`);
    if (p.lanes.length) {
      out.push(`${INDENT}lanes:`);
      renderLanes(p.lanes, 2, out);
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

/* ------------------------------------------------------------------ */
/* around (show --around) and context (show <id> --context)             */
/* ------------------------------------------------------------------ */

/** Vendor values (`key=value`) and the compact extension items of an implementation. */
function implementationFlags(impl: Implementation | undefined): string[] {
  return [...Object.entries(impl?.attrs ?? {}).map(([k, v]) => `${k}=${flagValue(v, IMPL_VALUE_MAX)}`), ...(impl?.ext ?? [])];
}

function aroundFlags(n: AroundNode, hostShown: boolean): string[] {
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

/**
 * `bpmn show <file> --around <id>`: a header with what is shown and what was
 * left out, the process line, then the window's nodes in the grammar of
 * `show` (nested like there; a sub-process outside the window that holds
 * window nodes is a `in <kind> <id> "name":` heading); incoming flows from
 * outside the window follow `<-`. Then the message flows, annotations and
 * data of the window's nodes.
 */
export function renderAround(view: AroundView): string {
  const out: string[] = [];
  const { shown, omitted } = view;
  out.push(
    `around ${view.around} (depth ${view.depth}${view.inner ? ', inner' : ''}): ${shown.nodes} of ${shown.nodes + omitted.nodes} nodes, ${shown.flows} of ${shown.flows + omitted.flows} flows` +
      (omitted.nodes || omitted.flows ? `; ${omitted.nodes} nodes, ${omitted.flows} flows omitted` : ''),
  );
  const p = view.process;
  out.push(`process ${named(p.id, p.name)}${p.participant ? ` in ${named(p.participant, p.participantName)}` : ''}`);
  const scopes = new Map(view.scopes.map((s) => [s.id, s]));
  const level = (id: string): number => {
    const s = scopes.get(id);
    return s?.parent ? level(s.parent) + 1 : 0;
  };
  const shownIds = new Set(view.nodes.map((n) => n.id));
  const headed = new Set<string>();
  const heading = (id: string): void => {
    const s = scopes.get(id);
    if (!s || !s.parent || s.inWindow || headed.has(id)) return;
    heading(s.parent);
    headed.add(id);
    out.push(`${INDENT.repeat(level(id))}in ${s.kind} ${named(s.id, s.name)}${s.lane ? ` [lane=${s.lane}]` : ''}:`);
  };
  for (const n of view.nodes) {
    heading(n.scope);
    const hostShown = !!n.host && shownIds.has(n.host);
    const parts = [n.kind, n.id];
    if (n.name) parts.push(q(n.name));
    const flags = aroundFlags(n, hostShown);
    if (flags.length) parts.push(`[${flags.join(', ')}]`);
    let line = parts.join(' ');
    if (n.from?.length) line += ` <- ${n.from.map((f) => `${f.source} (${f.id}${f.name ? ` ${q(f.name)}` : ''})`).join(', ')}`;
    if (n.outgoing.length) line += ` -> ${n.outgoing.map(flowText).join(', ')}`;
    out.push(INDENT.repeat(level(n.scope) + 1 + (hostShown ? 1 : 0)) + line);
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

function refText(r: ContextRef): string {
  return `${r.kind} ${named(r.id, r.name)}`;
}

function linkText(l: ContextLink): string {
  const flow = [l.flow];
  if (l.flowName) flow.push(q(l.flowName));
  if (l.condition) flow.push(`if ${truncate(l.condition, 120)}`);
  if (l.default) flow.push('default');
  return `${refText(l)} (${flow.join(' ')})`;
}

function catchText(c: ContextCatch): string {
  const flags = [c.trigger, c.nonInterrupting ? 'non-interrupting' : undefined].filter(Boolean);
  return `${refText(c)}${c.on ? ` on ${c.on}` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}${c.to?.length ? ` -> ${c.to.join(', ')}` : ''}`;
}

/**
 * `bpmn show <file> <id> --context`: the element's line (kind, id, name, its
 * own facts), `implementation:` (vendor values, extension elements compact),
 * then one line per context: `in:` (pool > process > sub-processes), `lane:`,
 * `host:`, `from:` / `to:` (neighbours with names and the connecting flow),
 * `boundary:`, `caught by:`, `event sub-processes:`, `annotations:`,
 * `message flows:`, `reads:` / `writes:`; lines without content are left out.
 */
export function renderContext(c: ElementContext): string {
  const out: string[] = [];
  const flags: string[] = [];
  if (c.trigger) flags.push(c.trigger);
  if (c.nonInterrupting) flags.push('non-interrupting');
  for (const [k, v] of Object.entries(c.props ?? {})) flags.push(`${k}=${scalar(v)}`);
  if (c.documentation) flags.push(`doc: ${q(truncate(c.documentation, DOC_MAX))}`);
  out.push(`${c.kind} ${named(c.id, c.name)}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
  const impl = implementationFlags(c.implementation);
  if (impl.length) out.push(`implementation: ${impl.join(', ')}`);
  const where = [...(c.pool ? [`participant ${named(c.pool.id, c.pool.name)}`] : []), ...c.ancestors.map(refText)];
  if (where.length) out.push(`in: ${where.join(' > ')}`);
  if (c.lane) {
    const extra = [c.lane.via ? `via ${c.lane.via}` : '', c.lane.parents?.length ? `within ${c.lane.parents.map((l) => named(l.id, l.name)).join(' > ')}` : ''].filter(Boolean);
    out.push(`lane: ${named(c.lane.id, c.lane.name)}${extra.length ? ` (${extra.join('; ')})` : ''}`);
  }
  if (c.host) out.push(`host: ${refText(c.host)}`);
  if (c.from.length) out.push(`from: ${c.from.map(linkText).join('; ')}`);
  if (c.to.length) out.push(`to: ${c.to.map(linkText).join('; ')}`);
  if (c.boundary.length) out.push(`boundary: ${c.boundary.map(catchText).join('; ')}`);
  if (c.caughtBy.length) out.push(`caught by: ${c.caughtBy.map(catchText).join('; ')}`);
  if (c.eventSubProcesses.length) {
    out.push(`event sub-processes: ${c.eventSubProcesses.map((e) => `${refText(e)} in ${e.in}${e.start ? ` [${catchText(e.start)}]` : ''}`).join('; ')}`);
  }
  if (c.annotations.length) out.push(`annotations: ${c.annotations.map((a) => `${a.id}${a.text ? ` ${q(truncate(a.text, 120))}` : ''}`).join('; ')}`);
  if (c.messageFlows.length) out.push(`message flows: ${c.messageFlows.map(detailMessageFlowText).join('; ')}`);
  if (c.data?.reads?.length) out.push(`reads: ${c.data.reads.map((d) => named(d.id, d.name)).join(', ')}`);
  if (c.data?.writes?.length) out.push(`writes: ${c.data.writes.map((d) => named(d.id, d.name)).join(', ')}`);
  if (c.data?.readBy?.length) out.push(`read by: ${c.data.readBy.join(', ')}`);
  if (c.data?.writtenBy?.length) out.push(`written by: ${c.data.writtenBy.join(', ')}`);
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* detail                                                               */
/* ------------------------------------------------------------------ */

function incomingText(f: ElementDetail['incoming'][number] & { conditionResource?: string }): string {
  const parts = [f.id, 'from', f.source];
  if (f.name) parts.push(q(f.name));
  if (f.condition) parts.push(`if ${f.condition}`);
  else if (f.conditionResource) parts.push(`if resource ${f.conditionResource}`);
  if (f.default) parts.push('default');
  return parts.join(' ');
}

function outgoingText(f: ViewFlow): string {
  const parts = [f.id, 'to', f.target];
  if (f.name) parts.push(q(f.name));
  if (f.condition) parts.push(`if ${f.condition}`);
  else if (f.conditionResource) parts.push(`if resource ${f.conditionResource}`);
  if (f.default) parts.push('default');
  return parts.join(' ');
}

/**
 * An extension element as an indented tree: one line per element
 * (`type attr="value" ... body="text"`), its children two spaces deeper, so
 * siblings and children can be told apart (and the XML rebuilt for --replace).
 * A body of several lines (a script) ends the line with `body:` and follows
 * line by line, each behind `| ` at the children's depth, exactly as written
 * (blank lines around it dropped), so the script can be rebuilt; JSON keeps
 * the body as one string.
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
  // a multi-line body (a script) line by line, exactly as written, each line behind "| "
  for (const line of block ?? []) out.push(`${inner}|${line ? ` ${line}` : ''}`);
  for (const c of e.children ?? []) out.push(...extensionLines(c, inner));
  return out;
}

/** The lines of a body that spans several lines (blank lines around it dropped, the rest verbatim); undefined for a one-line body. */
function bodyBlock(body: string): string[] | undefined {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.length > 1 ? lines.map((l) => l.replace(/\s+$/, '')) : undefined;
}

/** `bpmn ext list`: `<index>: <type> attr="value" ...` per element (`loop.0: ...` for a nested element's), children indented below. */
export function renderExtensionList(items: ReadonlyArray<{ index: number; slot?: string; type: string; attrs: Record<string, string>; body?: string; children?: unknown[] }>): string {
  if (!items.length) return 'no extension elements';
  return items.flatMap((i) => extensionLines(i, '', `${i.slot ? `${i.slot}.` : ''}${i.index}: `)).join('\n');
}

/** `out Flow_9 "Order" -> Activity_Receive "Receive order" in Participant_Bank "Bank" [message Order]` (`in ... <-` for incoming). */
export function detailMessageFlowText(mf: DetailMessageFlow): string {
  const pool = mf.pool ? ` in ${named(mf.pool, mf.poolName)}` : '';
  return `${mf.direction} ${mf.id}${mf.name ? ` ${q(mf.name)}` : ''} ${mf.direction === 'out' ? '->' : '<-'} ${named(mf.partner, mf.partnerName)}${pool}${mf.message ? ` [message ${mf.message}]` : ''}`;
}

/** Renders `bpmn show <id>` as `key: value` lines (property keys are `set` keys). */
export function renderDetail(detail: ElementDetail): string {
  const out: string[] = [];
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
  const printed = new Set<string>();
  for (const [k, v] of head) {
    if (v === undefined) continue;
    out.push(`${k}: ${v}`);
    printed.add(k);
  }
  const deferred: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(detail.properties)) {
    if (v === undefined || v === null || v === '' || printed.has(k)) continue;
    if (k.includes(':')) {
      deferred.push([k, v]); // vendor attributes go last, next to the extension elements
      continue;
    }
    out.push(`${k}: ${scalar(v)}`);
    printed.add(k);
  }
  if (detail.incoming.length) out.push(`incoming: ${detail.incoming.map(incomingText).join('; ')}`);
  if (detail.outgoing.length) out.push(`outgoing: ${detail.outgoing.map(outgoingText).join('; ')}`);
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
  // nested elements: attributes the properties did not carry, then their extension elements
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

/** `bpmn find` hits: `<kind> <id> ["name"]  (in <scope>)  [<matched vendor value>]`, or `no matches`. */
export function renderFind(hits: readonly FindHit[]): string {
  if (!hits.length) return 'no matches';
  return hits.map((h) => `${h.kind} ${h.id}${h.name ? ` ${q(h.name)}` : ''}${h.scope ? `  (in ${h.scope})` : ''}${h.match ? `  [${truncate(h.match, 100)}]` : ''}`).join('\n');
}

/* ------------------------------------------------------------------ */
/* changes & problems                                                   */
/* ------------------------------------------------------------------ */

function changeLine(verb: string, c: Change): string {
  let line = `${verb} ${c.kind} ${c.id}`;
  if (c.name) line += ` ${q(c.name)}`;
  if (c.detail) line += ` - ${c.detail}`;
  return line;
}

/** One line per created/changed/removed entry, then warnings, then notes. */
export function renderChanges(cs: ChangeSet): string {
  const out: string[] = [];
  if (cs.isEmpty) out.push('no changes');
  for (const c of cs.created) out.push(changeLine('created', c));
  for (const c of cs.changed) out.push(changeLine('changed', c));
  for (const c of cs.removed) out.push(changeLine('removed', c));
  for (const w of cs.warnings) out.push(`warning ${problemLine(w)}`);
  for (const n of cs.notes) out.push(`note: ${n}`);
  return out.join('\n');
}

function problemLine(p: Warning): string {
  // a validator's finding (src/validators.ts) names its validator: `[design] E_DESIGN_DEAD_END ...`
  const validator = (p as Warning & { validator?: string }).validator;
  let head = validator ? `[${validator}] ${p.code}` : p.code;
  if (p.element) head += ` ${p.element}`;
  if (p.related?.length) head += ` [${p.related.join(', ')}]`;
  return `${head}: ${p.message}${p.hint ? `  (${p.hint})` : ''}`;
}

/** One line per finding: `[validator] CODE element [related]: message  (hint)` (the validator only for a validator's finding). */
export function renderProblems(problems: Warning[]): string {
  if (!problems.length) return 'no problems';
  return problems.map(problemLine).join('\n');
}

/* ------------------------------------------------------------------ */
/* layout block of a mutation result                                    */
/* ------------------------------------------------------------------ */

function idList(ids: readonly string[], max = 8): string {
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} (+${ids.length - max} more)`;
}

function problemText(p: LayoutProblem): string {
  return `${p.kind} [${p.ids.join(', ')}]${p.detail ? ` ${p.detail}` : ''}`;
}

function problemList(list: readonly LayoutProblem[], max = 6): string {
  const shown = list.slice(0, max).map(problemText).join(', ');
  return list.length > max ? `${shown} (+${list.length - max} more)` : shown;
}

/** `format <op> #<index>: moved ...; rerouted ...; colored ...` (or `no change`), notes appended. */
function formatLine(f: FormatResult): string {
  const parts: string[] = [];
  if (f.colored?.length) parts.push(`colored ${idList(f.colored)}`);
  if (f.labels?.length) parts.push(`label placed ${idList(f.labels)}`);
  if (f.moved.length) parts.push(`moved ${idList(f.moved)}`);
  if (f.rerouted.length) parts.push(`rerouted ${idList(f.rerouted)}`);
  if (!parts.length) parts.push('no change');
  for (const n of f.notes ?? []) parts.push(`note: ${n}`);
  return `${INDENT}format ${f.op} #${f.index}: ${parts.join('; ')}`;
}

/**
 * The layout lines of a mutation result:
 *   layout: ok - incremental (<reason>)       | layout: ok - full (<reason>) | layout: skipped
 *     placed: ids / moved: ids / rerouted: ids / pruned: ids / note: text      (incremental)
 *     format <op> #<i>: moved ids; rerouted ids; colored ids                  (format ops)
 *     stickies moved: id (with nodeId), ...                                   (design-iq stickies)
 *   layout quality: score 12 -> 10; added: kind [ids], ...; resolved: kind [ids], ...
 */
export function renderLayout(layout: LayoutStatus): string[] {
  const out: string[] = [];
  const warnings = layout.warnings.length ? ` (${layout.warnings.length} warning${layout.warnings.length === 1 ? '' : 's'})` : '';
  if (layout.status !== 'ok') out.push('layout: skipped');
  else out.push(`layout: ok${layout.mode ? ` - ${layout.mode}${layout.reason ? ` (${layout.reason})` : ''}` : ''}${warnings}`);
  for (const key of ['placed', 'moved', 'rerouted', 'pruned'] as const) {
    const ids = layout[key];
    if (ids?.length) out.push(`${INDENT}${key}: ${idList(ids)}`);
  }
  for (const n of layout.notes ?? []) out.push(`${INDENT}note: ${n}`);
  for (const f of layout.format ?? []) out.push(formatLine(f));
  if (layout.stickies?.length) out.push(`${INDENT}stickies moved: ${layout.stickies.map((s) => `${s.sticky} (with ${s.node})`).join(', ')}`);
  const m = layout.metrics;
  if (m) {
    const score = m.before ? `score ${m.before.score} -> ${m.after.score}` : `score ${m.after.score}`;
    const parts = [score];
    if (m.added.length) parts.push(`${m.before ? 'added' : 'problems'}: ${problemList(m.added)}`);
    if (m.resolved.length) parts.push(`resolved: ${problemList(m.resolved)}`);
    out.push(`layout quality: ${parts.join('; ')}`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* show --layout / metrics                                              */
/* ------------------------------------------------------------------ */

/** `score 12: crossings 1, labelOnLine 7` (non-zero counts in metric order). */
function scoreLine(m: LayoutMetrics): string {
  const counts = KEYS.filter((k) => m.counts[k] > 0).map((k) => `${k} ${m.counts[k]}`);
  return `score ${m.score}${counts.length ? `: ${counts.join(', ')}` : ': no layout problems'}`;
}

/** `bpmn metrics`: the score line, then one line per problem. */
export function renderMetrics(m: LayoutMetrics): string {
  return [scoreLine(m), ...m.problems.map((p) => `${INDENT}${problemText(p)}`)].join('\n') + '\n';
}

/** `bpmn show --layout` (see module contract). */
export function renderLayoutView(view: LayoutView): string {
  const out: string[] = [];
  if (!view.diagrams.length) out.push('no diagram');
  for (const d of view.diagrams) {
    out.push(`diagram ${d.id} (${d.root})`);
    if (d.columns) out.push(`${INDENT}columns: c0..c${d.columns - 1}${d.gaps.length ? `; wide gaps: ${d.gaps.map((g) => `c${g.after}|c${g.after + 1} ${g.width}px`).join(', ')}` : ''}`);
    const depth = new Map<string, number>();
    for (const g of d.groups) {
      const level = g.parent !== undefined ? (depth.get(g.parent) ?? 0) + 1 : 1;
      depth.set(g.id, level);
      const pad = INDENT.repeat(level);
      out.push(`${pad}${g.kind} ${g.id}${g.name ? ` ${q(g.name)}` : ''}`);
      g.rows.forEach((row, i) => {
        const gaps = g.gaps?.find((x) => x.row === i)?.before ?? [];
        const cells = row.map((id, k) => `${k === 0 ? '' : gaps.includes(k) ? ' … ' : ', '}c${g.columns[i]?.[k] ?? 0} ${id}`);
        out.push(`${pad}${INDENT}row ${i + 1}: ${cells.join('')}`);
      });
    }
  }
  if (view.colors.length) out.push(`colors: ${view.colors.map((c) => `${c.id} ${c.color === 'custom' ? `custom(${[c.fill, c.stroke].filter(Boolean).join('/')})` : c.color}`).join(', ')}`);
  if (view.labels.length) out.push(`labels off their default side: ${view.labels.map((l) => `${l.id} ${l.side} (default ${l.default})`).join(', ')}`);
  out.push(`layout quality: ${scoreLine(view.metrics)}`);
  for (const p of view.metrics.problems) out.push(`${INDENT}${problemText(p)}`);
  return out.join('\n') + '\n';
}
