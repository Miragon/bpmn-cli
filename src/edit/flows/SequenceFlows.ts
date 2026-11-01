import { type BpmnElement, BpmnError, type ChangeSet, ElementLabels, Kinds } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { DeclarationOrder } from './DeclarationOrder.js';
import { FlowIdFollower } from './FlowIdFollower.js';

export interface FlowAttrs {
  id?: string;
  name?: string;
  condition?: string;
  language?: string;
  isDefault?: boolean;
}

export class SequenceFlows {
  constructor(private readonly edit: EditSession) {}

  create(source: BpmnElement, target: BpmnElement, attrs: FlowAttrs = {}, declareAfter?: BpmnElement): BpmnElement {
    const document = this.edit.document;
    const rules = document.flowRules;
    rules.assertEndpoints(source, target);
    rules.assertCondition(attrs.condition);
    rules.assertConditionTaken(source, attrs.condition, attrs.id);
    const scope = document.scopes.scopeOf(source)!;
    const id = this.edit.allocator.explicitOr(attrs.id, ElementLabels.flowRequest('bpmn:SequenceFlow', source, target));
    const flow = document.tree.create('bpmn:SequenceFlow', {
      id,
      ...(attrs.name ? { name: attrs.name } : {}),
      sourceRef: source,
      targetRef: target,
      ...(attrs.condition ? { conditionExpression: this.conditionExpression(attrs.condition, attrs.language) } : {}),
    });
    source.add('outgoing', flow);
    target.add('incoming', flow);
    new DeclarationOrder(scope).insertAfter(declareAfter ?? new DeclarationOrder(scope).lastFlowOf(source) ?? source, flow);
    if (attrs.isDefault) {
      this.setDefault(flow, true);
    }
    document.tree.invalidate();
    return flow;
  }

  remove(flow: BpmnElement, changes?: ChangeSet): void {
    const document = this.edit.document;
    if (changes) {
      this.dropAssociations(flow, changes);
    }
    const source = flow.get<BpmnElement | undefined>('sourceRef');
    if (source && source.get<BpmnElement | undefined>('default') === flow) {
      source.set('default', undefined);
    }
    const scope = flow.parent;
    const nodes = scope ? scope.list('flowElements').filter((flowElement) => flowElement.is('bpmn:FlowNode')) : [];
    for (const node of new Set([source, flow.get<BpmnElement | undefined>('targetRef'), ...nodes])) {
      if (!node) {
        continue;
      }
      node.remove('outgoing', flow);
      node.remove('incoming', flow);
    }
    if (scope) {
      scope.remove('flowElements', flow);
    }
    document.ids.registry.release(flow.id);
    document.tree.invalidate();
  }

  redirect(flow: BpmnElement, ends: { source?: BpmnElement; target?: BpmnElement }): string | undefined {
    const document = this.edit.document;
    const source = ends.source ?? flow.get<BpmnElement>('sourceRef');
    const target = ends.target ?? flow.get<BpmnElement>('targetRef');
    this.edit.document.flowRules.assertEndpoints(source, target, flow);
    const oldSource = flow.get<BpmnElement | undefined>('sourceRef');
    const oldTarget = flow.get<BpmnElement | undefined>('targetRef');
    if (oldSource && oldSource !== source) {
      oldSource.remove('outgoing', flow);
      if (oldSource.get<BpmnElement | undefined>('default') === flow) {
        oldSource.set('default', undefined);
      }
    }
    if (oldTarget && oldTarget !== target) {
      oldTarget.remove('incoming', flow);
    }
    flow.set('sourceRef', source);
    flow.set('targetRef', target);
    source.add('outgoing', flow);
    target.add('incoming', flow);
    document.tree.invalidate();
    return new FlowIdFollower(this.edit).follow(flow, oldSource, oldTarget);
  }

