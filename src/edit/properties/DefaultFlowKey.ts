import { type BpmnElement, BpmnError, ChangeEntries, type ChangeSet, PropertyCatalog } from '../../model/index.js';
import { FlowConditions } from '../flows/FlowConditions.js';
import type { EditSession } from '../session/EditSession.js';
import { PropertyCoercer } from './PropertyCoercer.js';

export class DefaultFlowKey {
  constructor(private readonly edit: EditSession) {}

  write(el: BpmnElement, value: string, changes: ChangeSet): void {
    if (el.is('bpmn:SequenceFlow')) {
      if (value && PropertyCoercer.booleanOf(el, 'default', value)) {
        this.makeDefaultFlow(el, changes);
      } else {
        new FlowConditions(this.edit).setDefault(el, false);
      }
      return;
    }
    if (!el.descriptor.propertiesByName?.['default']) {
      throw PropertyCatalog.of(el).unknownKey('default', 'only exclusive/inclusive/complex gateways, activities and sequence flows have a default');
    }
    if (!value) {
      el.set('default', undefined);
      return;
    }
    const flow = this.edit.require(value, 'bpmn:SequenceFlow', 'sequence flow');
    if (flow.get<BpmnElement | undefined>('sourceRef') !== el) {
      throw BpmnError.model('E_NOT_OUTGOING', `${value} is not an outgoing flow of ${el.id}`, {
        element: el.id,
        related: [value],
        candidates: this.edit.document.flows.outgoing(el).map((element) => element.id),
        hint: `Outgoing flows of ${el.id}: ${this.edit.document.flows.outgoing(el).map((element) => element.id).join(', ') || 'none'}.`,
      });
    }
    this.makeDefaultFlow(flow, changes);
  }

  private makeDefaultFlow(flow: BpmnElement, changes: ChangeSet): void {
    const source = flow.get<BpmnElement>('sourceRef');
    const previous = source.get<BpmnElement | undefined>('default');
    const expr = flow.get<BpmnElement | undefined>('conditionExpression');
    const resourceKey = new PropertyCoercer(this.edit).resourceKeyOf(expr);
    const condition = expr?.get<string | undefined>('body') ?? (resourceKey ? `${resourceKey}=${String(expr!.attrs[resourceKey])}` : undefined);
    new FlowConditions(this.edit).setDefault(flow, true);
    if (condition) {
      changes.warn({
        code: 'W_CONDITION_DROPPED',
        message: `Condition "${condition}" of ${flow.id} was removed: a default flow has no condition`,
        element: flow.id,
        hint: 'Default flows are taken when no other condition matches; set the condition on another outgoing flow if it is still needed.',
      });
    }
    if (previous && previous !== flow) {
      changes.change(ChangeEntries.of(previous, `no longer the default flow of ${source.id}`));
    }
  }
}
