import { type BpmnElement, type ChangeSet, ElementLabels } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { DeclarationOrder } from './DeclarationOrder.js';
import { FlowConditions } from './FlowConditions.js';
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
      ...(attrs.condition ? { conditionExpression: new FlowConditions(this.edit).expression(attrs.condition, attrs.language) } : {}),
    });
    source.add('outgoing', flow);
    target.add('incoming', flow);
    new DeclarationOrder(scope).insertAfter(declareAfter ?? new DeclarationOrder(scope).lastFlowOf(source) ?? source, flow);
    if (attrs.isDefault) {
      new FlowConditions(this.edit).setDefault(flow, true);
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
    const scope = flow.parent!;
    const nodes = scope.list('flowElements').filter((flowElement) => flowElement.is('bpmn:FlowNode'));
    for (const node of new Set([source, flow.get<BpmnElement | undefined>('targetRef'), ...nodes])) {
      if (!node) {
        continue;
      }
      node.remove('outgoing', flow);
      node.remove('incoming', flow);
    }
    scope.remove('flowElements', flow);
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
    new DeclarationOrder(scope).insertAfter(new DeclarationOrder(scope).lastFlowOf(source), node);
    target.remove('incoming', flow);
    flow.set('targetRef', node);
    node.add('incoming', flow);
    const renamedFrom = new FlowIdFollower(this.edit).follow(flow, source, target, flowId);
    const second = this.create(node, target, {}, node);
    document.tree.invalidate();
    return { first: flow, second, ...(renamedFrom !== undefined ? { renamedFrom } : {}) };
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
      association.parent!.remove('artifacts', association);
      this.edit.document.ids.registry.release(association.id);
      changes.remove({ id: association.id, kind: 'association' });
    }
    this.edit.document.tree.invalidate();
  }
}
