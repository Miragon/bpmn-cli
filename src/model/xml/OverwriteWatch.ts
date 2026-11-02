import type { ModdleObject } from '../document/BpmnElement.js';

export interface ImportWarning {
  message: string;
  element?: ModdleObject;
  property?: string;
  value?: string;
}

export interface ImportResult {
  rootElement: ModdleObject;
  elementsById: Record<string, ModdleObject>;
  references: Array<{ element: ModdleObject; property: string; id: string }>;
  warnings: ImportWarning[];
}

export interface BpmnModdle {
  create(type: string, attrs?: Record<string, unknown>): ModdleObject;
  createAny(name: string, uri: string, properties?: Record<string, unknown>): ModdleObject;
  getType(type: string): unknown;
  getElementDescriptor(type: unknown): unknown;
  fromXML(xml: string): Promise<ImportResult>;
  toXML(element: ModdleObject, options: { format: boolean }): Promise<{ xml: string }>;
}

interface PropertyAccess {
  set(target: ModdleObject, name: string, value: unknown): void;
}

interface Overwrite {
  holder: ModdleObject;
  prop: string;
  lost: ModdleObject;
  kept: ModdleObject;
}

export class OverwriteWatch {
  private readonly properties: PropertyAccess;
  private readonly hadOwnSet: boolean;
  private readonly original: PropertyAccess['set'];
  private readonly found: Overwrite[] = [];

  constructor(moddle: BpmnModdle) {
    this.properties = (moddle as unknown as { properties: PropertyAccess }).properties;
    this.hadOwnSet = Object.hasOwn(this.properties, 'set');
    this.original = this.properties.set;
    const watch = this;
    this.properties.set = function set(this: PropertyAccess, target: ModdleObject, name: string, value: unknown): void {
      watch.record(target, name, value);
      watch.original.call(this, target, name, value);
    };
  }

  private static isElement(value: unknown): value is ModdleObject {
    return !!value && typeof value === 'object' && typeof (value as ModdleObject).$type === 'string';
  }

  private static text(element: ModdleObject, tag = false): string {
    const id = (element as unknown as Record<string, unknown>)['id'];
    const local = element.$type.split(':')[1] ?? element.$type;
    const name = local.charAt(0).toLowerCase() + local.slice(1);
    if (tag) {
      return `<${element.$type.split(':')[0]}:${name}${typeof id === 'string' ? ` id="${id}"` : ''}>`;
    }
    return `${name}${typeof id === 'string' ? ` ${id}` : ''}`;
  }

  stop(): void {
    if (this.hadOwnSet) {
      this.properties.set = this.original;
    } else {
      delete (this.properties as Partial<PropertyAccess>).set;
    }
  }

  warnings(): ImportWarning[] {
    return this.found.map(({ holder, prop, lost, kept }) => ({
      message: `duplicate element: ${OverwriteWatch.text(holder, true)} has more than one ${prop} (the schema allows one); only the last one, ${OverwriteWatch.text(kept)}, can be kept, ${OverwriteWatch.text(lost)} would be dropped`,
      element: holder,
      property: prop,
    }));
  }

  private record(target: ModdleObject, name: string, value: unknown): void {
    if (!OverwriteWatch.isElement(value) || !/^bpmn:/.test(target.$type)) {
      return;
    }
    const property = target.$descriptor.propertiesByName?.[name];
    if (!property || property.isMany || property.isReference || !Object.hasOwn(target, property.name)) {
      return;
    }
    const current = (target as unknown as Record<string, unknown>)[property.name];
    if (current && current !== value && OverwriteWatch.isElement(current)) {
      this.found.push({ holder: target, prop: property.name, lost: current, kept: value });
    }
  }
}
