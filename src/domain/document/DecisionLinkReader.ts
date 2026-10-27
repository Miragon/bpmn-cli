import type { Doc } from './Doc.js';
import { is, type El } from './utils/moddle.js';
import { textValue } from './utils/text-value.js';
import { OPERATON_URI, C7_URIS } from './vendor/CamundaDescriptor.js';
import { ZEEBE_URI } from './vendor/ZeebeDescriptor.js';

export interface DecisionLink {
  /** the id of the decision in the DMN file */
  value: string;
  /** the attribute name (`camunda:decisionRef`, `calledDecision`, ...) or `zeebe:calledDecision` */
  spelling: string;
}

/**
 * Reads which DMN decision a business rule task calls. BPMN 2.0 has no attribute for it, so it
 * reads every spelling: camunda:decisionRef (C7), zeebe:calledDecision (C8), bpmn-cli's
 * unprefixed calledDecision and a hand-written calledElement.
 */
export class DecisionLinkReader {
  constructor(private readonly doc?: Doc) {}

  /** The decision link of a business rule task in any spelling. */
  linkOf(el: El): DecisionLink | undefined {
    if (!is(el, 'bpmn:BusinessRuleTask')) return undefined;
    const c7 = this.c7DecisionRefs(el)[0];
    if (c7) return { value: c7[1], spelling: c7[0] };
    for (const call of this.zeebeCalls(el)) {
      const value = textValue((call as unknown as Record<string, unknown>)['decisionId']);
      if (value) return { value, spelling: call.$type };
    }
    for (const key of ['calledDecision', 'calledElement']) {
      const value = textValue(el.$attrs?.[key]);
      if (value) return { value, spelling: key };
    }
    return undefined;
  }

  uriOf(el: El, prefix: string): string | undefined {
    for (let ancestor: El | undefined = el; ancestor; ancestor = ancestor.$parent as El | undefined) {
      const uri = (ancestor.$attrs as Record<string, unknown> | undefined)?.[`xmlns:${prefix}`];
      if (typeof uri === 'string') return uri;
    }
    return this.doc?.namespaceUri(prefix);
  }

  /** Any prefix bound to a Camunda 7 namespace counts, camunda first. */
  c7DecisionRefs(el: El): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const [attrName, attrValue] of Object.entries(el.$attrs ?? {})) {
      const colon = attrName.indexOf(':');
      if (colon <= 0 || attrName.slice(colon + 1) !== 'decisionRef') continue;
      const uri = this.uriOf(el, attrName.slice(0, colon));
      const value = textValue(attrValue);
      if (value && (!uri || C7_URIS.has(uri))) out.push([attrName, value]);
    }
    return out.sort((left, right) => Number(this.uriOf(el, left[0].split(':')[0]!) === OPERATON_URI) - Number(this.uriOf(el, right[0].split(':')[0]!) === OPERATON_URI));
  }

  /** Reads without creating the lazy extensionElements collection: views and profiles read the live document. */
  zeebeCalls(el: El): El[] {
    const values = (el.get<El | undefined>('extensionElements') as unknown as { values?: El[] } | undefined)?.values;
    if (!Array.isArray(values)) return [];
    return values.filter((value) => {
      const [prefix, local] = value.$type.split(':');
      if (local !== 'calledDecision' || !prefix) return false;
      const uri = (value.$descriptor as { ns?: { uri?: string } }).ns?.uri ?? this.uriOf(el, prefix);
      return !uri || uri === ZEEBE_URI;
    });
  }
}
