import type { Doc } from '../../document/Doc.js';
import type { El } from '../../document/utils/moddle.js';
import type { ProfileFinding } from '../../document/Finding.js';
import type { RuleKit } from './rule-kit.js';
import { RuleRun } from './RuleRun.js';
import { idOf, peek } from '../utils/element.js';

export type ElementWalk = 'descend' | 'stop';

/** An engine's validation profile: walks a document and hands its elements to its rule classes. */
export abstract class EngineProfile {
  constructor(protected readonly kit: RuleKit) {}

  findings(doc: Doc, opts: { operaton?: boolean } = {}): ProfileFinding[] {
    const run = new RuleRun(this.kit, doc);
    this.checkDocument(run, opts);
    return run.out;
  }

  protected abstract checkDocument(run: RuleRun, opts: { operaton?: boolean }): void;

  protected abstract checkElement(el: El, owner: El | undefined, executable: boolean): ElementWalk;

  protected visit(el: El, owner: El | undefined, executable: boolean): void {
    if (this.checkElement(el, owner, executable) === 'stop') return;
    const next = idOf(el) ? el : owner;
    for (const child of this.bpmnChildren(el)) this.visit(child, next, executable);
  }

  /** BPMN containment children (no references, no DI, no vendor content). */
  private bpmnChildren(el: El): El[] {
    const descriptor = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
    if (descriptor.isGeneric) return [];
    const out: El[] = [];
    for (const property of descriptor.properties ?? []) {
      if (property.isReference || property.name === 'extensionElements' || property.name === 'diagrams') continue;
      const propertyValue = peek<unknown>(el, property.name);
      for (const child of Array.isArray(propertyValue) ? propertyValue : [propertyValue]) {
        if (child && typeof child === 'object' && typeof (child as El).$type === 'string' && '$descriptor' in (child as object) && this.kit.isBpmnElement(child as El) && !this.kit.isDiElement(child as El)) out.push(child as El);
      }
    }
    return out;
  }
}
