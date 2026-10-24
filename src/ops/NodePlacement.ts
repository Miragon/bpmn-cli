/**
 * Where a node goes: the one place that knows the placement grammar
 * (--after / --before / --flow / --in / --on) and wires the node in by it:
 * an append, a prepend, a splice into a flow or an attachment to a host.
 */
import type { Doc } from '../model/Doc.js';
import { FlowRules } from '../model/FlowRules.js';
import { modelError } from '../shared/utils/errors.js';
import { kindLabel } from '../model/kinds.js';
import { is, type El, idOf } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { renamedNote } from '../model/utils/renames.js';
import { FlowOptions } from './FlowOptions.js';
import { SequenceFlows } from './SequenceFlows.js';
import { insertAfterInScope, insertBeforeInScope, lastFlowOf } from './utils/declaration-order.js';
import { labelOf } from './utils/elements.js';
import type { FlowOptions as FlowOptionValues, Placement } from './types.js';

export type PlacementOptions = Placement & FlowOptionValues & { to?: string };

export type PlacementMode = 'after' | 'before' | 'between' | 'flow' | 'in' | 'on' | 'none';

export class NodePlacement {
  private readonly flows: SequenceFlows;

  constructor(
    private readonly doc: Doc,
    private readonly p: PlacementOptions,
  ) {
    this.flows = new SequenceFlows(doc);
  }

  /** Which placement flags are set. */
  static modeOf(p: Placement): PlacementMode {
    if (p.after && p.before) return 'between';
    if (p.after) return 'after';
    if (p.before) return 'before';
    if (p.flow) return 'flow';
    if (p.on) return 'on';
    if (p.in) return 'in';
    return 'none';
  }

  get mode(): PlacementMode {
    return NodePlacement.modeOf(this.p);
  }

  /** The scope the placement targets (without mutating anything). */
  scope(): El {
    const { doc, p } = this;
    switch (this.mode) {
      case 'after':
      case 'between':
        return doc.scopeOf(doc.require(p.after!, 'bpmn:FlowNode')) ?? doc.defaultScope();
      case 'before':
        return doc.scopeOf(doc.require(p.before!, 'bpmn:FlowNode')) ?? doc.defaultScope();
      case 'flow':
        return doc.scopeOf(doc.require(p.flow!, 'bpmn:SequenceFlow', 'sequence flow')) ?? doc.defaultScope();
      case 'on':
        return doc.scopeOf(doc.require(p.on!, 'bpmn:Activity', 'activity')) ?? doc.defaultScope();
      case 'in':
        return doc.requireScope(p.in);
      default:
        return doc.defaultScope();
    }
  }

