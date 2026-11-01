import { IdRequests, IdStyle, Kinds, type IdConventions, type IdRequest } from '../../model/index.js';

export class ConventionsTable {
  private static readonly ROOT_TYPES = ['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Message'];
  private static readonly FLOW_JOINS: Readonly<Record<string, string>> = { snake: '_to_', kebab: '-to-' };

  private readonly style: IdStyle;
  private readonly patternOfKind = new Map<string, string>();

  constructor(conventions?: IdConventions) {
    this.style = IdStyle.of(conventions);
    for (const definition of Kinds.ALL) {
      this.element(definition.kind, IdRequests.kindRequest(definition));
    }
    for (const type of ConventionsTable.ROOT_TYPES) {
      this.element(type.charAt(5).toLowerCase() + type.slice(6), IdRequests.typeRequest(type));
    }
    this.flow('sequenceFlow', 'bpmn:SequenceFlow');
    this.flow('messageFlow', 'bpmn:MessageFlow');
  }

  patterns(): Map<string, string> {
    return this.patternOfKind;
  }

  private element(kind: string, request: IdRequest): void {
    const { head, body } = this.style.explain(request);
    const ownPrefix = /^[a-z]/.test(head) ? `${kind}_` : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}_`;
    const own = head.toLowerCase() === `${kind.toLowerCase()}_` ? ownPrefix : head;
    this.patternOfKind.set(kind, `${own}{name:${body}}`);
  }

  private flow(kind: string, type: string): void {
    const { head, body } = this.style.explain(IdRequests.typeRequest(type));
    this.patternOfKind.set(kind, `${head}{source}${ConventionsTable.FLOW_JOINS[body] ?? 'To'}{target}`);
  }
}
