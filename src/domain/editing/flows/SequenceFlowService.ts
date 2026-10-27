import type { Doc } from '../../document/Doc.js';
import type { EditContext } from '../../document/EditContext.js';
import { FlowRules } from '../../document/FlowRules.js';
import { modelError } from '../../document/utils/errors.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { branchesByCondition, ignoresConditions, kindLabel } from '../../document/utils/kinds.js';
import { addTo, is, many, removeFrom, type El, idOf } from '../../document/utils/moddle.js';
import type { ChangeSet } from '../../document/ChangeSet.js';
import { FlowIdFollower } from './FlowIdFollower.js';
import { insertAfterInScope, lastFlowOf } from '../utils/declaration-order.js';

export interface FlowAttrs {
  id?: string;
  name?: string;
  condition?: string;
  language?: string;
  isDefault?: boolean;
  /** A removed flow put back instead of a new one when no `id` is given; it keeps its id. */
  reuse?: El;
}

/**
 * Creates, removes, redirects and splices sequence flows, keeping the declaration order the
 * layouter depends on (a flow right after its source). No association is left pointing
 * at a removed flow.
 */
export class SequenceFlowService {
  private readonly rules: FlowRules;

  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext,
  ) {
    this.rules = new FlowRules(doc);
  }

  create(source: El, target: El, attrs: FlowAttrs = {}, declareAfter?: El): El {
    const doc = this.doc;
    this.rules.assertEndpoints(source, target);
    this.rules.assertCondition(attrs.condition);
    this.rules.assertConditionTaken(source, attrs.condition, attrs.id);
    const scope = doc.scopeOf(source)!;
    const reuse = attrs.id ? undefined : attrs.reuse;
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
      const id = this.edit.allocator.explicitOr(attrs.id, ElementLabels.flowRequest('bpmn:SequenceFlow', source, target));
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
    if (reuse) new FlowIdFollower(doc, this.edit).follow(flow, oldSource, oldTarget);
    return flow;
  }

  /**
   * Also clears stale incoming/outgoing entries a modeler file may carry on other nodes.
   * Without a ChangeSet the caller resolves the flow's associations.
   */
  remove(flow: El, cs?: ChangeSet): void {
    const doc = this.doc;
    if (cs) this.dropAssociations(flow, cs);
    const source = flow.get<El | undefined>('sourceRef');
    if (source && source.get<El | undefined>('default') === flow) source.set('default', undefined);
    const scope = flow.$parent as El | undefined;
    const nodes = scope ? many(scope, 'flowElements').filter((flowElement) => is(flowElement, 'bpmn:FlowNode')) : [];
    for (const node of new Set([source, flow.get<El | undefined>('targetRef'), ...nodes])) {
      if (!node) continue;
      removeFrom(node, 'outgoing', flow);
      removeFrom(node, 'incoming', flow);
    }
    if (scope) removeFrom(scope, 'flowElements', flow);
    doc.ids.release(idOf(flow));
    doc.invalidate();
  }

  /** Returns the old id when the flow's id followed its new ends. */
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
    return new FlowIdFollower(doc, this.edit).follow(flow, oldSource, oldTarget);
  }

  /**
   * A -> B becomes A -> node -> B: the original flow keeps its attributes and ends at
   * `node`; a new plain flow (or `reuse`) runs node -> B.
   */
  splice(flow: El, node: El, reuse?: El, flowId?: string): { first: El; second: El; renamedFrom?: string } {
    const doc = this.doc;
    const target = flow.get<El>('targetRef');
    const scope = doc.scopeOf(flow)!;
    const source = flow.get<El>('sourceRef');
    this.rules.assertRoles(source, node);
    this.rules.assertRoles(node, target);
    insertAfterInScope(scope, lastFlowOf(scope, source) ?? source, node);
    removeFrom(target, 'incoming', flow);
    flow.set('targetRef', node);
    addTo(node, 'incoming', flow);
    const renamedFrom = new FlowIdFollower(doc, this.edit).follow(flow, source, target, flowId);
    const second = this.create(node, target, reuse ? { reuse } : {}, node);
    doc.invalidate();
    return { first: flow, second, ...(renamedFrom !== undefined ? { renamedFrom } : {}) };
  }

  /** A default flow carries no condition. */
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

  /** A condition takes the default marker away. */
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

  dropIgnoredConditions(source: El, cs: ChangeSet, flows: El[] = this.doc.outgoing(source)): void {
    if (!ignoresConditions(source)) return;
    for (const flow of flows) {
      if (!flow.get<El | undefined>('conditionExpression')) continue;
      flow.set('conditionExpression', undefined);
      cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(flow)} was dropped: a ${kindLabel(source)} takes no conditions`, element: idOf(flow), related: [idOf(source)] });
    }
    this.doc.invalidate();
  }

  /** Bridging: an annotation stays on the flow that replaces `from`. */
  carryAssociations(from: El, to: El, cs: ChangeSet): El[] {
    const carried = this.associationsOf(from);
    for (const association of carried) {
      for (const end of ['sourceRef', 'targetRef']) if (association.get<El | undefined>(end) === from) association.set(end, to);
      cs.change({ id: idOf(association), kind: 'association', detail: `re-attached from ${idOf(from)} to ${idOf(to)}` });
    }
    this.doc.invalidate();
    return carried;
  }

  private associationsOf(flow: El): El[] {
    return [...this.doc.byId().values()].filter((association) => is(association, 'bpmn:Association') && (association.get<El | undefined>('sourceRef') === flow || association.get<El | undefined>('targetRef') === flow));
  }

  private dropAssociations(flow: El, cs: ChangeSet): void {
    for (const association of this.associationsOf(flow)) {
      const parent = association.$parent as El | undefined;
      if (parent) removeFrom(parent, 'artifacts', association);
      this.doc.ids.release(idOf(association));
      cs.remove({ id: idOf(association), kind: 'association' });
    }
    this.doc.invalidate();
  }

  private conditionExpression(expr: string, language?: string): El {
    return this.doc.moddle.create('bpmn:FormalExpression', { body: expr, ...(language ? { language } : {}) });
  }
}
