import { DecisionLinkReader, ElementSlots, ElementText, Kinds, Triggers, ZeebeDescriptor, type BpmnElement } from '../../model/index.js';
import { Phrase, type ElementRef, type ExtensionFacts, type FlowTraits, type OutgoingFlow } from '../lines/index.js';
import { ExtensionLister, type ExtensionInfo } from './ExtensionLister.js';
import { TriggerDescription } from './TriggerDescription.js';

export interface Implementation {
  attrs?: Record<string, string> | undefined;
  ext?: string[] | undefined;
}

export class ElementFacts {
  private static readonly MAX_CHILDREN = 6;
  private static readonly ITEM_VALUE_MAX = 40;
  private static readonly ASSIGNMENT_KEYS = ['assignee', 'candidateGroups', 'candidateUsers'];
  private static readonly LOOP_KEYS = ['inputCollection', 'inputElement', 'outputCollection', 'outputElement'];
  private static readonly IO_TYPES = /(^|:)(inputOutput|ioMapping)$/;

  constructor(private readonly element: BpmnElement) {}

  private static bodyOf(expression: BpmnElement | undefined): string | undefined {
    const body = expression?.peek<unknown>('body');
    return typeof body === 'string' && body ? body : undefined;
  }

  private static resourceOf(expression: BpmnElement | undefined): { key: string; value: string } | undefined {
    const key = Object.keys(expression?.attrs ?? {}).find((name) => /:resource$/.test(name) && !name.startsWith('xmlns'));
    const value = key ? expression?.attrs[key] : undefined;
    return key && typeof value === 'string' && value ? { key, value } : undefined;
  }

  private static zeebeExtension(element: BpmnElement | undefined, local: string): BpmnElement | undefined {
    const values = element?.peek<BpmnElement>('extensionElements')?.list('values') ?? [];
    return values.find((value) => value.descriptor.ns?.uri === ZeebeDescriptor.URI && value.type.endsWith(`:${local}`));
  }

  private static localName(type: string): string {
    return type.split(':')[1] ?? type;
  }

  private static ioItem(extension: ExtensionFacts): string | undefined {
    if (!ElementFacts.IO_TYPES.test(extension.type)) {
      return undefined;
    }
    const namesOf = (locals: string[]): string[] => (extension.children ?? []).filter(({ type }) => locals.includes(ElementFacts.localName(type))).map(({ attrs }) => attrs['name'] ?? attrs['target'] ?? '?');
    const inputs = namesOf(['inputParameter', 'input']);
    const outputs = namesOf(['outputParameter', 'output']);
    const parts = [...(inputs.length ? [`in ${inputs.join(', ')}`] : []), ...(outputs.length ? [`out ${outputs.join(', ')}`] : [])];
    return `io: ${parts.length ? parts.join('; ') : 'empty'}`;
  }

  private static childKey(child: ExtensionFacts): string {
    const { name, id, key, target, event } = child.attrs;
    return name ?? id ?? key ?? target ?? event ?? ElementFacts.localName(child.type);
  }

  private static itemValue(value: string): string {
    return /;/.test(value) ? new Phrase(value).cutQuoted(ElementFacts.ITEM_VALUE_MAX) : new Phrase(value).flag(ElementFacts.ITEM_VALUE_MAX);
  }

  private static extensionItem(extension: ExtensionInfo): string {
    const prefix = extension.slot ? `${extension.slot}.` : '';
    const io = ElementFacts.ioItem(extension);
    if (io) {
      return `${prefix}${io}`;
    }
    const children = extension.children ?? [];
    if (!children.length) {
      const attrs = Object.entries(extension.attrs).map(([key, value]) => `${key}=${ElementFacts.itemValue(value)}`);
      const body = extension.body?.trim() ? [`body=${ElementFacts.itemValue(extension.body)}`] : [];
      return [`${prefix}${extension.type}`, ...attrs, ...body].join(' ');
    }
    const keys = children.slice(0, ElementFacts.MAX_CHILDREN).map(ElementFacts.childKey);
    const more = children.length - keys.length;
    return `${prefix}${extension.type}: ${keys.join(', ')}${more ? `, +${more} more` : ''}`;
  }

  static refOf(element: BpmnElement | undefined): ElementRef {
    return element ? { id: ElementText.shownId(element), kind: Kinds.labelOrType(element), name: element.name || undefined } : { id: ElementText.UNKNOWN_ID, kind: ElementText.UNKNOWN_ID };
  }

  ref(): ElementRef {
    return ElementFacts.refOf(this.element);
  }

  trigger(): string | undefined {
    return new TriggerDescription(this.element).text();
  }

  nonInterrupting(): boolean | undefined {
    const { element } = this;
    const cancelsActivity = element.is('bpmn:BoundaryEvent') && element.peek<boolean>('cancelActivity') === false;
    const keepsScope = element.is('bpmn:StartEvent') && element.peek<boolean>('isInterrupting') === false;
    return cancelsActivity || keepsScope ? true : undefined;
  }

  documentation(): string | undefined {
    const texts = this.element.list('documentation').map((entry) => entry.peek<string>('text')).filter((text): text is string => typeof text === 'string' && !!text.trim());
    return texts.length ? texts.join(' ') : undefined;
  }

