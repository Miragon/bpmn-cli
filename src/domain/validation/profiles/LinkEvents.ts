import type { Doc } from '../../document/Doc.js';
import type { El } from '../../document/utils/moddle.js';
import type { RuleKit } from './rule-kit.js';

export interface LinkThrow {
  el: El;
  name: string;
  scope: El | undefined;
}

export interface DuplicateLinkCatch {
  first: El;
  el: El;
  name: string;
}

/**
 * The link events among a process's flow nodes, as both engines resolve them: a throw jumps to
 * the catch of its name in its own (sub-)process, and catch names are unique in the process.
 */
export class LinkEvents {
  private readonly firstCatch = new Map<string, El>();
  private readonly caughtIn = new Map<El | undefined, Set<string>>();
  private readonly throws: LinkThrow[] = [];
  private readonly duplicates: DuplicateLinkCatch[] = [];

  /** `linkName`: the link name a node throws or catches, `undefined` for any other node. */
  constructor(doc: Doc, kit: RuleKit, nodes: El[], linkName: (node: El) => string | undefined) {
    for (const node of nodes) {
      const name = linkName(node);
      if (name === undefined) continue;
      const scope = doc.scopeOf(node);
      if (kit.is(node, 'bpmn:IntermediateCatchEvent')) {
        const first = this.firstCatch.get(name);
        if (first) {
          this.duplicates.push({ first, el: node, name });
        } else {
          this.firstCatch.set(name, node);
        }
        this.caughtIn.set(scope, new Set([...(this.caughtIn.get(scope) ?? []), name]));
      } else if (kit.is(node, 'bpmn:IntermediateThrowEvent')) {
        this.throws.push({ el: node, name, scope });
      }
    }
  }

  /** The second and later catch events of a name, in document order. */
  duplicateCatches(): DuplicateLinkCatch[] {
    return this.duplicates;
  }

  /** The throw events whose (sub-)process has no catch event of their name. */
  unmatchedThrows(): LinkThrow[] {
    return this.throws.filter((linkThrow) => !this.caughtIn.get(linkThrow.scope)?.has(linkThrow.name));
  }

  /** The first catch event of a name, wherever it is in the process. */
  catchNamed(name: string): El | undefined {
    return this.firstCatch.get(name);
  }
}
