import { ref, str, type FieldsOf } from '../utils/field-specs.js';
import { LABEL_SIDE_VALUES } from '../utils/op-fields.js';
import type { PlaceLabel } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class PlaceLabelDefinition extends EditCommandDefinition<PlaceLabel> {
  readonly name = 'label' as const;
  readonly description = 'Diagram only: put the external label of an event, gateway, data element or flow on one side (= `bpmn label`).';
  override readonly diagramOnly = true;
  readonly fields: FieldsOf<PlaceLabel> = {
    id: ref('Event, gateway, data object / store or flow with a name (external label).', { required: true }),
    side: str('Side of the element (flows: of the longest horizontal / vertical segment) the label goes to.', { required: true, values: LABEL_SIDE_VALUES }),
  };
  readonly referenceKeys = ['id'];
}
