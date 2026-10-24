/**
 * The model view as text (default output of `show`). Deterministic, compact, no coordinates.
 *
 * CONTRACT, e.g.
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
 *    groups: Group_Payment "Payment": Activity_Pay, Event_Paid (the members its box holds or that reference its category value)
 *    root: message Message_OrderReceived "OrderReceived", error Error_PaymentFailed "PaymentFailed" (PAY-001)
 *    problems: E_... / W_... lines
 *  A model whose import lost content (a lossy import warning, e.g. two
 *    loopCharacteristics on one task) starts with `import: <warning>` lines.
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
 *    with its `lanes:` / `data:` / `annotations:` sections, then `groups:`, `root:` and
 *    `problems:`.
 */
import type { ModelView, ViewLane, ViewNode } from '../query/model-view.js';
import { truncate } from '../query/utils/view.js';
import { renderProblems } from './utils/result-lines.js';
import { annotationLine, DOC_MAX, flagValue, flowText, INDENT, messageFlowLine, q, scalar, vendorFlags } from './utils/view-lines.js';

export class ModelViewText {
  private readonly out: string[] = [];

  constructor(private readonly view: ModelView) {}

  /** The whole model as compact text (see contract). */
  text(): string {
    const { view, out } = this;
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
      if (p.nodes.length) this.nodes(p.nodes, 1);
      else out.push(`${INDENT}(empty)`);
      if (p.lanes.length) {
        out.push(`${INDENT}lanes:`);
        this.lanes(p.lanes, 2);
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
    if (view.groups?.length) {
      out.push('groups:');
      for (const g of view.groups) out.push(`${INDENT}${g.id}${g.name ? ` ${q(g.name)}` : ''}: ${g.members.join(', ') || '(empty)'}`);
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

  private nodes(nodes: ViewNode[], depth: number): void {
    const pad = INDENT.repeat(depth);
    for (const n of nodes) {
      this.out.push(pad + ModelViewText.nodeLine(n));
      if (n.boundary?.length) this.nodes(n.boundary, depth + 1);
      if (n.children?.length) this.nodes(n.children, depth + 1);
    }
  }

  /** The lane tree (names only: the members carry `lane=<id>` in their node line; an empty lane says so). */
  private lanes(lanes: ViewLane[], depth: number): void {
    const pad = INDENT.repeat(depth);
    for (const lane of lanes) {
      const empty = !lane.members.length && !lane.lanes?.length ? ' (empty)' : '';
      this.out.push(`${pad}${lane.id}${lane.name ? ` ${q(lane.name)}` : ''}${empty}`);
      if (lane.lanes?.length) this.lanes(lane.lanes, depth + 1);
    }
  }

  private static nodeLine(n: ViewNode): string {
    const parts = [n.kind, n.id];
    if (n.name) parts.push(q(n.name));
    const flags = ModelViewText.nodeFlags(n);
    if (flags.length) parts.push(`[${flags.join(', ')}]`);
    let line = parts.join(' ');
    if (n.outgoing.length) line += ` -> ${n.outgoing.map(flowText).join(', ')}`;
    return n.unreachable ? `! unreachable: ${line}` : line;
  }

  private static nodeFlags(n: ViewNode): string[] {
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
}