  props({ zeebe = true }: { zeebe?: boolean } = {}): Record<string, unknown> | undefined {
    const definitions = ElementSlots.definitionsOf(this.element);
    const own: Record<string, unknown> = { ...this.loopProps(), ...this.linkedProps(), ...(definitions.length > 1 ? { definitions: definitions.map((definition) => Triggers.ofDefinition(definition) ?? definition.type).join('+') } : {}) };
    const props = zeebe ? { ...own, ...this.zeebeProps(own['calledElement']) } : own;
    return Object.keys(props).length ? props : undefined;
  }

  vendorValues(skip: (slot: string, key: string) => boolean = () => false): Record<string, string> | undefined {
    const values = { ...ElementText.vendorAttributes(this.element) };
    for (const { prefix, el } of ElementSlots.entriesOf(this.element)) {
      for (const [key, value] of Object.entries(ElementText.vendorAttributes(el))) {
        if (!skip(prefix, key)) {
          values[`${prefix}.${key}`] = value;
        }
      }
    }
    return Object.keys(values).length ? values : undefined;
  }

  extensionElements(): string[] | undefined {
    const types = this.element.peek<BpmnElement>('extensionElements')?.list('values').map((value) => value.type) ?? [];
    return types.length ? types : undefined;
  }

  flowTraits(): FlowTraits {
    const flow = this.element;
    const condition = flow.peek<BpmnElement>('conditionExpression');
    return {
      name: flow.name || undefined,
      condition: ElementFacts.bodyOf(condition),
      conditionResource: ElementFacts.resourceOf(condition)?.value,
      default: flow.peek<BpmnElement>('sourceRef')?.peek<BpmnElement>('default') === flow ? true : undefined,
    };
  }

  outgoingFlow(): OutgoingFlow {
    const flow = this.element;
    const condition = flow.peek<BpmnElement>('conditionExpression');
    const resource = ElementFacts.resourceOf(condition)?.key;
    return {
      ...this.ref(),
      ...this.flowTraits(),
      target: ElementFacts.refOf(flow.peek<BpmnElement>('targetRef')),
      language: condition?.peek<string>('language') || undefined,
      attrs: this.vendorValues((slot, key) => slot === 'condition' && key === resource),
      extensionElements: this.extensionElements(),
    };
  }

  correlationKey(): string | undefined {
    return ElementFacts.zeebeExtension(this.element, 'subscription')?.peek<string>('correlationKey');
  }

  implementation(): Implementation | undefined {
    const attrs = this.vendorValues();
    const groups = new Map<string, ExtensionInfo[]>();
    for (const extension of new ExtensionLister().listAll(this.element)) {
      const key = `${extension.slot ? `${extension.slot}.` : ''}${extension.type}`;
      groups.set(key, [...(groups.get(key) ?? []), extension]);
    }
    const ext = [...groups].map(([key, items]) => (items.length > 1 ? `${key} x${items.length}` : ElementFacts.extensionItem(items[0]!)));
    return attrs || ext.length ? { attrs, ext: ext.length ? ext : undefined } : undefined;
  }

  private loopProps(): Record<string, unknown> {
    const loop = this.element.peek<BpmnElement>('loopCharacteristics');
    if (!loop) {
      return {};
    }
    const cardinality = ElementFacts.bodyOf(loop.peek<BpmnElement>('loopCardinality'));
    const multiInstance = loop.peek<boolean>('isSequential') ? 'sequential' : 'parallel';
    return { loop: loop.is('bpmn:StandardLoopCharacteristics') ? 'standard' : multiInstance, ...(cardinality ? { cardinality } : {}) };
  }

  private linkedProps(): Record<string, unknown> {
    const { element } = this;
    const called = element.peek<string>('calledElement');
    const decision = new DecisionLinkReader().linkOf(element);
    const message = element.is('bpmn:SendTask') || element.is('bpmn:ReceiveTask') ? element.peek<BpmnElement>('messageRef') : undefined;
    const scriptFormat = element.peek<string>('scriptFormat');
    return {
      ...(called ? { calledElement: called } : {}),
      ...(decision ? { calledDecision: decision.value } : {}),
      ...(element.peek<boolean>('isForCompensation') === true ? { isForCompensation: true } : {}),
      ...(message ? { message: message.name || ElementText.shownId(message) } : {}),
      ...(scriptFormat ? { scriptFormat } : {}),
    };
  }

  private zeebeProps(calledElement: unknown): Record<string, unknown> {
    const { element } = this;
    const extension = (local: string): BpmnElement | undefined => ElementFacts.zeebeExtension(element, local);
    const picked = (from: BpmnElement | undefined, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map((key) => [key, from?.peek<string>(key)]));
    const form = extension('formDefinition');
    const script = extension('script');
    const result = script?.peek<string>('resultVariable');
    const props = {
      job: extension('taskDefinition')?.peek<string>('type'),
      calledElement: calledElement ?? extension('calledElement')?.peek<string>('processId'),
      script: script && `${script.peek<string>('expression') ?? ''}${result ? ` -> ${result}` : ''}`,
      form: form?.peek<string>('formId') ?? form?.peek<string>('externalReference') ?? form?.peek<string>('formKey'),
      ...picked(extension('assignmentDefinition'), ElementFacts.ASSIGNMENT_KEYS),
      ...picked(ElementFacts.zeebeExtension(element.peek<BpmnElement>('loopCharacteristics'), 'loopCharacteristics'), ElementFacts.LOOP_KEYS),
    };
    return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
  }
}
