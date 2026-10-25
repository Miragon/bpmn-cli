import type { Doc } from '../../model/Doc.js';
import type { El } from '../../model/utils/moddle.js';
import type { ProfileFinding } from '../utils/finding.js';
import type { RuleKit } from './rule-kit.js';
import { RuleRun } from './RuleRun.js';
import { idOf, peek } from './utils/element.js';

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
    for (const c of this.bpmnChildren(el)) this.visit(c, next, executable);
  }

  /** BPMN containment children (no references, no DI, no vendor content). */
  private bpmnChildren(el: El): El[] {
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
}
