import { PropertyCoercer } from '../editing/properties/PropertyCoercer.js';
import type { Doc } from '../document/Doc.js';
import { typeLabel, type El } from '../document/utils/moddle.js';
import { descriptorOf, idOf, isEl, ownValue, vendorAttributes } from '../document/utils/elements.js';
import { nestedEntries } from '../document/utils/nested-slots.js';
import { SetKeyCatalog } from '../editing/properties/SetKeyCatalog.js';

/** The settable view of an element's properties (`show <id>`), keyed as `set` takes them. */
export class ElementProperties {
  constructor(private readonly doc: Doc) {}

  /**
   * The properties of an element by key; of several event definitions each is listed under its
   * position (definition[1]: timerEventDefinition).
   */
  read(el: El): Record<string, unknown> {
    const out = SetKeyCatalog.readKeysBeforeGeneric(el, this.doc);
    for (const property of descriptorOf(el).properties ?? []) {
      if (property.name === 'id' || property.name === 'name' || property.name === 'default' || !PropertyCoercer.isSettable(this.doc, property)) continue;
      const propValue = ownValue(el, property.name);
      if (propValue === undefined || propValue === null || propValue === '') continue;
      out[property.name] = property.isReference && isEl(propValue) ? idOf(propValue) : propValue;
    }
    for (const [attrName, attrValue] of Object.entries(el.$attrs ?? {})) {
      if (attrName.startsWith('xmlns') || typeof attrValue === 'object') continue;
      out[attrName] = attrValue;
    }
    Object.assign(out, SetKeyCatalog.readKeysAfterGeneric(el, this.doc));
    for (const { prefix, el: nestedEl } of nestedEntries(el)) {
      if (prefix.includes('[')) out[prefix] = typeLabel(nestedEl);
      const nestedId = nestedEl.get<string | undefined>('id');
      if (nestedId) out[`${prefix}.id`] = nestedId;
      for (const [attrName, attrValue] of Object.entries(vendorAttributes(nestedEl))) out[`${prefix}.${attrName}`] = attrValue;
    }
    return out;
  }
}
