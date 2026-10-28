import { triggerOfDefinition } from '../document/Kinds.js';
import { is, list, peek, shownId, type El } from '../document/utils/moddle.js';
import { DecisionLinkReader } from '../editing/properties/DecisionLinkReader.js';
import { EventTrigger } from '../editing/events/EventTrigger.js';
import { ExtensionLister, type ExtensionInfo } from '../document/ExtensionLister.js';
import { definitionsOf, nestedEntries } from '../document/utils/nested-slots.js';
import { vendorAttributes } from '../document/utils/elements.js';
import { ZEEBE_URI } from '../document/vendor/ZeebeDescriptor.js';
import type { Implementation } from './around-view.js';
import type { FlowRef, ViewFlow } from './model-view.js';
import { bodyOf, compact, nameOf, nonEmpty, refLabel, resourceOf, truncate } from './utils/view.js';

const MAX_CHILDREN = 6;

export class ElementFacts {
  constructor(private readonly el: El) {}

  trigger(): string | undefined {
    return new EventTrigger(this.el).describe() || undefined;
  }


  nonInterrupting(): boolean | undefined {
    if (is(this.el, 'bpmn:BoundaryEvent')) return peek<boolean>(this.el, 'cancelActivity') === false ? true : undefined;
    if (is(this.el, 'bpmn:StartEvent')) return peek<boolean>(this.el, 'isInterrupting') === false ? true : undefined;
    return undefined;
  }

  documentation(): string | undefined {
    const texts = list(this.el, 'documentation')
      .map((documentation) => peek<string>(documentation, 'text'))
      .filter((text): text is string => typeof text === 'string' && !!text.trim());
    return texts.length ? texts.join(' ') : undefined;
  }

  /**
   * `zeebe: false` leaves out the Camunda 8 settings, which the reading views print in full.
   * `calledDecision` comes from calledDecision, camunda:decisionRef or zeebe:calledDecision;
   * `definitions` lists all triggers of several event definitions, as the label shows only the first.
   */
  props(opts: { zeebe?: boolean } = {}): Record<string, unknown> | undefined {
    const el = this.el;
    const props: Record<string, unknown> = {};
    const loop = peek<El>(el, 'loopCharacteristics');
    if (loop) {
      if (is(loop, 'bpmn:StandardLoopCharacteristics')) props['loop'] = 'standard';
      else props['loop'] = peek<boolean>(loop, 'isSequential') ? 'sequential' : 'parallel';
      const cardinality = bodyOf(peek<El>(loop, 'loopCardinality'));
      if (cardinality) props['cardinality'] = cardinality;
    }
    const called = peek<string>(el, 'calledElement');
    if (called) props['calledElement'] = called;
    const decision = new DecisionLinkReader().linkOf(el);
    if (decision) props['calledDecision'] = decision.value;
    if (peek<boolean>(el, 'isForCompensation') === true) props['isForCompensation'] = true;
    const messageRef = peek<El>(el, 'messageRef');
    if (messageRef && (is(el, 'bpmn:SendTask') || is(el, 'bpmn:ReceiveTask'))) props['message'] = refLabel(messageRef);
    const scriptFormat = peek<string>(el, 'scriptFormat');
    if (scriptFormat) props['scriptFormat'] = scriptFormat;
    const defs = definitionsOf(el);
    if (defs.length > 1) props['definitions'] = defs.map((definition) => triggerOfDefinition(definition) ?? definition.$type).join('+');
    if (opts.zeebe !== false) this.zeebeProps(props);
    return Object.keys(props).length ? props : undefined;
  }

  /** Nested elements' values under `<slot>.<key>` (`definition[1].<key>`). */
  vendorValues(skip: (slot: string, key: string) => boolean = () => false): Record<string, string> | undefined {
    const out: Record<string, string> = { ...vendorAttributes(this.el) };
    for (const { prefix, el: nested } of nestedEntries(this.el)) {
      for (const [key, value] of Object.entries(vendorAttributes(nested))) if (!skip(prefix, key)) out[`${prefix}.${key}`] = value;
    }
    return Object.keys(out).length ? out : undefined;
  }

  extensionTypes(): string[] {
    const container = peek<El>(this.el, 'extensionElements');
    return container ? list(container, 'values').map((extensionValue) => extensionValue.$type) : [];
  }

  extensionMentions(): string[] | undefined {
    const mentions = [...this.extensionTypes(), ...Object.keys(vendorAttributes(this.el))];
    return mentions.length ? [...new Set(mentions)] : undefined;
  }

  flowRef(): FlowRef {
    const flow = this.el;
    const source = peek<El>(flow, 'sourceRef');
    const cond = peek<El>(flow, 'conditionExpression');
    return compact<FlowRef>({
      id: shownId(flow),
      name: nameOf(flow),
      condition: bodyOf(cond),
      conditionResource: resourceOf(cond)?.value,
      default: source && peek<El>(source, 'default') === flow ? true : undefined,
    });
  }

  flow(): ViewFlow {
    const flow = this.el;
    const cond = peek<El>(flow, 'conditionExpression');
    const resource = resourceOf(cond);
    const { id, name, condition, conditionResource, default: isDefault } = this.flowRef();
    return compact({
      id,
      target: shownId(peek<El>(flow, 'targetRef')),
      name,
      condition,
      conditionResource,
      language: cond ? peek<string>(cond, 'language') || undefined : undefined,
      default: isDefault,
      attrs: this.vendorValues((slot, key) => slot === 'condition' && key === resource?.key),
      extensions: this.extensionMentions(),
      extensionElements: nonEmpty(this.extensionTypes()),
    });
  }

