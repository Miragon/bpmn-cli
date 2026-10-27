import { ref, str, type FieldsOf } from '../utils/field-specs.js';
import { SIDE_VALUES } from '../utils/op-fields.js';
import type { RerouteFlow } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class RerouteFlowDefinition extends EditCommandDefinition<RerouteFlow> {
  readonly name = 'route' as const;
  readonly description = 'Diagram only: route one flow again, optionally forcing the exit / entry side (= `bpmn route`).';
  readonly fields: FieldsOf<RerouteFlow> = {
    id: ref('Sequence flow or message flow to route again.', { required: true }),
    exit: str('Side the flow leaves its source by (default: the conventions).', { values: SIDE_VALUES }),
    entry: str('Side the flow enters its target by (default: the conventions).', { values: SIDE_VALUES }),
  };
  readonly referenceKeys = ['id'];
}
