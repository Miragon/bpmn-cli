/**
 * `bpmn find`: case-insensitive substring over ids and names (and annotation
 * texts); `kind` accepts any kind token (`userTask`, `user`,
 * `startEvent:message`) plus `sequenceFlow`, `messageFlow`, `lane`,
 * `participant`, ... An empty text lists every element (of the kind). Also
 * over vendor attribute values (camunda:topic, camunda:assignee, ..., of
 * nested elements too) and the attributes / bodies of extension elements
 * (`match` says what matched), the decision link of a business rule task
 * (`calledDecision=<id>`), and, for a non-empty text, over the ids of event
 * definitions and loop characteristics.
 */
import type { Doc } from '../model/Doc.js';
import { is, peek, walk, type El } from '../model/utils/moddle.js';
import { DecisionLinkReader } from '../ops/DecisionLinkReader.js';
import { ExtensionLister, type ExtensionInfo } from '../ops/ExtensionLister.js';
import { nestedEntries } from '../ops/utils/nested-slots.js';
import { ElementFacts } from './ElementFacts.js';
import type { FindHit } from './model-view.js';
import { compact, kindFilter, labelOf, nameOf, truncate } from './utils/view.js';

export class ElementFinder {
  constructor(private readonly doc: Doc) {}

  find(text: string, kind?: string): FindHit[] {
    const q = text.trim().toLowerCase();
    const filter = kind ? kindFilter(kind) : undefined;
    const out: FindHit[] = [];
    for (const el of walk(this.doc.definitions)) {
      const nested = !ElementFinder.isSearchable(el) && !!q && ElementFinder.isNestedSearchable(el);
      if (!ElementFinder.isSearchable(el) && !nested) continue;
      const id = peek<string>(el, 'id');
      if (!id) continue;
      const name = nameOf(el) ?? (is(el, 'bpmn:TextAnnotation') ? peek<string>(el, 'text') : undefined);
      let match: string | undefined;
      if (q && !id.toLowerCase().includes(q) && !(name ?? '').toLowerCase().includes(q)) {
        match = nested ? undefined : ElementFinder.vendorMatch(el, q);
        if (!match) continue;
      }
      if (filter && !filter(el)) continue;
      out.push(compact<FindHit>({ id, kind: labelOf(el), name, scope: is(el, 'bpmn:Process') ? undefined : this.doc.scopeOf(el)?.get<string>('id'), match }));
    }
    return out;
  }

  /** Nested elements `find` lists by id (only for a non-empty text: modeler files give every event definition an id). */
  private static isNestedSearchable(el: El): boolean {
    return is(el, 'bpmn:EventDefinition') || is(el, 'bpmn:LoopCharacteristics');
  }

  /** Element types `find` looks at (what the AI can address by id). */
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

  /** The first vendor value of `el` containing `q`: an attribute (also of a nested element) or an extension element attribute / body. */
  private static vendorMatch(el: El, q: string): string | undefined {
    for (const [k, v] of Object.entries(new ElementFacts(el).vendorValues() ?? {})) if (v.toLowerCase().includes(q)) return `${k}=${v}`;
    const decision = new DecisionLinkReader().linkOf(el);
    if (decision && decision.value.toLowerCase().includes(q)) return `calledDecision=${decision.value}`;
    const visit = (exts: ExtensionInfo[] | undefined, path: string): string | undefined => {
      for (const e of exts ?? []) {
        for (const [k, v] of Object.entries(e.attrs ?? {})) if (String(v).toLowerCase().includes(q)) return `${path}${e.type} ${k}=${v}`;
        if (e.body && e.body.toLowerCase().includes(q)) return `${path}${e.type} ${truncate(e.body, 60)}`;
        const hit = visit(e.children as ExtensionInfo[] | undefined, path);
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
