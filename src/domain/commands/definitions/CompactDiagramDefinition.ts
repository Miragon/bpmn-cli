import { list, type FieldsOf } from '../utils/field-specs.js';
import type { CompactDiagram } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class CompactDiagramDefinition extends EditCommandDefinition<CompactDiagram> {
  readonly name = 'compact' as const;
  readonly description = 'Diagram only: close empty rows and columns and shrink pools, lanes and expanded sub-processes to their content, keeping the order and relative positions; never adds a layout problem (= `bpmn compact`).';
  readonly fields: FieldsOf<CompactDiagram> = {
    ids: list('Only these frames (pools by participant id, lanes, expanded sub-processes) and what is inside them (default: the whole drawing).', { minItems: 1 }),
  };
  readonly referenceKeys = ['ids'];
}
