import type { Doc } from '../../model/Doc.js';
import type { DocumentNamespaces } from '../DocumentNamespaces.js';
import type { El } from '../../model/utils/moddle.js';
import type { ProfileFinding, Severity } from '../utils/finding.js';
import type { RuleKit } from './rule-kit.js';
import { idOf, isGeneric, list, localName, peek } from './utils/element.js';

export interface ExtValue {
  el: El;
  uri: string | undefined;
  local: string;
  index: number;
}

export type ElementWalk = 'descend' | 'stop';

export abstract class EngineProfile {
  protected doc!: Doc;
  protected ns!: DocumentNamespaces;
  /** prefix of the engine's namespace in this file, for messages and hints */
  protected p = '';
  protected out: ProfileFinding[] = [];
  /** sequence flows by source / target, from sourceRef/targetRef (the incoming/outgoing mirror lists are optional) */
  protected outgoing = new Map<El, El[]>();
  protected incoming = new Map<El, El[]>();

  constructor(protected readonly kit: RuleKit) {}

  findings(doc: Doc, opts: { operaton?: boolean } = {}): ProfileFinding[] {
    this.doc = doc;
    this.ns = new this.kit.DocumentNamespaces(doc);
    this.out = [];
    this.indexFlows();
    this.checkDocument(opts);
    return this.out;
  }

  protected abstract checkDocument(opts: { operaton?: boolean }): void;

  protected abstract checkElement(el: El, owner: El | undefined, executable: boolean): ElementWalk;

  /** The `set` / `ext` key prefix that addresses `el` through `owner` (`definition.`, `loop.`, `condition.`). */
  protected abstract addressOf(el: El, owner: El | undefined): { id: string; prefix: string } | undefined;

  protected visit(el: El, owner: El | undefined, executable: boolean): void {
    if (this.checkElement(el, owner, executable) === 'stop') return;
    const next = idOf(el) ? el : owner;
    for (const c of this.bpmnChildren(el)) this.visit(c, next, executable);
  }


  private indexFlows(): void {
    this.outgoing = new Map();
    this.incoming = new Map();
    for (const flow of this.kit.walk(this.doc.definitions, { bpmnOnly: true })) {
      if (!this.kit.is(flow, 'bpmn:SequenceFlow')) continue;
      const source = peek<El>(flow, 'sourceRef');
      const target = peek<El>(flow, 'targetRef');
      if (source) this.outgoing.set(source, [...(this.outgoing.get(source) ?? []), flow]);
      if (target) this.incoming.set(target, [...(this.incoming.get(target) ?? []), flow]);
    }
  }

  protected push(severity: Severity, code: string, element: El | undefined, owner: El | undefined, subject: string, message: string, hint: string, related: string[] = []): void {
    // a nested element (event definition, loop, condition) is reported on the flow node or flow that holds it
    const addr = element ? this.addressOf(element, owner) : undefined;
    const target = addr?.prefix ? addr.id : (idOf(element) ?? idOf(owner));
    this.out.push(this.kit.makeFinding(severity, code, message, target, { hint, related, subject }));
  }

  /** The generic extension elements of a BPMN element, with their namespace. */
  protected extensionValues(el: El | undefined): ExtValue[] {
    const ext = peek<El>(el, 'extensionElements');
    return list(ext, 'values').map((v, index) => ({ el: v, uri: isGeneric(v) ? this.ns.uriOfElement(v) : undefined, local: localName(v.$type), index }));
  }

  /** BPMN containment children (no references, no DI, no vendor content). */
  protected bpmnChildren(el: El): El[] {
    const d = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
    if (d.isGeneric) return [];
    const out: El[] = [];
    for (const p of d.properties ?? []) {
      if (p.isReference || p.name === 'extensionElements' || p.name === 'diagrams') continue;
      const v = peek<unknown>(el, p.name);
      for (const c of Array.isArray(v) ? v : [v]) {
        if (c && typeof c === 'object' && typeof (c as El).$type === 'string' && '$descriptor' in (c as object) && this.kit.isBpmnElement(c as El) && !this.kit.isDiElement(c as El)) out.push(c as El);
      }
    }
    return out;
  }

  protected isEventSubProcess(el: El | undefined): boolean {
    return !!el && this.kit.is(el, 'bpmn:SubProcess') && peek<boolean>(el, 'triggeredByEvent') === true;
  }
}