  splice(flow: BpmnElement, node: BpmnElement, flowId?: string): { first: BpmnElement; second: BpmnElement; renamedFrom?: string } {
    const document = this.edit.document;
    const target = flow.get<BpmnElement>('targetRef');
    const scope = document.scopes.scopeOf(flow)!;
    const source = flow.get<BpmnElement>('sourceRef');
    const rules = this.edit.document.flowRules;
    rules.assertRoles(source, node);
    rules.assertRoles(node, target);
    new DeclarationOrder(scope).insertAfter(new DeclarationOrder(scope).lastFlowOf(source) ?? source, node);
    target.remove('incoming', flow);
    flow.set('targetRef', node);
    node.add('incoming', flow);
    const renamedFrom = new FlowIdFollower(this.edit).follow(flow, source, target, flowId);
    const second = this.create(node, target, {}, node);
    document.tree.invalidate();
    return { first: flow, second, ...(renamedFrom !== undefined ? { renamedFrom } : {}) };
  }

  setDefault(flow: BpmnElement, isDefault: boolean): void {
    const source = flow.get<BpmnElement>('sourceRef');
    if (isDefault) {
      if (!Kinds.branchesByCondition(source) && !source.is('bpmn:Activity')) {
        throw BpmnError.model('E_INVALID_DEFAULT', `Only exclusive/inclusive/complex gateways and activities can have a default flow (${source.id} is a ${Kinds.label(source)})`, {
          element: flow.id,
        });
      }
      source.set('default', flow);
      if (flow.get<BpmnElement | undefined>('conditionExpression')) {
        flow.set('conditionExpression', undefined);
      }
    } else if (source.get<BpmnElement | undefined>('default') === flow) {
      source.set('default', undefined);
    }
    this.edit.document.tree.invalidate();
  }

  setCondition(flow: BpmnElement, expr: string | undefined, language?: string): void {
    const rules = this.edit.document.flowRules;
    rules.assertCondition(expr);
    rules.assertConditionTaken(flow.get<BpmnElement>('sourceRef'), expr, flow.id);
    if (expr) {
      flow.set('conditionExpression', this.conditionExpression(expr, language));
      const source = flow.get<BpmnElement | undefined>('sourceRef');
      if (source?.get<BpmnElement | undefined>('default') === flow) {
        source.set('default', undefined);
      }
    } else {
      flow.set('conditionExpression', undefined);
    }
    this.edit.document.tree.invalidate();
  }

  dropIgnoredConditions(source: BpmnElement, changes: ChangeSet, flows: BpmnElement[] = this.edit.document.flows.outgoing(source)): void {
    if (!Kinds.ignoresConditions(source)) {
      return;
    }
    for (const flow of flows) {
      if (!flow.get<BpmnElement | undefined>('conditionExpression')) {
        continue;
      }
      flow.set('conditionExpression', undefined);
      changes.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${flow.id} was dropped: a ${Kinds.label(source)} takes no conditions`, element: flow.id, related: [source.id] });
    }
    this.edit.document.tree.invalidate();
  }

  carryAssociations(from: BpmnElement, to: BpmnElement, changes: ChangeSet): BpmnElement[] {
    const carried = this.associationsOf(from);
    for (const association of carried) {
      for (const end of ['sourceRef', 'targetRef']) {
        if (association.get<BpmnElement | undefined>(end) === from) {
          association.set(end, to);
        }
      }
      changes.change({ id: association.id, kind: 'association', detail: `re-attached from ${from.id} to ${to.id}` });
    }
    this.edit.document.tree.invalidate();
    return carried;
  }

  private associationsOf(flow: BpmnElement): BpmnElement[] {
    return [...this.edit.document.tree.all().values()].filter((association) => association.is('bpmn:Association') && (association.get<BpmnElement | undefined>('sourceRef') === flow || association.get<BpmnElement | undefined>('targetRef') === flow));
  }

  private dropAssociations(flow: BpmnElement, changes: ChangeSet): void {
    for (const association of this.associationsOf(flow)) {
      const parent = association.parent;
      if (parent) {
        parent.remove('artifacts', association);
      }
      this.edit.document.ids.registry.release(association.id);
      changes.remove({ id: association.id, kind: 'association' });
    }
    this.edit.document.tree.invalidate();
  }

  private conditionExpression(expr: string, language?: string): BpmnElement {
    return this.edit.document.tree.build('bpmn:FormalExpression', { body: expr, ...(language ? { language } : {}) });
  }
}
