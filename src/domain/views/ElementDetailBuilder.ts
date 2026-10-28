import type { Doc } from '../document/Doc.js';
import { isEventSubProcess, triggerOf } from '../document/Kinds.js';
import { diExpansionState } from '../diagram/utils/expansion.js';
import { Groups } from '../diagram/di/Groups.js';
import { is, list, peek, shownId, type El } from '../document/utils/moddle.js';
import { ExtensionLister } from '../document/ExtensionLister.js';
import { nestedEntries } from '../document/utils/nested-slots.js';
import { ElementProperties } from './ElementProperties.js';
import { vendorAttributes } from '../document/utils/elements.js';
import { FlowOrder } from '../validation/FlowOrder.js';
import { ElementFacts } from './ElementFacts.js';
import { ElementLinks } from './ElementLinks.js';
import { ElementSummaryBuilder } from './ElementSummaryBuilder.js';
import type { ElementDetail, ElementSummary, NestedDetail } from './model-view.js';
import { bodyOf, compact, nonEmpty, refLabel } from './utils/view.js';

/** `bpmn show <id>`: everything about one element. */
export class ElementDetailBuilder {
  private readonly links: ElementLinks;
  private readonly facts: ElementFacts;

  constructor(
    private readonly doc: Doc,
    private readonly el: El,
  ) {
    this.links = new ElementLinks(doc);
    this.facts = new ElementFacts(el);
  }

  build(): ElementDetail {
    const { doc, el } = this;
    const summary = new ElementSummaryBuilder(doc).build(el);
    const incoming = doc.incoming(el).map((flow) => {
      const { id, ...traits } = new ElementFacts(flow).flowRef();
      return { id, source: shownId(peek<El>(flow, 'sourceRef')), ...traits };
    });
    const nested: Record<string, NestedDetail> = {};
    for (const { prefix, el: nestedElement } of nestedEntries(el)) {
      nested[prefix] = compact<NestedDetail>({ type: nestedElement.$type, id: peek<string>(nestedElement, 'id') || undefined, attrs: vendorAttributes(nestedElement), extensions: new ExtensionLister().list(nestedElement) });
    }
    const boundary = is(el, 'bpmn:Activity') ? doc.boundaryEventsOf(el).map(shownId) : [];
    const children = is(el, 'bpmn:SubProcess') ? new FlowOrder(doc, el).ordered.map(shownId) : [];
    const listed = new ExtensionLister().list(el);
    const extensions: unknown[] = listed.length ? listed : this.facts.extensionTypes().map((type, index) => ({ index, type }));
    const host = peek<El>(el, 'attachedToRef');
    const associations = this.links.associations();
    const messageFlows = is(el, 'bpmn:MessageFlow') ? [] : this.links.messageFlowsOf(el);
    const annotations = is(el, 'bpmn:TextAnnotation') ? [] : this.links.annotationsOf(el);
    const attachedTo = is(el, 'bpmn:TextAnnotation')
      ? associations.flatMap((association) => {
          const source = peek<El>(association, 'sourceRef');
          const target = peek<El>(association, 'targetRef');
          return source === el && target ? [shownId(target)] : target === el && source ? [shownId(source)] : [];
        })
      : [];
    return compact<ElementDetail>({
      id: summary.id,
      kind: summary.kind,
      type: el.$type,
      name: summary.name,
      scope: is(el, 'bpmn:Process') ? undefined : doc.scopeOf(el)?.get<string>('id'),
      process: is(el, 'bpmn:Participant') ? peek<El>(el, 'processRef')?.get<string>('id') : doc.processOf(el)?.get<string>('id'),
      lane: summary.lane,
      host: host ? shownId(host) : undefined,
      properties: { ...this.baseProperties(summary), ...new ElementProperties(doc).read(el) },
      incoming,
      outgoing: summary.outgoing,
      boundary: boundary.length ? boundary : undefined,
      children: children.length ? children : undefined,
      extensions,
      attrs: vendorAttributes(el),
      nested: Object.keys(nested).length ? nested : undefined,
      messageFlows: nonEmpty(messageFlows),
      annotations: nonEmpty(annotations),
      attachedTo: nonEmpty(attachedTo),
      data: this.links.dataLinksOf(el),
    });
  }

  /** ElementProperties.read() overrides these key by key. */
  private baseProperties(summary: ElementSummary): Record<string, unknown> {
    const { doc, el } = this;
    const props: Record<string, unknown> = {};
    if (summary.documentation) props['documentation'] = summary.documentation;
    if (is(el, 'bpmn:Event')) {
      const trigger = triggerOf(el);
      if (trigger) props['trigger'] = trigger;
      if (summary.trigger) props['triggerDetails'] = summary.trigger;
      if (summary.nonInterrupting) props['nonInterrupting'] = true;
    }
    if (is(el, 'bpmn:SubProcess')) {
      props['expanded'] = diExpansionState(doc.definitions).get(shownId(el)) !== false;
      if (isEventSubProcess(el)) props['triggeredByEvent'] = true;
    }
    Object.assign(props, summary.props ?? {});
    if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association')) {
      props['source'] = shownId(peek<El>(el, 'sourceRef'));
      props['target'] = shownId(peek<El>(el, 'targetRef'));
    }
    if (is(el, 'bpmn:SequenceFlow')) {
      const cond = peek<El>(el, 'conditionExpression');
      const body = bodyOf(cond);
      if (body) props['condition'] = body;
      const language = cond ? peek<string>(cond, 'language') : undefined;
      if (language) props['language'] = language;
      const source = peek<El>(el, 'sourceRef');
      if (source && peek<El>(source, 'default') === el) props['default'] = true;
    }
    if (is(el, 'bpmn:MessageFlow') && peek<El>(el, 'messageRef')) props['message'] = refLabel(peek<El>(el, 'messageRef'));
    if (is(el, 'bpmn:Participant')) {
      const process = peek<El>(el, 'processRef');
      props['process'] = process ? shownId(process) : undefined;
      if (!process) props['blackBox'] = true;
    }
    if (is(el, 'bpmn:Lane')) props['members'] = list(el, 'flowNodeRef').map(shownId);
    if (is(el, 'bpmn:Group')) props['members'] = new Groups(doc.definitions).members().get(shownId(el)) ?? [];
    if (is(el, 'bpmn:TextAnnotation')) props['text'] = peek<string>(el, 'text');
    if (is(el, 'bpmn:Process')) props['isExecutable'] = peek<boolean>(el, 'isExecutable') === true;
    if (is(el, 'bpmn:Error')) props['errorCode'] = peek<string>(el, 'errorCode');
    if (is(el, 'bpmn:Escalation')) props['escalationCode'] = peek<string>(el, 'escalationCode');
    if (is(el, 'bpmn:DataStoreReference')) props['dataStore'] = peek<El>(el, 'dataStoreRef') ? refLabel(peek<El>(el, 'dataStoreRef')) : undefined;
    if (is(el, 'bpmn:FlowNode')) {
      const def = peek<El>(el, 'default');
      if (def) props['default'] = shownId(def);
    }
    return compact(props);
  }
}