  /**
   * Places a flow node according to the placement grammar. The node must not
   * yet be connected. Boundary events use `on`. Returns the flow into the node
   * (if any) so callers can report it. `reuse` (move with flow ids kept,
   * ops/NodeMover.ts): the old out-flow of a moved node, taken out by the detach,
   * for a flow the placement creates out of that node (the flow node -> old
   * target of a splice, a prepend's node -> anchor, an append's anchor ->
   * node); it is put back instead and reported as created like a new one
   * (ops/NodeMover.ts turns that into a change).
   *
   * Rules for `after X`:
   *   - X is a gateway or has no outgoing flow  -> append: X -> node
   *   - X has exactly one outgoing flow          -> splice into it: X -> node -> old target
   *   - otherwise                                -> E_HAS_SUCCESSOR (use --flow)
   * `before Y` is symmetric (join gateways / nodes without incoming flow get node -> Y).
   */
  place(node: El, cs: ChangeSet, reuse?: (source: El) => El | undefined): El | undefined {
    const { doc, p } = this;
    const mode = this.mode;
    const scope = this.scope();
    let entryFlow: El | undefined;
    const outFlow = reuse?.(node);
    const reused = (source: El): { reuse?: El } => {
      const flow = source === node ? outFlow : reuse?.(source);
      return flow ? { reuse: flow } : {};
    };

    if (mode === 'on') {
      const host = doc.require(p.on!, 'bpmn:Activity', 'activity');
      if (!is(node, 'bpmn:BoundaryEvent')) {
        throw modelError('E_INVALID_PLACEMENT', `--on attaches boundary events only; ${kindLabel(node)} cannot be attached to ${idOf(host)}`, {
          element: idOf(node),
          hint: 'Use --after / --before / --in for other nodes.',
        });
      }
      this.assertBoundaryHost(host, node);
      node.set('attachedToRef', host);
      const boundaries = doc.boundaryEventsOf(host);
      insertAfterInScope(scope, boundaries[boundaries.length - 1] ?? host, node);
      cs.note(`attached to ${idOf(host)}`);
    } else if (is(node, 'bpmn:BoundaryEvent')) {
      throw modelError('E_INVALID_PLACEMENT', 'Boundary events must be placed with --on <activityId>', { element: idOf(node) });
    } else if (mode === 'in' || mode === 'none') {
      insertAfterInScope(scope, undefined, node);
    } else if (mode === 'flow') {
      const flow = doc.require(p.flow!, 'bpmn:SequenceFlow', 'sequence flow');
      entryFlow = this.spliceWithOptions(node, flow, cs, outFlow);
    } else if (mode === 'between') {
      const a = doc.require(p.after!, 'bpmn:FlowNode');
      const b = doc.require(p.before!, 'bpmn:FlowNode');
      const flow = this.requireFlowBetween(a, b);
      entryFlow = this.spliceWithOptions(node, flow, cs, outFlow);
    } else if (mode === 'after') {
      const anchor = doc.require(p.after!, 'bpmn:FlowNode');
      const out = doc.outgoing(anchor);
      if (is(anchor, 'bpmn:Gateway') || out.length === 0) {
        insertAfterInScope(scope, lastFlowOf(scope, anchor) ?? anchor, node);
        entryFlow = this.flows.create(anchor, node, { ...new FlowOptions(p).toAttrs(), ...reused(anchor) }, node);
        cs.create(ChangeSet.flowEntryOf(entryFlow));
        cs.note(`appended after ${idOf(anchor)}`);
      } else if (out.length === 1) {
        entryFlow = this.spliceWithOptions(node, out[0]!, cs, outFlow);
      } else {
        throw modelError('E_HAS_SUCCESSOR', `${idOf(anchor)} already has ${out.length} outgoing flows; say which one to insert into`, {
          element: idOf(anchor),
          candidates: out.map(idOf),
          hint: `Use --flow <flowId> (one of ${out.map(idOf).join(', ')}) or --after ${idOf(anchor)} --before <targetId>.`,
        });
      }
    } else if (mode === 'before') {
      const anchor = doc.require(p.before!, 'bpmn:FlowNode');
      const inc = doc.incoming(anchor);
      const isJoin = is(anchor, 'bpmn:Gateway') && inc.length >= 2;
      if (inc.length === 0 || isJoin) {
        // prepend: no flow into the node exists; the flow options go to the one flow this creates (node -> anchor)
        insertBeforeInScope(scope, anchor, node);
        const flow = this.flows.create(node, anchor, { ...new FlowOptions(p).toAttrs(), ...reused(node) }, node);
        cs.create(ChangeSet.flowEntryOf(flow));
        cs.note(`prepended before ${idOf(anchor)}`);
        const used = new FlowOptions(p).flags;
        if (used.length) {
          cs.note(`${used.join(', ')} applied to ${idOf(flow)} (${idOf(node)} -> ${idOf(anchor)}): ${idOf(anchor)} ${isJoin ? 'is a join gateway' : 'had no incoming flow'}, so no flow into ${idOf(node)} was created`);
        }
      } else if (inc.length === 1) {
        entryFlow = this.spliceWithOptions(node, inc[0]!, cs, outFlow);
      } else {
        throw modelError('E_HAS_PREDECESSOR', `${idOf(anchor)} already has ${inc.length} incoming flows; say which one to insert into`, {
          element: idOf(anchor),
          candidates: inc.map(idOf),
          hint: `Use --flow <flowId> (one of ${inc.map(idOf).join(', ')}) or --after <sourceId> --before ${idOf(anchor)}.`,
        });
      }
    }

    if (p.to) {
      const target = doc.require(p.to, 'bpmn:FlowNode');
      const flow = this.flows.create(node, target, {}, undefined);
      cs.create(ChangeSet.flowEntryOf(flow));
      if (!is(target, 'bpmn:Gateway') && doc.incoming(target).length > 1) {
        cs.warn({
          code: 'W_IMPLICIT_JOIN',
          message: `${idOf(target)} now has ${doc.incoming(target).length} incoming flows (implicit join)`,
          element: idOf(target),
          hint: 'Consider joining through a gateway.',
        });
      }
    }
    doc.invalidate();
    return entryFlow;
  }

