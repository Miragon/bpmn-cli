import type { EditSession } from '../../document/EditSession.js';
import { FlowRules } from '../../document/FlowRules.js';
import { modelError } from '../../document/utils/errors.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { branchesByCondition, ignoresConditions, kindLabel } from '../../document/Kinds.js';
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
}

/**
 * Creates, removes, redirects and splices sequence flows, keeping the declaration order the
 * layouter depends on (a flow right after its source). No association is left pointing
 * at a removed flow.
 */
export class SequenceFlows {
  constructor(private readonly edit: EditSession) {}

  create(source: El, target: El, attrs: FlowAttrs = {}, declareAfter?: El): El {
    const doc = this.edit.doc;
    const rules = new FlowRules(doc);
    rules.assertEndpoints(source, target);
    rules.assertCondition(attrs.condition);
    rules.assertConditionTaken(source, attrs.condition, attrs.id);
    const scope = doc.scopeOf(source)!;
    const id = this.edit.allocator.explicitOr(attrs.id, ElementLabels.flowRequest('bpmn:SequenceFlow', source, target));
    const flow = doc.create('bpmn:SequenceFlow', {
      id,
      ...(attrs.name ? { name: attrs.name } : {}),
      sourceRef: source,
      targetRef: target,
      ...(attrs.condition ? { conditionExpression: this.conditionExpression(attrs.condition, attrs.language) } : {}),
    });
    addTo(source, 'outgoing', flow);
    addTo(target, 'incoming', flow);
    insertAfterInScope(scope, declareAfter ?? lastFlowOf(scope, source) ?? source, flow);
    if (attrs.isDefault) this.setDefault(flow, true);
    doc.invalidate();
    return flow;
  }

  /**
   * Also clears stale incoming/outgoing entries a modeler file may carry on other nodes.
   * Without a ChangeSet the caller resolves the flow's associations.
   */
  remove(flow: El, changes?: ChangeSet): void {
    const doc = this.edit.doc;
    if (changes) this.dropAssociations(flow, changes);
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
    const doc = this.edit.doc;
    const source = ends.source ?? flow.get<El>('sourceRef');
    const target = ends.target ?? flow.get<El>('targetRef');
    new FlowRules(this.edit.doc).assertEndpoints(source, target);
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
    return new FlowIdFollower(this.edit).follow(flow, oldSource, oldTarget);
  }

  /**
   * A -> B becomes A -> node -> B: the original flow keeps its attributes and ends at
   * `node`; a new plain flow runs node -> B.
   */
  splice(flow: El, node: El, flowId?: string): { first: El; second: El; renamedFrom?: string } {
    const doc = this.edit.doc;
    const target = flow.get<El>('targetRef');
    const scope = doc.scopeOf(flow)!;
    const source = flow.get<El>('sourceRef');
    const rules = new FlowRules(this.edit.doc);
    rules.assertRoles(source, node);
    rules.assertRoles(node, target);
    insertAfterInScope(scope, lastFlowOf(scope, source) ?? source, node);
    removeFrom(target, 'incoming', flow);
    flow.set('targetRef', node);
    addTo(node, 'incoming', flow);
    const renamedFrom = new FlowIdFollower(this.edit).follow(flow, source, target, flowId);
    const second = this.create(node, target, {}, node);
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
    this.edit.doc.invalidate();
  }

  /** A condition takes the default marker away. */
  setCondition(flow: El, expr: string | undefined, language?: string): void {
    const rules = new FlowRules(this.edit.doc);
    rules.assertCondition(expr);
    rules.assertConditionTaken(flow.get<El>('sourceRef'), expr, idOf(flow));
    if (expr) {
      flow.set('conditionExpression', this.conditionExpression(expr, language));
      const source = flow.get<El | undefined>('sourceRef');
      if (source?.get<El | undefined>('default') === flow) source.set('default', undefined);
    } else {
      flow.set('conditionExpression', undefined);
    }
    this.edit.doc.invalidate();
  }

  dropIgnoredConditions(source: El, changes: ChangeSet, flows: El[] = this.edit.doc.outgoing(source)): void {
    if (!ignoresConditions(source)) return;
    for (const flow of flows) {
      if (!flow.get<El | undefined>('conditionExpression')) continue;
      flow.set('conditionExpression', undefined);
      changes.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(flow)} was dropped: a ${kindLabel(source)} takes no conditions`, element: idOf(flow), related: [idOf(source)] });
    }
    this.edit.doc.invalidate();
  }

  /** Bridging: an annotation stays on the flow that replaces `from`. */
  carryAssociations(from: El, to: El, changes: ChangeSet): El[] {
    const carried = this.associationsOf(from);
    for (const association of carried) {
      for (const end of ['sourceRef', 'targetRef']) if (association.get<El | undefined>(end) === from) association.set(end, to);
      changes.change({ id: idOf(association), kind: 'association', detail: `re-attached from ${idOf(from)} to ${idOf(to)}` });
    }
    this.edit.doc.invalidate();
    return carried;
  }

  private associationsOf(flow: El): El[] {
    return [...this.edit.doc.byId().values()].filter((association) => is(association, 'bpmn:Association') && (association.get<El | undefined>('sourceRef') === flow || association.get<El | undefined>('targetRef') === flow));
  }

  private dropAssociations(flow: El, changes: ChangeSet): void {
    for (const association of this.associationsOf(flow)) {
      const parent = association.$parent as El | undefined;
      if (parent) removeFrom(parent, 'artifacts', association);
      this.edit.doc.ids.release(idOf(association));
      changes.remove({ id: idOf(association), kind: 'association' });
    }
    this.edit.doc.invalidate();
  }

  private conditionExpression(expr: string, language?: string): El {
    return this.edit.doc.moddle.create('bpmn:FormalExpression', { body: expr, ...(language ? { language } : {}) });
  }
}
