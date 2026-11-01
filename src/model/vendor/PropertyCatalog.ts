import type { BpmnDocument } from '../document/BpmnDocument.js';
import type { BpmnElement, PropertyDescriptor } from '../document/BpmnElement.js';
import { BpmnError } from '../errors/BpmnError.js';
import { ElementSlots } from '../kinds/ElementSlots.js';
import { Kinds } from '../kinds/Kinds.js';
import { Triggers } from '../kinds/Triggers.js';
import { PropertyKeys, type PropertyDefinition } from './PropertyKeys.js';

export interface PropertyDoc {
  key: string;
  appliesTo: string;
  description: string;
}

interface EnumerationPackage {
  enumerations?: Array<{ name: string; literalValues?: Array<{ name: string }> }>;
}

export class PropertyCatalog {
  private static readonly BLOCKED: Readonly<Record<string, string>> = {
    attachedToRef: 'use `bpmn move <file> <id> --on <activityId>`',
    sourceRef: 'use source=<nodeId>',
    targetRef: 'use target=<nodeId>',
    processRef: 'a participant is bound to its process on creation',
    bpmnElement: 'diagram interchange is generated automatically',
  };

  private static readonly PRIMITIVE_TYPES: ReadonlySet<string> = new Set(['String', 'Boolean', 'Integer', 'Real']);

  private static readonly APPLIES_TO: Readonly<Record<string, (element: BpmnElement) => boolean>> = {
    any: () => true,
    sequenceFlow: (element) => element.is('bpmn:SequenceFlow'),
    flowNode: (element) => element.is('bpmn:FlowNode'),
    event: (element) => element.is('bpmn:Event'),
    activity: (element) => element.is('bpmn:Activity'),
    subProcess: (element) => element.is('bpmn:SubProcess'),
    textAnnotation: (element) => element.is('bpmn:TextAnnotation'),
    'sendTask, receiveTask': (element) => element.is('bpmn:SendTask') || element.is('bpmn:ReceiveTask'),
    businessRuleTask: (element) => element.is('bpmn:BusinessRuleTask'),
    conditionalEvent: (element) => element.is('bpmn:Event') && Triggers.of(element) === 'conditional',
  };

  private constructor(private readonly element: BpmnElement) {}

  static of(element: BpmnElement): PropertyCatalog {
    return new PropertyCatalog(element);
  }

  static docs(): PropertyDoc[] {
    return PropertyKeys.ALL.map(({ key, appliesTo, description }) => ({ key, appliesTo, description }));
  }

  static blockedReason(key: string): string | undefined {
    return PropertyCatalog.BLOCKED[key];
  }

  private static isPlaceholder(definition: PropertyDoc): boolean {
    return definition.key.startsWith('<');
  }

  private static appliesTo(definition: PropertyDoc, element: BpmnElement): boolean {
    return !!PropertyCatalog.APPLIES_TO[definition.appliesTo]?.(element);
  }

  private static genericPosition(): number {
    return PropertyKeys.ALL.findIndex(PropertyCatalog.isPlaceholder);
  }

  isSettable(property: PropertyDescriptor): boolean {
    if (property.isMany || PropertyCatalog.BLOCKED[property.name]) {
      return false;
    }
    if (property.isReference) {
      return !!property.isAttr;
    }
    return PropertyCatalog.PRIMITIVE_TYPES.has(property.type) || !!this.enumLiterals(property.type);
  }

  enumLiterals(type: string): string[] | undefined {
    const [prefix, local] = type.split(':');
    if (!prefix || !local) {
      return undefined;
    }
    let found: EnumerationPackage | undefined;
    try {
      found = this.element.raw.$model.getPackage(prefix) as EnumerationPackage | undefined;
    } catch {
      return undefined;
    }
    return found?.enumerations?.find((enumeration) => enumeration.name === local)?.literalValues?.map((literal) => literal.name);
  }

  genericKeys(): string[] {
    return (this.element.descriptor.properties ?? []).filter((property) => property.name !== 'id' && this.isSettable(property)).map((property) => property.name);
  }

  settableKeys(): string[] {
    const keys = new Set<string>();
    for (const definition of PropertyKeys.ALL) {
      if (!PropertyCatalog.isPlaceholder(definition) && PropertyCatalog.appliesTo(definition, this.element)) {
        keys.add(definition.key);
      }
    }
    for (const key of this.genericKeys()) {
      keys.add(key);
    }
    keys.add('<prefix>:<attr>');
    return [...keys];
  }

  entry(key: string): PropertyDefinition {
    const documented = this.definitions().find((definition) => definition.key === key);
    if (documented) {
      return documented;
    }
    const nested = ElementSlots.splitKey(key);
    const slot = nested && ElementSlots.parseRef(nested.slot)?.slot;
    if (slot) {
      const slotEntry = this.definitions().find((definition) => definition.key === `${slot}.<key>`);
      if (slotEntry) {
        return slotEntry;
      }
    }
    if (key.includes(':')) {
      this.assertVendorKey(key);
      return PropertyKeys.ALL.find((definition) => definition.key === '<prefix>:<attr>')!;
    }
    if (this.genericKeys().includes(key)) {
      return PropertyKeys.ALL.find((definition) => definition.key === '<property>')!;
    }
    throw this.unknownKey(key);
  }

  unknownKey(key: string, reason?: string): BpmnError {
    const keys = this.settableKeys();
    const { element } = this;
    return BpmnError.model('E_UNKNOWN_KEY', `Unknown key "${key}" for ${Kinds.label(element)} ${element.id}${reason ? ` (${reason})` : ''}`, {
      element: element.id,
      candidates: keys,
      hint: `Settable keys for this element: ${keys.join(', ')}.`,
    });
  }

  assertVendorKey(key: string): void {
    const separator = key.indexOf(':');
    const [prefix, local] = [key.slice(0, separator), key.slice(separator + 1)];
    if (!prefix || !local || prefix === 'xmlns') {
      throw this.unknownKey(key, 'vendor attributes look like prefix:name');
    }
  }

  readBeforeGeneric(document: BpmnDocument): Record<string, unknown> {
    return this.readAll(PropertyKeys.ALL.slice(0, PropertyCatalog.genericPosition()), document);
  }

  readAfterGeneric(document: BpmnDocument): Record<string, unknown> {
    return this.readAll(PropertyKeys.ALL.slice(PropertyCatalog.genericPosition()), document);
  }

  private definitions(): PropertyDefinition[] {
    return PropertyKeys.ALL.filter((definition) => !PropertyCatalog.isPlaceholder(definition) && PropertyCatalog.appliesTo(definition, this.element));
  }

  private readAll(definitions: readonly PropertyDefinition[], document: BpmnDocument): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const definition of definitions) {
      if (definition.read && PropertyCatalog.appliesTo(definition, this.element)) {
        Object.assign(values, definition.read(this.element, document));
      }
    }
    return values;
  }
}
