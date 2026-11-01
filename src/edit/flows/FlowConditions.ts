import { type BpmnElement, BpmnError, type ChangeSet, Kinds } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export class FlowConditions {
  constructor(private readonly edit: EditSession) {}

  expression(expr: string, language?: string): BpmnElement {
    return this.edit.document.tree.build('bpmn:FormalExpression', { body: expr, ...(language ? { language } : {}) });
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
      flow.set('conditionExpression', this.expression(expr, language));
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
}
