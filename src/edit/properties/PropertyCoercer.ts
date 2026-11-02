import { type BpmnElement, BpmnError, CAMUNDA, PropertyCatalog, type PropertyDescriptor, ZeebeDescriptor } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export class PropertyCoercer {
  constructor(private readonly edit: EditSession) {}

  static invalidValue(el: BpmnElement, key: string, message: string, hint?: string) {
    return BpmnError.model('E_INVALID_VALUE', `Invalid value for ${key} on ${el.id}: ${message}`, { element: el.id, ...(hint ? { hint } : {}) });
  }

  static booleanOf(el: BpmnElement, key: string, value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', '0', 'off'].includes(normalized)) {
      return false;
    }
    throw PropertyCoercer.invalidValue(el, key, `"${value}" is not a boolean`, `Use ${key}=true or ${key}=false.`);
  }

  coerce(el: BpmnElement, property: PropertyDescriptor, value: string, label: string = property.name): unknown {
    if (property.isReference) {
      return this.edit.require(value, property.type, property.name);
    }
    switch (property.type) {
      case 'String':
        return value;
      case 'Boolean':
        return PropertyCoercer.booleanOf(el, label, value);
      case 'Integer': {
        if (!/^-?\d+$/.test(value.trim())) {
          throw PropertyCoercer.invalidValue(el, label, `"${value}" is not an integer`);
        }
        return Number(value);
      }
      default: {
        const literals = PropertyCatalog.of(el).enumLiterals(property.type) ?? [];
        const hit = literals.find((literal) => literal.toLowerCase() === value.trim().toLowerCase());
        if (!hit) {
          throw PropertyCoercer.invalidValue(el, label, `"${value}" is not one of ${literals.join('|')}`);
        }
        return hit;
      }
    }
  }

  vendorValue(el: BpmnElement, key: string, value: string, label: string = key): string {
    if (!value) {
      return value;
    }
    const local = this.camundaLocal(key);
    if (!local || CAMUNDA.attr(local)?.type !== 'Boolean') {
      return value;
    }
    return String(PropertyCoercer.booleanOf(el, label, value));
  }

  setVendorAttribute(el: BpmnElement, key: string, value: string): void {
    if (!value) {
      delete el.attrs[key];
      return;
    }
    this.edit.document.namespaces.declare(key.slice(0, key.indexOf(':')));
    el.attrs[key] = value;
  }

  static removeUndefined(el: BpmnElement, key: string, value: string): boolean {
    if (value || key.includes(':') || el.descriptor.propertiesByName?.[key]) {
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(el.attrs, key)) {
      return false;
    }
    delete el.attrs[key];
    return true;
  }

  static isExpression(body: string): boolean {
    return /^\s*[$#]\{[\s\S]*\}\s*$/.test(body);
  }

  isResourceKey(key: string): boolean {
    const [prefix, local] = key.split(':');
    return local === 'resource' && !!prefix && CAMUNDA.reads(this.edit.document.namespaces.uriOf(prefix));
  }

  resourceKeyOf(expr: BpmnElement | undefined): string | undefined {
    if (!expr) {
      return undefined;
    }
    return Object.keys(expr.attrs).find((attrKey) => this.isResourceKey(attrKey) && expr.attrs[attrKey] !== undefined && expr.attrs[attrKey] !== '');
  }

  camundaLocal(key: string): string | undefined {
    const idx = key.indexOf(':');
    if (idx <= 0) {
      return undefined;
    }
    return CAMUNDA.reads(this.edit.document.namespaces.uriOf(key.slice(0, idx))) ? key.slice(idx + 1) : undefined;
  }

  zeebeLocal(key: string): string | undefined {
    const idx = key.indexOf(':');
    if (idx <= 0 || this.edit.document.namespaces.uriOf(key.slice(0, idx)) !== ZeebeDescriptor.URI) {
      return undefined;
    }
    return key.slice(idx + 1);
  }

  setModelProperty(element: BpmnElement, key: string, value: string): void {
    if (PropertyCoercer.removeUndefined(element, key, value)) {
      return;
    }
    const catalog = PropertyCatalog.of(element);
    const property = element.descriptor.propertiesByName?.[key];
    if (!property || key === 'id') {
      throw catalog.unknownKey(key);
    }
    const blocked = PropertyCatalog.blockedReason(key);
    if (blocked) {
      throw catalog.unknownKey(key, blocked);
    }
    if (!catalog.isSettable(property)) {
      throw catalog.unknownKey(key, `${key} is not an attribute`);
    }
    element.set(key, value ? this.coerce(element, property, value) : undefined);
  }
}
