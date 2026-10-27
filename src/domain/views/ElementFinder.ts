import type { Doc } from '../document/Doc.js';
import { is, peek, walk, type El } from '../document/utils/moddle.js';
import { DecisionLinkReader } from '../document/DecisionLinkReader.js';
import { ExtensionLister, type ExtensionInfo } from '../document/ExtensionLister.js';
import { nestedEntries } from '../document/utils/nested-slots.js';
import { ElementFacts } from './ElementFacts.js';
import type { FindHit } from './model-view.js';
import { compact, nameOf, truncate } from './utils/view.js';
import { kindFilter, kindOrTypeLabel } from '../document/utils/kinds.js';

/**
 * `bpmn find`: case-insensitive substring search over ids, names, annotation texts and vendor
 * values; `match` says which vendor value matched.
 */
export class ElementFinder {
  constructor(private readonly doc: Doc) {}

  find(text: string, kind?: string): FindHit[] {
    const query = text.trim().toLowerCase();
    const filter = kind ? kindFilter(kind) : undefined;
    const out: FindHit[] = [];
    for (const el of walk(this.doc.definitions)) {
      const nested = !ElementFinder.isSearchable(el) && !!query && ElementFinder.isNestedSearchable(el);
      if (!ElementFinder.isSearchable(el) && !nested) continue;
      const id = peek<string>(el, 'id');
      if (!id) continue;
      const name = nameOf(el) ?? (is(el, 'bpmn:TextAnnotation') ? peek<string>(el, 'text') : undefined);
      let match: string | undefined;
      if (query && !id.toLowerCase().includes(query) && !(name ?? '').toLowerCase().includes(query)) {
        match = nested ? undefined : ElementFinder.vendorMatch(el, query);
        if (!match) continue;
      }
      if (filter && !filter(el)) continue;
      out.push(compact<FindHit>({ id, kind: kindOrTypeLabel(el), name, scope: is(el, 'bpmn:Process') ? undefined : this.doc.scopeOf(el)?.get<string>('id'), match }));
    }
    return out;
  }

  /** Only for a non-empty text: modeler files give every event definition an id. */
  private static isNestedSearchable(el: El): boolean {
    return is(el, 'bpmn:EventDefinition') || is(el, 'bpmn:LoopCharacteristics');
  }

  private static isSearchable(el: El): boolean {
    if (/^(bpmndi|di|dc):/.test(el.$type)) return false;
    if (is(el, 'bpmn:DataObject') || is(el, 'bpmn:DataStore')) return false;
    return (
      is(el, 'bpmn:FlowElement') ||
      is(el, 'bpmn:Artifact') ||
      is(el, 'bpmn:DataAssociation') ||
      is(el, 'bpmn:Lane') ||
      is(el, 'bpmn:Participant') ||
      is(el, 'bpmn:MessageFlow') ||
      is(el, 'bpmn:Process') ||
      is(el, 'bpmn:Collaboration') ||
      is(el, 'bpmn:Message') ||
      is(el, 'bpmn:Error') ||
      is(el, 'bpmn:Signal') ||
      is(el, 'bpmn:Escalation')
    );
  }

  private static vendorMatch(el: El, query: string): string | undefined {
    for (const [key, value] of Object.entries(new ElementFacts(el).vendorValues() ?? {})) if (value.toLowerCase().includes(query)) return `${key}=${value}`;
    const decision = new DecisionLinkReader().linkOf(el);
    if (decision && decision.value.toLowerCase().includes(query)) return `calledDecision=${decision.value}`;
    const visit = (exts: ExtensionInfo[] | undefined, path: string): string | undefined => {
      for (const extension of exts ?? []) {
        for (const [key, value] of Object.entries(extension.attrs ?? {})) if (String(value).toLowerCase().includes(query)) return `${path}${extension.type} ${key}=${value}`;
        if (extension.body && extension.body.toLowerCase().includes(query)) return `${path}${extension.type} ${truncate(extension.body, 60)}`;
        const hit = visit(extension.children as ExtensionInfo[] | undefined, path);
        if (hit) return hit;
      }
      return undefined;
    };
    const own = visit(new ExtensionLister().list(el), '');
    if (own) return own;
    for (const { prefix, el: nested } of nestedEntries(el)) {
      const hit = visit(new ExtensionLister().list(nested), `${prefix}.`);
      if (hit) return hit;
    }
    return undefined;
  }
}