  correlationKey(): string | undefined {
    const subscription = ElementFacts.zeebeExt(this.el, 'subscription');
    return subscription ? peek<string>(subscription, 'correlationKey') : undefined;
  }

  implementation(): Implementation | undefined {
    const attrs = this.vendorValues();
    const all = new ExtensionLister().listAll(this.el);
    const groups = new Map<string, ExtensionInfo[]>();
    for (const extension of all) {
      const key = `${extension.slot ? `${extension.slot}.` : ''}${extension.type}`;
      groups.set(key, [...(groups.get(key) ?? []), extension]);
    }
    const ext = [...groups].map(([key, items]) => (items.length > 1 ? `${key} x${items.length}` : this.extensionItem(items[0]!)));
    return attrs || ext.length ? compact<Implementation>({ attrs, ext: nonEmpty(ext) }) : undefined;
  }

  /** Camunda 8 settings are extension elements, so `attrs` cannot show them. */
  private zeebeProps(props: Record<string, unknown>): void {
    const el = this.el;
    const job = ElementFacts.zeebeExt(el, 'taskDefinition');
    if (job && peek<string>(job, 'type') !== undefined) props['job'] = peek<string>(job, 'type');
    const called = ElementFacts.zeebeExt(el, 'calledElement');
    if (called && props['calledElement'] === undefined && peek<string>(called, 'processId') !== undefined) props['calledElement'] = peek<string>(called, 'processId');
    const script = ElementFacts.zeebeExt(el, 'script');
    if (script) props['script'] = `${peek<string>(script, 'expression') ?? ''}${peek<string>(script, 'resultVariable') ? ` -> ${peek<string>(script, 'resultVariable')}` : ''}`;
    const form = ElementFacts.zeebeExt(el, 'formDefinition');
    const formRef = form ? (peek<string>(form, 'formId') ?? peek<string>(form, 'externalReference') ?? peek<string>(form, 'formKey')) : undefined;
    if (formRef !== undefined) props['form'] = formRef;
    const assignment = ElementFacts.zeebeExt(el, 'assignmentDefinition');
    for (const key of ['assignee', 'candidateGroups', 'candidateUsers']) {
      const value = assignment ? peek<string>(assignment, key) : undefined;
      if (value !== undefined) props[key] = value;
    }
    const loop = ElementFacts.zeebeExt(peek<El>(el, 'loopCharacteristics'), 'loopCharacteristics');
    for (const key of ['inputCollection', 'inputElement', 'outputCollection', 'outputElement']) {
      const value = loop ? peek<string>(loop, key) : undefined;
      if (value !== undefined) props[key] = value;
    }
  }

  /** Any prefix bound to the zeebe namespace counts. */
  private static zeebeExt(el: El | undefined, local: string): El | undefined {
    const container = el ? peek<El>(el, 'extensionElements') : undefined;
    return container ? list(container, 'values').find((extensionValue) => (extensionValue.$descriptor as { ns?: { uri?: string } }).ns?.uri === ZEEBE_URI && extensionValue.$type.endsWith(`:${local}`)) : undefined;
  }

  private extensionItem(extension: ExtensionInfo): string {
    const prefix = extension.slot ? `${extension.slot}.` : '';
    const io = ElementFacts.ioItem(extension);
    if (io) return `${prefix}${io}`;
    const children = extension.children ?? [];
    if (!children.length) {
      const attrs = Object.entries(extension.attrs).map(([key, value]) => `${key}=${ElementFacts.itemValue(value)}`);
      const body = extension.body?.trim() ? [`body=${ElementFacts.itemValue(extension.body)}`] : [];
      return [`${prefix}${extension.type}`, ...attrs, ...body].join(' ');
    }
    const keys = children.slice(0, MAX_CHILDREN).map(ElementFacts.childKey);
    return `${prefix}${extension.type}: ${keys.join(', ')}${children.length > MAX_CHILDREN ? `, +${children.length - MAX_CHILDREN} more` : ''}`;
  }

  private static ioItem(extension: ExtensionInfo | Omit<ExtensionInfo, 'index'>): string | undefined {
    const local = extension.type.split(':')[1] ?? extension.type;
    const isIo = local === 'inputOutput' || extension.type === 'zeebe:ioMapping';
    if (!isIo) return undefined;
    const ins: string[] = [];
    const outs: string[] = [];
    for (const child of extension.children ?? []) {
      const cl = child.type.split(':')[1] ?? child.type;
      const name = child.attrs['name'] ?? child.attrs['target'] ?? '?';
      if (cl === 'inputParameter' || cl === 'input') ins.push(name);
      else if (cl === 'outputParameter' || cl === 'output') outs.push(name);
    }
    const parts = [ins.length ? `in ${ins.join(', ')}` : '', outs.length ? `out ${outs.join(', ')}` : ''].filter(Boolean);
    return `io: ${parts.length ? parts.join('; ') : 'empty'}`;
  }

  private static childKey(child: Omit<ExtensionInfo, 'index'>): string {
    return child.attrs['name'] ?? child.attrs['id'] ?? child.attrs['key'] ?? child.attrs['target'] ?? child.attrs['event'] ?? (child.type.split(':')[1] ?? child.type);
  }

  private static itemValue(value: string, max = 40): string {
    return /^[^\s,;[\]"]+$/.test(value) && value.length <= max ? value : `"${truncate(value, max).replace(/"/g, '\\"')}"`;
  }
}
