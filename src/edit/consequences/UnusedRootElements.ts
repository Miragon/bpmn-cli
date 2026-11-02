import type { BpmnElement, ChangeSet } from '../../model/index.js';
import { ElementContainment } from '../containers/ElementContainment.js';
import type { EditSession } from '../session/EditSession.js';
import { EditConsequence } from './EditConsequence.js';

/**
 * Removes a message, error, signal or escalation that the batch left without any reference,
 * whichever operation removed, retyped or relinked the element that used it.
 */
export class UnusedRootElements extends EditConsequence<BpmnElement> {
  private static readonly TYPES = ['bpmn:Message', 'bpmn:Error', 'bpmn:Signal', 'bpmn:Escalation'];

  constructor(private readonly edit: EditSession) {
    super();
  }

  findProblems(): Set<BpmnElement> {
    const { tree } = this.edit.document;
    const roots = UnusedRootElements.TYPES.flatMap((type) => tree.rootElementsOfType(type));
    const references = new ElementContainment(tree.definitions).referencesToAny(new Set(roots));
    const referenced = new Set(references.map(({ target }) => target));
    return new Set(roots.filter((root) => !referenced.has(root)));
  }

  repair(root: BpmnElement, changes: ChangeSet): void {
    const { tree } = this.edit.document;
    tree.definitions.remove('rootElements', root);
    tree.invalidate();
    const kind = root.type.replace('bpmn:', '').toLowerCase();
    changes.remove({ id: root.id, kind, detail: 'no longer referenced' });
  }
}
