import type { Doc } from '../document/Doc.js';
import { isEventSubProcess, triggerOf } from '../document/utils/kinds.js';
import { diExpansionState } from '../diagram/utils/expansion.js';
import { Groups } from '../diagram/di/Groups.js';
import { is, list, peek, shownId, type El } from '../document/utils/moddle.js';
import { laneOf } from '../document/utils/lanes.js';
import { ExtensionLister } from '../document/ExtensionLister.js';
import { nestedEntries } from '../document/utils/nested-slots.js';
import { ElementProperties } from '../editing/ElementProperties.js';
import { vendorAttributes } from '../document/utils/elements.js';
import { FlowOrder } from '../validation/FlowOrder.js';
import { StructuralValidator } from '../validation/StructuralValidator.js';
import { ElementFacts } from './ElementFacts.js';
import { ElementLinks } from './ElementLinks.js';
import type { ElementDetail, NestedDetail } from './model-view.js';
import { bodyOf, compact, labelOf, nameOf, nonEmpty, refLabel, resourceOf } from './utils/view.js';

/**
 * `bpmn show <id>`: everything about one element. Missing incoming / outgoing mirror entries
 * are added first, so flows of hand-written files show up.
 */
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
    new StructuralValidator(doc).repairFlowLinks();
    const isNode = is(el, 'bpmn:FlowNode');
    const incoming = doc.incoming(el).map((flow) => {
      const source = peek<El>(flow, 'sourceRef');
      return compact({
        id: shownId(flow),
        source: shownId(source),
        name: nameOf(flow),
        condition: bodyOf(peek<El>(flow, 'conditionExpression')),
        conditionResource: resourceOf(peek<El>(flow, 'conditionExpression'))?.value,
        default: source && peek<El>(source, 'default') === flow ? true : undefined,
      });
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
      id: shownId(el),
      kind: labelOf(el),
      type: el.$type,
      name: nameOf(el),
      scope: is(el, 'bpmn:Process') ? undefined : doc.scopeOf(el)?.get<string>('id'),
      process: is(el, 'bpmn:Participant') ? peek<El>(el, 'processRef')?.get<string>('id') : doc.processOf(el)?.get<string>('id'),
      lane: isNode && !is(el, 'bpmn:BoundaryEvent') ? laneOf(doc, el)?.get<string>('id') : undefined,
      host: host ? shownId(host) : undefined,
      properties: { ...this.baseProperties(), ...new ElementProperties(doc).read(el) },
      incoming,
      outgoing: doc.outgoing(el).map((flow) => new ElementFacts(flow).flow()),
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
  private baseProperties(): Record<string, unknown> {
    const { doc, el, facts } = this;
    const props: Record<string, unknown> = {};
    const documentation = facts.documentation();
    if (documentation) props['documentation'] = documentation;
    if (is(el, 'bpmn:Event')) {
      const trigger = triggerOf(el);
      if (trigger) props['trigger'] = trigger;
      const details = facts.trigger();
      if (details) props['triggerDetails'] = details;
      if (facts.nonInterrupting()) props['nonInterrupting'] = true;
    }
    if (is(el, 'bpmn:SubProcess')) {
      props['expanded'] = diExpansionState(doc.definitions).get(shownId(el)) !== false;
      if (isEventSubProcess(el)) props['triggeredByEvent'] = true;
    }
    Object.assign(props, facts.props() ?? {});
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
