import { type BpmnDocument, type BpmnElement } from '../../../model/index.js';

export interface LinkThrow {
  el: BpmnElement;
  name: string;
  scope: BpmnElement | undefined;
}

export interface DuplicateLinkCatch {
  first: BpmnElement;
  el: BpmnElement;
  name: string;
}

export class LinkEvents {
  private readonly firstCatch = new Map<string, BpmnElement>();
  private readonly caughtIn = new Map<BpmnElement | undefined, Set<string>>();
  private readonly throws: LinkThrow[] = [];
  private readonly duplicates: DuplicateLinkCatch[] = [];

  constructor(document: BpmnDocument, nodes: readonly BpmnElement[], linkName: (node: BpmnElement) => string | undefined) {
    for (const node of nodes) {
      const name = linkName(node);
      if (name === undefined) {
        continue;
      }
      const scope = document.scopes.scopeOf(node);
      if (node.is('bpmn:IntermediateCatchEvent')) {
        const first = this.firstCatch.get(name);
        if (first) {
          this.duplicates.push({ first, el: node, name });
        } else {
          this.firstCatch.set(name, node);
        }
        this.caughtIn.set(scope, new Set([...(this.caughtIn.get(scope) ?? []), name]));
      } else if (node.is('bpmn:IntermediateThrowEvent')) {
        this.throws.push({ el: node, name, scope });
      }
    }
  }

  duplicateCatches(): DuplicateLinkCatch[] {
    return this.duplicates;
  }

  unmatchedThrows(): LinkThrow[] {
    return this.throws.filter((linkThrow) => !this.caughtIn.get(linkThrow.scope)?.has(linkThrow.name));
  }

  catchNamed(name: string): BpmnElement | undefined {
    return this.firstCatch.get(name);
  }
}
