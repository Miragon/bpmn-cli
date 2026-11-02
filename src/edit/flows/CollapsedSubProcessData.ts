import { type BpmnElement, BpmnError, DataAssociationEnds } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export class CollapsedSubProcessData {
  constructor(private readonly edit: EditSession) {}

  assertConnectable(source: BpmnElement, target: BpmnElement): void {
    for (const [end, other] of [[source, target], [target, source]] as const) {
      const hiding = DataAssociationEnds.collapsedAround(end, other, (subProcess) => this.edit.expansionOf(subProcess) !== 'expanded');
      if (hiding) {
        throw BpmnError.model('E_INVALID_ENDPOINT', `${end.id} is inside the collapsed ${hiding.id}; its data association could not be drawn`, {
          element: end.id,
          related: [hiding.id, other.id],
          hint: `Connect ${other.id} to ${hiding.id} instead, or expand it first: \`bpmn set <file> ${hiding.id} expanded=true\`.`,
        });
      }
    }
  }
}
