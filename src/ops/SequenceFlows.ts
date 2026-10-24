/**
 * The sequence flows of a document: create, remove, redirect, splice, the
 * default marker and the condition; declaration order the layouter depends
 * on (a flow right after its source).
 *
 * Associations on flows (e.g. a text annotation attached to a sequence
 * flow): when bridging replaces a flow by its predecessor flow, the
 * associations move along (carryAssociations, reported as changes); a flow
 * removed with a ChangeSet takes its associations with it (reported as
 * removed), so no association is ever left pointing at a removed flow.
 */
import type { Doc } from '../model/Doc.js';
import { FlowRules } from '../model/FlowRules.js';
import { modelError } from '../shared/utils/errors.js';
import { ElementLabels } from '../ids/ElementLabels.js';
import { branchesByCondition, ignoresConditions, kindLabel } from '../model/kinds.js';
import { addTo, is, many, removeFrom, type El, idOf } from '../model/utils/moddle.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { FlowIdFollower } from './FlowIdFollower.js';
import { insertAfterInScope, lastFlowOf } from './utils/declaration-order.js';

export interface FlowAttrs {
  id?: string;
  name?: string;
  condition?: string;
  language?: string;
  isDefault?: boolean;
  /**
   * a sequence flow `remove` took out, put back instead of a new
   * flow when no `id` is given (move with flow ids kept: the moved node's old
   * out-flow, ops/NodeMover.ts): it keeps its id, documentation and extensions;
   * name and condition are the ones given here
   */
  reuse?: El;
}

export class SequenceFlows {
  private readonly rules: FlowRules;

  constructor(private readonly doc: Doc) {
    this.rules = new FlowRules(doc);
  }

  /**
   * Creates a sequence flow source -> target, maintains incoming/outgoing and
   * declaration order (the flow is declared right after its source unless
   * `declareAfter` says otherwise). With `attrs.reuse` (and no `attrs.id`)
   * that flow is put back instead and keeps its id (FlowIdFollower.follow
   * records it for W_FLOW_ID_STALE when its id named its old ends).
   */
  create(source: El, target: El, attrs: FlowAttrs = {}, declareAfter?: El): El {
    const doc = this.doc;
    this.rules.assertEndpoints(source, target);
    this.rules.assertCondition(attrs.condition);
    this.rules.assertConditionTaken(source, attrs.condition, attrs.id);
    const scope = doc.scopeOf(source)!;
    const reuse = attrs.id ? undefined : attrs.reuse;
    // the ends the put-back flow had: its id may name them (FlowIdFollower.follow)
    const oldSource = reuse?.get<El | undefined>('sourceRef');
    const oldTarget = reuse?.get<El | undefined>('targetRef');
    let flow: El;
    if (reuse) {
      flow = reuse;
      if (idOf(flow)) doc.ids.claim(idOf(flow));
      flow.set('name', attrs.name || undefined);
      flow.set('conditionExpression', attrs.condition ? this.conditionExpression(attrs.condition, attrs.language) : undefined);
      flow.set('sourceRef', source);
      flow.set('targetRef', target);
    } else {
      const id = doc.edit.allocator.explicitOr(attrs.id, ElementLabels.flowRequest('bpmn:SequenceFlow', source, target));
      flow = doc.create('bpmn:SequenceFlow', {
        id,
        ...(attrs.name ? { name: attrs.name } : {}),
        sourceRef: source,
        targetRef: target,
        ...(attrs.condition ? { conditionExpression: this.conditionExpression(attrs.condition, attrs.language) } : {}),
      });
    }
    addTo(source, 'outgoing', flow);
    addTo(target, 'incoming', flow);
    insertAfterInScope(scope, declareAfter ?? lastFlowOf(scope, source) ?? source, flow);
    if (attrs.isDefault) this.setDefault(flow, true);
    doc.invalidate();
    if (reuse) new FlowIdFollower(doc).follow(flow, oldSource, oldTarget);
    return flow;
  }

  /**
   * Removes a sequence flow from its scope and from every mirror list of the
   * scope's nodes: its endpoints' and stale entries a modeler file may carry on
   * other nodes (which would otherwise dangle). With a ChangeSet, the
   * associations attached to it are removed too (reported); without one the
   * caller resolves them (remove's cascade).
   */
  remove(flow: El, cs?: ChangeSet): void {
    const doc = this.doc;
    if (cs) this.dropAssociations(flow, cs);
    const source = flow.get<El | undefined>('sourceRef');
    if (source && source.get<El | undefined>('default') === flow) source.set('default', undefined);
    const scope = flow.$parent as El | undefined;
    const nodes = scope ? many(scope, 'flowElements').filter((n) => is(n, 'bpmn:FlowNode')) : [];
    for (const node of new Set([source, flow.get<El | undefined>('targetRef'), ...nodes])) {
      if (!node) continue;
      removeFrom(node, 'outgoing', flow);
      removeFrom(node, 'incoming', flow);
    }
    if (scope) removeFrom(scope, 'flowElements', flow);
    doc.ids.release(idOf(flow));
    doc.invalidate();
  }

