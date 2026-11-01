import type { BpmnElement } from '../document/BpmnElement.js';
import { CamundaDescriptor } from './CamundaDescriptor.js';
import type { DeclaredNamespaces } from './DeclaredNamespaces.js';
import { ZeebeDescriptor } from './ZeebeDescriptor.js';

export interface DecisionLink {
  value: string;
  spelling: string;
}

export class DecisionLinkReader {
  static textValue(value: unknown): string | undefined {
    if (value === undefined || value === null || typeof value === 'object') {
      return undefined;
    }
    return String(value).trim() || undefined;
  }

  constructor(private readonly namespaces?: DeclaredNamespaces) {}

  linkOf(el: BpmnElement): DecisionLink | undefined {
    if (!el.is('bpmn:BusinessRuleTask')) {
      return undefined;
    }
    const c7 = this.c7DecisionRefs(el)[0];
    if (c7) {
      return { value: c7[1], spelling: c7[0] };
    }
    for (const call of this.zeebeCalls(el)) {
      const value = DecisionLinkReader.textValue(call.peek('decisionId'));
      if (value) {
        return { value, spelling: call.type };
      }
    }
    for (const key of ['calledDecision', 'calledElement']) {
      const value = DecisionLinkReader.textValue(el.attrs?.[key]);
      if (value) {
        return { value, spelling: key };
      }
    }
    return undefined;
  }

  uriOf(el: BpmnElement, prefix: string): string | undefined {
    for (let ancestor: BpmnElement | undefined = el; ancestor; ancestor = ancestor.parent) {
      const uri = ancestor.attrs[`xmlns:${prefix}`];
      if (typeof uri === 'string') {
        return uri;
      }
    }
    return this.namespaces?.uriOf(prefix);
  }

  c7DecisionRefs(el: BpmnElement): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const [attrName, attrValue] of Object.entries(el.attrs)) {
      const colon = attrName.indexOf(':');
      if (colon <= 0 || attrName.slice(colon + 1) !== 'decisionRef') {
        continue;
      }
      const uri = this.uriOf(el, attrName.slice(0, colon));
      const value = DecisionLinkReader.textValue(attrValue);
      if (value && (!uri || CamundaDescriptor.C7_URIS.has(uri))) {
        out.push([attrName, value]);
      }
    }
    return out.sort((left, right) => Number(this.uriOf(el, left[0].split(':')[0]!) === CamundaDescriptor.OPERATON_URI) - Number(this.uriOf(el, right[0].split(':')[0]!) === CamundaDescriptor.OPERATON_URI));
  }

  zeebeCalls(el: BpmnElement): readonly BpmnElement[] {
    const values = el.get<BpmnElement | undefined>('extensionElements')?.list('values') ?? [];
    return values.filter((value) => {
      const [prefix, local] = value.type.split(':');
      if (local !== 'calledDecision' || !prefix) {
        return false;
      }
      const uri = value.descriptor.ns?.uri ?? this.uriOf(el, prefix);
      return !uri || uri === ZeebeDescriptor.URI;
    });
  }
}