  /**
   * A compensation handler (isForCompensation=true) cannot carry boundary
   * events: Camunda 7, CIB seven and Operaton reject the deployment ("Invalid
   * reference in boundary event"). Neither can an event sub-process: it has no
   * place in the flow to interrupt or leave (bpmn-js does not attach to one).
   */
  private assertBoundaryHost(host: El, boundary: El): void {
    if (host.get<boolean | undefined>('isForCompensation')) {
      throw modelError('E_INVALID_HOST', `${labelOf(host)} is a compensation handler (isForCompensation=true); it cannot carry boundary events`, {
        element: idOf(boundary),
        related: [idOf(host)],
        hint: `Attach the boundary event to the activity that is compensated, or make ${idOf(host)} a normal activity first (\`bpmn set <file> ${idOf(host)} isForCompensation=false\`).`,
      });
    }
    if (is(host, 'bpmn:SubProcess') && !!host.get<boolean | undefined>('triggeredByEvent')) {
      throw modelError('E_INVALID_HOST', `${labelOf(host)} is an event sub-process; it cannot carry boundary events`, {
        element: idOf(boundary),
        related: [idOf(host)],
        hint: `Attach the boundary event to an activity in the flow; an event sub-process is triggered by its start event (\`bpmn add <file> eventSubProcess:<trigger> "<Name>" --in <scope>\`).`,
      });
    }
  }

  private requireFlowBetween(a: El, b: El): El {
    const flows = this.doc.outgoing(a).filter((f) => f.get<El | undefined>('targetRef') === b);
    if (flows.length === 1) return flows[0]!;
    if (!flows.length) {
      throw modelError('E_NO_FLOW', `There is no sequence flow ${idOf(a)} -> ${idOf(b)}`, { element: idOf(a), related: [idOf(b)] });
    }
    throw modelError('E_AMBIGUOUS_FLOW', `There are ${flows.length} flows ${idOf(a)} -> ${idOf(b)}; use --flow <flowId>`, {
      element: idOf(a),
      candidates: flows.map(idOf),
    });
  }

  /**
   * Refuses to splice a node that cannot sit inside a flow (start / end events,
   * event sub-processes) with an error that names the way out.
   */
  private assertSpliceable(node: El, flow: El): void {
    const rules = new FlowRules(this.doc);
    const src = flow.get<El>('sourceRef');
    const tgt = flow.get<El>('targetRef');
    const scope = this.doc.scopeOf(flow);
    const scopeId = scope ? idOf(scope) : '<scope>';
    const kind = kindLabel(node);
    if (!rules.canStart(node)) {
      throw modelError('E_INVALID_PLACEMENT', `${kind} ${idOf(node)} cannot be inserted into the flow ${idOf(src)} -> ${idOf(tgt)}: it cannot have outgoing sequence flows`, {
        element: idOf(node),
        related: [idOf(flow)],
        hint: `${idOf(src)} already flows to ${idOf(tgt)}. Create the ${kind} unconnected and branch to it: \`bpmn add <file> ${kind} "<name>" --in ${scopeId}\` then \`bpmn connect <file> ${idOf(src)} <newId>\`, or split ${idOf(src)} with a gateway (\`apply\` op "split").`,
      });
    }
    if (!rules.canEnd(node)) {
      throw modelError('E_INVALID_PLACEMENT', `${kind} ${idOf(node)} cannot be inserted into the flow ${idOf(src)} -> ${idOf(tgt)}: it cannot have incoming sequence flows`, {
        element: idOf(node),
        related: [idOf(flow)],
        hint: `${idOf(tgt)} already has the predecessor ${idOf(src)}. Create the ${kind} unconnected: \`bpmn add <file> ${kind} "<name>" --in ${scopeId}\` then \`bpmn connect <file> <newId> ${idOf(tgt)}\`.`,
      });
    }
  }

  /**
   * Splices `node` into `flow` and reports it. `flow` (now source -> node) is
   * the flow into the node, so it takes the flow options; it keeps its id
   * (`add` warns when --flow-id was given for it), and one without id takes
   * --flow-id. `outFlow`: put back as the flow node -> old target (place
   * `reuse`).
   */
  private spliceWithOptions(node: El, flow: El, cs: ChangeSet, outFlow?: El): El {
    this.assertSpliceable(node, flow);
    const src = flow.get<El>('sourceRef');
    const tgt = flow.get<El>('targetRef');
    const { second, renamedFrom } = this.flows.splice(flow, node, outFlow, this.p.flowId);
    cs.create(ChangeSet.flowEntryOf(second));
    cs.change(ChangeSet.flowEntryOf(flow, `${idOf(src)} -> ${idOf(node)} (was -> ${idOf(tgt)})${renamedNote(renamedFrom)}`));
    cs.note(`inserted between ${idOf(src)} and ${idOf(tgt)}`);
    new FlowOptions(this.p).apply(this.doc, flow, cs);
    return flow;
  }
}