  /** Gives a flow another source and / or target; returns the old id when its id followed its ends (FlowIdFollower.follow). */
  redirect(flow: El, ends: { source?: El; target?: El }): string | undefined {
    const doc = this.doc;
    const source = ends.source ?? flow.get<El>('sourceRef');
    const target = ends.target ?? flow.get<El>('targetRef');
    this.rules.assertEndpoints(source, target);
    const oldSource = flow.get<El | undefined>('sourceRef');
    const oldTarget = flow.get<El | undefined>('targetRef');
    if (oldSource && oldSource !== source) {
      removeFrom(oldSource, 'outgoing', flow);
      if (oldSource.get<El | undefined>('default') === flow) oldSource.set('default', undefined);
    }
    if (oldTarget && oldTarget !== target) removeFrom(oldTarget, 'incoming', flow);
    flow.set('sourceRef', source);
    flow.set('targetRef', target);
    addTo(source, 'outgoing', flow);
    addTo(target, 'incoming', flow);
    doc.invalidate();
    return new FlowIdFollower(doc).follow(flow, oldSource, oldTarget);
  }

  /**
   * Inserts `node` into `flow` (A -> B becomes A -> node -> B). The original
   * flow keeps its attributes (and its id, unless the id named A and B:
   * FlowIdFollower.follow; `renamedFrom`, `''` for a flow without id that got one,
   * `flowId` when given) and now ends at `node`; a new plain flow node -> B is
   * created, or `reuse` is put back as it (create).
   */
  splice(flow: El, node: El, reuse?: El, flowId?: string): { first: El; second: El; renamedFrom?: string } {
    const doc = this.doc;
    const target = flow.get<El>('targetRef');
    const scope = doc.scopeOf(flow)!;
    const source = flow.get<El>('sourceRef');
    // never produce an invalid model: both new flows must be legal before anything is touched
    this.rules.assertRoles(source, node);
    this.rules.assertRoles(node, target);
    // declaration order: node right after the original flow's source, then the flows
    insertAfterInScope(scope, lastFlowOf(scope, source) ?? source, node);
    removeFrom(target, 'incoming', flow);
    flow.set('targetRef', node);
    addTo(node, 'incoming', flow);
    const renamedFrom = new FlowIdFollower(doc).follow(flow, source, target, flowId);
    const second = this.create(node, target, reuse ? { reuse } : {}, node);
    doc.invalidate();
    return { first: flow, second, ...(renamedFrom !== undefined ? { renamedFrom } : {}) };
  }

  /** Makes `flow` the default flow of its source (its condition goes), or takes the marker away. */
  setDefault(flow: El, isDefault: boolean): void {
    const source = flow.get<El>('sourceRef');
    if (isDefault) {
      if (!branchesByCondition(source) && !is(source, 'bpmn:Activity')) {
        throw modelError('E_INVALID_DEFAULT', `Only exclusive/inclusive/complex gateways and activities can have a default flow (${idOf(source)} is a ${kindLabel(source)})`, {
          element: idOf(flow),
        });
      }
      source.set('default', flow);
      if (flow.get<El | undefined>('conditionExpression')) flow.set('conditionExpression', undefined);
    } else if (source.get<El | undefined>('default') === flow) {
      source.set('default', undefined);
    }
    this.doc.invalidate();
  }

  /** Sets (or with no `expr` removes) the condition of `flow`; a condition takes the default marker away. */
  setCondition(flow: El, expr: string | undefined, language?: string): void {
    this.rules.assertCondition(expr);
    this.rules.assertConditionTaken(flow.get<El>('sourceRef'), expr, idOf(flow));
    if (expr) {
      flow.set('conditionExpression', this.conditionExpression(expr, language));
      const source = flow.get<El | undefined>('sourceRef');
      if (source?.get<El | undefined>('default') === flow) source.set('default', undefined);
    } else {
      flow.set('conditionExpression', undefined);
    }
    this.doc.invalidate();
  }

  /** Removes the condition of each flow out of `source` when it ignores conditions (parallel / event-based gateway): W_CONDITION_DROPPED. */
  dropIgnoredConditions(source: El, cs: ChangeSet, flows: El[] = this.doc.outgoing(source)): void {
    if (!ignoresConditions(source)) return;
    for (const flow of flows) {
      if (!flow.get<El | undefined>('conditionExpression')) continue;
      flow.set('conditionExpression', undefined);
      cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(flow)} was dropped: a ${kindLabel(source)} takes no conditions`, element: idOf(flow), related: [idOf(source)] });
    }
    this.doc.invalidate();
  }

  /**
   * Re-attaches the associations of `from` to `to` (bridging: the annotation
   * stays on the flow that replaces `from`). Returns the ones it re-attached.
   */
  carryAssociations(from: El, to: El, cs: ChangeSet): El[] {
    const carried = this.associationsOf(from);
    for (const a of carried) {
      for (const end of ['sourceRef', 'targetRef']) if (a.get<El | undefined>(end) === from) a.set(end, to);
      cs.change({ id: idOf(a), kind: 'association', detail: `re-attached from ${idOf(from)} to ${idOf(to)}` });
    }
    this.doc.invalidate();
    return carried;
  }

  /** Associations (e.g. of text annotations) attached to a flow. */
  private associationsOf(flow: El): El[] {
    return [...this.doc.byId().values()].filter((a) => is(a, 'bpmn:Association') && (a.get<El | undefined>('sourceRef') === flow || a.get<El | undefined>('targetRef') === flow));
  }

  /** Removes the associations attached to a flow that is being removed (reported). */
  private dropAssociations(flow: El, cs: ChangeSet): void {
    for (const a of this.associationsOf(flow)) {
      const parent = a.$parent as El | undefined;
      if (parent) removeFrom(parent, 'artifacts', a);
      this.doc.ids.release(idOf(a));
      cs.remove({ id: idOf(a), kind: 'association' });
    }
    this.doc.invalidate();
  }

  private conditionExpression(expr: string, language?: string): El {
    return this.doc.moddle.create('bpmn:FormalExpression', { body: expr, ...(language ? { language } : {}) });
  }
}
