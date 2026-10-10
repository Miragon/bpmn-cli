/**
 * Text rendering (default output). Deterministic, compact, no coordinates.
 *
 * CONTRACT (implemented in the "view" work package):
 *  renderView(view): e.g.
 *    process Process_Order "Order handling" executable
 *      startEvent Event_OrderReceived "Order received" -> Activity_CheckInvoice
 *      userTask Activity_CheckInvoice "Check invoice" -> Gateway_InvoiceOk
 *      exclusiveGateway Gateway_InvoiceOk "Invoice ok?" -> Activity_Book (Flow_yes "yes" if ${ok}), Activity_Clarify (Flow_no "no" default)
 *        boundaryEvent:timer Event_Timeout "2 days" [PT2D, non-interrupting] -> Activity_Remind
 *      subProcess Activity_Payment "Payment" [expanded] -> Event_Done
 *        startEvent Event_PayStart -> ...
 *      endEvent Event_Done "Invoice booked"
 *      ! unreachable: task Activity_Old "Old step"
 *    lanes: Lane_Sales "Sales" [Event_OrderReceived, Activity_CheckInvoice]
 *    data: dataObject DataObjectReference_Order "Order" (from Activity_CheckInvoice; to Activity_Book)
 *    annotations: TextAnnotation_1 "note text" ~ Activity_Book
 *    collaboration Collaboration_1: participant Participant_Shop "Shop" = Process_Order; message flows: Flow_9 Activity_Send -> Participant_Customer "Order"
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
 *  - flags: trigger text, non-interrupting, expanded|collapsed, key=value props,
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
import { KEYS, type LayoutMetrics, type LayoutProblem } from './diagram/metrics.js';
import type { FormatResult } from './diagram/ops.js';
import type { LayoutView } from './diagram/view.js';
import type { Warning } from './errors.js';
import type { LayoutStatus } from './pipeline.js';
import type { Change, ChangeSet } from './result.js';
import type { ElementDetail, FindHit, ModelView, ViewFlow, ViewLane, ViewNode } from './view.js';

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
function flagValue(value: string): string {
  return /^[^\s,[\]"]+$/.test(value) && value.length <= VALUE_MAX ? value : q(truncate(value, VALUE_MAX));
}

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

function renderLanes(lanes: ViewLane[], depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  for (const lane of lanes) {
    out.push(`${pad}${lane.id}${lane.name ? ` ${q(lane.name)}` : ''} [${lane.members.join(', ')}]`);
    if (lane.lanes?.length) renderLanes(lane.lanes, depth + 1, out);
  }
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
    for (const mf of view.collaboration.messageFlows) {
      const extra = [mf.name ? q(mf.name) : '', mf.message ? `[message ${mf.message}]` : ''].filter(Boolean).join(' ');
      out.push(`${INDENT}messageFlow ${mf.id} ${mf.source} -> ${mf.target}${extra ? ` ${extra}` : ''}`);
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
      for (const a of p.annotations) {
        out.push(`${INDENT}${INDENT}${a.id}${a.text ? ` ${q(truncate(a.text, 120))}` : ''}${a.attachedTo.length ? ` ~ ${a.attachedTo.join(', ')}` : ''}`);
      }
    }
  }
  if (view.rootElements.length) {
    out.push(`root: ${view.rootElements.map((r) => `${r.kind} ${r.id}${r.name ? ` ${q(r.name)}` : ''}${r.code ? ` (${r.code})` : ''}`).join(', ')}`);
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
