import { BpmnElement, ElementSlots, ElementText, Kinds, PropertyCatalog, type BpmnDocument } from '../../model/index.js';
import type { ElementSummary } from '../facts/index.js';

export class ElementProperties {
  private static readonly SHOWN_ELSEWHERE = ['id', 'name', 'lane', 'source', 'target', 'trigger', 'nonInterrupting', 'message'];

  constructor(private readonly document: BpmnDocument) {}

  private static flowProperties(element: BpmnElement): Record<string, unknown> {
    const condition = element.peek<BpmnElement>('conditionExpression');
    const body = condition?.peek<unknown>('body');
    const language = condition?.peek<string>('language');
    const isDefault = element.peek<BpmnElement>('sourceRef')?.peek<BpmnElement>('default') === element;
    return { condition: body || undefined, language: language || undefined, default: isDefault || undefined };
  }

  private static labelOf(reference: BpmnElement | undefined): string | undefined {
    return reference && (reference.name || ElementText.shownId(reference));
  }

  private static ownedProperties(element: BpmnElement): Record<string, unknown> {
    return {
      text: element.is('bpmn:TextAnnotation') ? element.peek<string>('text') : undefined,
      isExecutable: element.is('bpmn:Process') ? element.peek<boolean>('isExecutable') === true : undefined,
      errorCode: element.is('bpmn:Error') ? element.peek<string>('errorCode') : undefined,
      escalationCode: element.is('bpmn:Escalation') ? element.peek<string>('escalationCode') : undefined,
      dataStore: element.is('bpmn:DataStoreReference') ? ElementProperties.labelOf(element.peek<BpmnElement>('dataStoreRef')) : undefined,
      default: element.is('bpmn:FlowNode') ? element.peek<BpmnElement>('default')?.peek<string>('id') : undefined,
    };
  }

  private static without(values: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  }

  of(element: BpmnElement, summary: ElementSummary): Record<string, unknown> {
    const attrs = Object.entries({ ...this.base(element, summary), ...this.settable(element) });
    return Object.fromEntries(attrs.filter(([key]) => !ElementProperties.SHOWN_ELSEWHERE.includes(key)));
  }

  private base(element: BpmnElement, summary: ElementSummary): Record<string, unknown> {
    const process = element.peek<BpmnElement>('processRef');
    const subProcess = element.is('bpmn:SubProcess') ? { expanded: this.document.diagram.expansionState().get(element.id) !== false, triggeredByEvent: Kinds.isEventSubProcess(element) || undefined } : {};
    return ElementProperties.without({
      ...subProcess,
      ...summary.props,
      ...(element.is('bpmn:SequenceFlow') ? ElementProperties.flowProperties(element) : {}),
      ...(element.is('bpmn:Participant') ? { process: process && ElementText.shownId(process), blackBox: process ? undefined : true } : {}),
      ...ElementProperties.ownedProperties(element),
    });
  }

  private settable(element: BpmnElement): Record<string, unknown> {
    const catalog = PropertyCatalog.of(element);
    const values = catalog.readBeforeGeneric(this.document);
    for (const property of element.descriptor.properties ?? []) {
      const value = Object.hasOwn(element.raw, property.name) ? element.peek(property.name) : undefined;
      const skipped = ['id', 'name', 'default'].includes(property.name) || !catalog.isSettable(property) || value === undefined || value === null || value === '';
      if (!skipped) {
        values[property.name] = property.isReference && value instanceof BpmnElement ? value.peek<string>('id') : value;
      }
    }
    for (const [name, value] of Object.entries(element.attrs)) {
      if (!name.startsWith('xmlns') && typeof value !== 'object') {
        values[name] = value;
      }
    }
    return { ...values, ...catalog.readAfterGeneric(this.document), ...this.nested(element) };
  }

  private nested(element: BpmnElement): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const { prefix, el } of ElementSlots.entriesOf(element)) {
      if (prefix.includes('[')) {
        values[prefix] = Kinds.typeLabel(el);
      }
      const id = el.get<string | undefined>('id');
      if (id) {
        values[`${prefix}.id`] = id;
      }
      for (const [name, value] of Object.entries(ElementText.vendorAttributes(el))) {
        values[`${prefix}.${name}`] = value;
      }
    }
    return values;
  }
}
