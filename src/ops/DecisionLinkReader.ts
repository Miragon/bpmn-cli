/**
 * The decision link of a business rule task: which DMN decision it calls.
 * BPMN 2.0 has no attribute for it, so each engine has its own spelling, and
 * bpmn-cli has one for a model without an engine; `show` / `find` read all of
 * them, in this order:
 *
 *   camunda:decisionRef="x"                          Camunda 7 (operaton:decisionRef in an Operaton file)
 *   <zeebe:calledDecision decisionId="x" .../>       Camunda 8 (an extension element; keeps its resultVariable)
 *   calledDecision="x"                               bpmn-cli's spelling for a model without an engine
 *   calledElement="x"                                hand-written models (read, never written)
 */
import type { Doc } from '../model/Doc.js';
import { is, type El } from '../model/utils/moddle.js';
import { textValue } from './utils/text-value.js';
import { OPERATON_URI, C7_URIS } from '../platform/CamundaDescriptor.js';
import { ZEEBE_URI } from '../platform/ZeebeDescriptor.js';

export interface DecisionLink {
  /** the id of the decision (in the DMN file) */
  value: string;
  /** where it is written: the attribute name (`camunda:decisionRef`, `calledDecision`, `calledElement`) or `zeebe:calledDecision` (extension element) */
  spelling: string;
}

export class DecisionLinkReader {
  constructor(private readonly doc?: Doc) {}

  /** The decision link of a business rule task in any spelling (undefined for other elements or without one). */
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

  /** prefix -> namespace URI declared on bpmn:definitions or on the element's ancestors. */
  uriOf(el: El, prefix: string): string | undefined {
    for (let p: El | undefined = el; p; p = p.$parent as El | undefined) {
      const v = (p.$attrs as Record<string, unknown> | undefined)?.[`xmlns:${prefix}`];
      if (typeof v === 'string') return v;
    }
    return this.doc?.namespaceUri(prefix);
  }

  /** The decisionRef attributes (any prefix bound to a Camunda 7 namespace, camunda first) of the task: [attribute name, value]. */
  c7DecisionRefs(el: El): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(el.$attrs ?? {})) {
      const i = k.indexOf(':');
      if (i <= 0 || k.slice(i + 1) !== 'decisionRef') continue;
      const uri = this.uriOf(el, k.slice(0, i));
      const value = textValue(v);
      if (value && (!uri || C7_URIS.has(uri))) out.push([k, value]);
    }
    return out.sort((a, b) => Number(this.uriOf(el, a[0].split(':')[0]!) === OPERATON_URI) - Number(this.uriOf(el, b[0].split(':')[0]!) === OPERATON_URI));
  }

  /** The zeebe:calledDecision extension elements of the task. */
  zeebeCalls(el: El): El[] {
    // read without creating the lazy collection (views and profiles read the live document)
    const values = (el.get<El | undefined>('extensionElements') as unknown as { values?: El[] } | undefined)?.values;
    if (!Array.isArray(values)) return [];
    return values.filter((v) => {
      const [prefix, local] = v.$type.split(':');
      if (local !== 'calledDecision' || !prefix) return false;
      const uri = (v.$descriptor as { ns?: { uri?: string } }).ns?.uri ?? this.uriOf(el, prefix);
      return !uri || uri === ZEEBE_URI;
    });
  }
}
