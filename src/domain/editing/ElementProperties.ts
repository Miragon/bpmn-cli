import { PropertyCoercer } from './PropertyCoercer.js';
import type { Doc } from '../document/Doc.js';
import { EditContext } from '../document/EditContext.js';
import type { El } from '../document/utils/moddle.js';
import { descriptorOf, idOf, isEl, ownValue, typeLabel, vendorAttributes } from '../document/utils/elements.js';
import { nestedEntries } from '../document/utils/nested-slots.js';
import { SetKeyCatalog } from './SetKeyCatalog.js';

/** The settable view of an element's properties (`show <id>`), keyed as `set` takes them. */
export class ElementProperties {
  private readonly coercer: PropertyCoercer;

  constructor(private readonly doc: Doc) {
    this.coercer = new PropertyCoercer(doc, new EditContext(doc));
  }

  /**
   * The properties of an element by key; of several event definitions each is listed under its
   * position (definition[1]: timerEventDefinition).
   */
  read(el: El): Record<string, unknown> {
    const out = SetKeyCatalog.readKeysBeforeGeneric(el, this.doc);
    for (const property of descriptorOf(el).properties ?? []) {
      if (property.name === 'id' || property.name === 'name' || property.name === 'default' || !this.coercer.isSettable(property)) continue;
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
