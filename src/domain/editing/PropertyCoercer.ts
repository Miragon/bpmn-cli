import type { Doc } from '../document/Doc.js';
import type { EditContext } from '../document/EditContext.js';
import { modelError } from '../document/utils/errors.js';
import { kindLabel } from '../document/utils/kinds.js';
import type { El } from '../document/utils/moddle.js';
import { descriptorOf, idOf, type PropDescriptor } from '../document/utils/elements.js';
import { CAMUNDA } from '../document/vendor/CamundaDescriptor.js';
import { SET_KEYS, SetKeyCatalog } from './SetKeyCatalog.js';

/** Properties with a dedicated command or key: never set generically. */
const BLOCKED_PROPS: Record<string, string> = {
  attachedToRef: 'use `bpmn move <file> <id> --on <activityId>`',
  sourceRef: 'use source=<nodeId>',
  targetRef: 'use target=<nodeId>',
  processRef: 'a participant is bound to its process on creation',
  bpmnElement: 'diagram interchange is generated automatically',
};

const PRIMITIVE_TYPES = new Set(['String', 'Boolean', 'Integer', 'Real']);

/**
 * The keys `set` takes and the values it writes: documented keys, settable attributes of a
 * BPMN type, vendor attributes, and string values converted to the property's type.
 */
export class PropertyCoercer {
  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext,
  ) {}

  private enumLiterals(type: string): string[] | undefined {
    const [prefix, local] = type.split(':');
    if (!prefix || !local) return undefined;
    let pkg: { enumerations?: Array<{ name: string; literalValues?: Array<{ name: string }> }> } | undefined;
    try {
      pkg = this.doc.moddle.getPackage(prefix) as typeof pkg;
    } catch {
      return undefined;
    }
    const found = pkg?.enumerations?.find((enumeration) => enumeration.name === local);
    return found?.literalValues?.map((literal) => literal.name);
  }

  blockedReason(key: string): string | undefined {
    return BLOCKED_PROPS[key];
  }

  isSettable(property: PropDescriptor): boolean {
    if (property.isMany || BLOCKED_PROPS[property.name]) return false;
    if (property.isReference) return !!property.isAttr;
    return PRIMITIVE_TYPES.has(property.type) || !!this.enumLiterals(property.type);
  }

  genericKeys(el: El): string[] {
    return (descriptorOf(el).properties ?? []).filter((property) => property.name !== 'id' && this.isSettable(property)).map((property) => property.name);
  }

  settableKeys(el: El): string[] {
    const keys = new Set<string>();
    for (const definition of SET_KEYS) {
      if (!SetKeyCatalog.isPlaceholder(definition) && SetKeyCatalog.appliesTo(definition, el)) keys.add(definition.key);
    }
    for (const genericKey of this.genericKeys(el)) keys.add(genericKey);
    keys.add('<prefix>:<attr>');
    return [...keys];
  }

  static invalid(el: El, key: string, message: string, hint?: string) {
    return modelError('E_INVALID_VALUE', `Invalid value for ${key} on ${idOf(el)}: ${message}`, { element: idOf(el), ...(hint ? { hint } : {}) });
  }

  static bool(el: El, key: string, value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(normalized)) return true;
    if (['false', 'no', '0', 'off'].includes(normalized)) return false;
    throw PropertyCoercer.invalid(el, key, `"${value}" is not a boolean`, `Use ${key}=true or ${key}=false.`);
  }

  /** Errors name `label`, the key as given. */
  coerce(el: El, property: PropDescriptor, value: string, label: string = property.name): unknown {
    if (property.isReference) return this.edit.require(value, property.type, property.name);
    switch (property.type) {
      case 'String':
        return value;
      case 'Boolean':
        return PropertyCoercer.bool(el, label, value);
      case 'Integer': {
        if (!/^-?\d+$/.test(value.trim())) throw PropertyCoercer.invalid(el, label, `"${value}" is not an integer`);
        return Number(value);
      }
      case 'Real': {
        const numeric = Number(value);
        if (!value.trim() || Number.isNaN(numeric)) throw PropertyCoercer.invalid(el, label, `"${value}" is not a number`);
        return numeric;
      }
      default: {
        const literals = this.enumLiterals(property.type) ?? [];
        const hit = literals.find((literal) => literal.toLowerCase() === value.trim().toLowerCase());
        if (!hit) throw PropertyCoercer.invalid(el, label, `"${value}" is not one of ${literals.join('|')}`);
        return hit;
      }
    }
  }

  unknownKey(el: El, key: string, reason?: string) {
    const keys = this.settableKeys(el);
    return modelError('E_UNKNOWN_KEY', `Unknown key "${key}" for ${kindLabel(el)} ${idOf(el)}${reason ? ` (${reason})` : ''}`, {
      element: idOf(el),
      candidates: keys,
      hint: `Settable keys for this element: ${keys.join(', ')}.`,
    });
  }

  /**
   * Boolean camunda attributes are written as exactly true / false: the engines read only the
   * exact value "true" (asyncBefore=yes would silently stay off).
   */
  vendorValue(el: El, key: string, value: string, label: string = key): string {
    if (!value) return value;
    const local = this.camundaLocal(key);
    if (!local || CAMUNDA.attr(local)?.type !== 'Boolean') return value;
    return String(PropertyCoercer.bool(el, label, value));
  }

  setVendorAttribute(el: El, key: string, value: string): void {
    const idx = key.indexOf(':');
    const prefix = key.slice(0, idx);
    const local = key.slice(idx + 1);
    if (!prefix || !local || prefix === 'xmlns') throw this.unknownKey(el, key, 'vendor attributes look like prefix:name');
    if (!value) {
      delete el.$attrs[key];
      return;
    }
    this.doc.declareNamespace(prefix);
    el.$attrs[key] = value;
  }

  /**
   * Only removes an unprefixed attribute BPMN does not define (`assignee` on a user task):
   * the engines validate against the schema and refuse the file.
   */
  static removeUndefined(el: El, key: string, value: string): boolean {
    if (value || key.includes(':') || descriptorOf(el).propertiesByName?.[key]) return false;
    if (!el.$attrs || !Object.prototype.hasOwnProperty.call(el.$attrs, key)) return false;
    delete el.$attrs[key];
    return true;
  }

  /** Any prefix bound to the camunda or Operaton namespace counts. */
  isResourceKey(key: string): boolean {
    const [prefix, local] = key.split(':');
    return local === 'resource' && !!prefix && CAMUNDA.reads(this.doc.namespaceUri(prefix));
  }

  resourceKeyOf(expr: El | undefined): string | undefined {
    if (!expr) return undefined;
    return Object.keys(expr.$attrs ?? {}).find((attrKey) => this.isResourceKey(attrKey) && expr.$attrs[attrKey] !== undefined && expr.$attrs[attrKey] !== '');
  }

  /** Operaton's namespace holds the same attributes: the descriptor's rules apply by local name. */
  camundaLocal(key: string): string | undefined {
    const idx = key.indexOf(':');
    if (idx <= 0) return undefined;
    return CAMUNDA.reads(this.doc.namespaceUri(key.slice(0, idx))) ? key.slice(idx + 1) : undefined;
  }
}
