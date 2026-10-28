import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

/** A link throw event and the (sub-)process it throws in. */
export interface LinkThrow {
  el: ModdleElement;
  name: string;
  scope: ModdleElement;
}

/** A link catch event whose name an earlier catch event of the process already has. */
export interface DuplicateLinkCatch {
  first: ModdleElement;
  el: ModdleElement;
  name: string;
}

/**
 * The link events of a process, as both engines resolve them: a throw jumps to the catch of its
 * name in its own (sub-)process, and catch names are unique in the process.
 */
export class LinkEvents {
  private readonly firstCatch = new Map<string, ModdleElement>();
  private readonly caughtIn = new Map<ModdleElement, Set<string>>();
  private readonly throws: LinkThrow[] = [];
  private readonly duplicates: DuplicateLinkCatch[] = [];

  /** `linkName`: the link name a node throws or catches, `undefined` for any other node. */
  constructor(process: ModdleElement, linkName: (node: ModdleElement) => string | undefined) {
    this.collect(process, linkName);
  }

  /** The second and later catch events of a name, in document order. */
  duplicateCatches(): DuplicateLinkCatch[] {
    return this.duplicates;
  }

  /** The throw events whose (sub-)process has no catch event of their name. */
  unmatchedThrows(): LinkThrow[] {
    return this.throws.filter(
      (linkThrow) => !this.caughtIn.get(linkThrow.scope)?.has(linkThrow.name),
    );
  }

  /** The first catch event of a name, wherever it is in the process. */
  catchNamed(name: string): ModdleElement | undefined {
    return this.firstCatch.get(name);
  }

  private collect(
    scope: ModdleElement,
    linkName: (node: ModdleElement) => string | undefined,
  ): void {
    for (const node of scope.flowElements ?? []) {
      const name = linkName(node);
      if (name !== undefined && is(node, 'bpmn:IntermediateCatchEvent')) {
        const first = this.firstCatch.get(name);
        if (first) {
          this.duplicates.push({ first, el: node, name });
        } else {
          this.firstCatch.set(name, node);
        }
        this.caughtIn.set(scope, new Set([...(this.caughtIn.get(scope) ?? []), name]));
      } else if (name !== undefined && is(node, 'bpmn:IntermediateThrowEvent')) {
        this.throws.push({ el: node, name, scope });
      }
      if (node.flowElements) {
        this.collect(node, linkName);
      }
    }
  }
}
