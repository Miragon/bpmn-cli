import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { list, ref, str, type FieldsOf } from '../utils/field-specs.js';
import { BOUNDARY_SIDE_VALUES, SELECTOR_FIELDS } from '../utils/op-fields.js';
import { SELECTION_RULE, groupRules } from '../utils/schema-rules.js';
import type { PlaceShapes } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

/** place: at most one row key and one column key */
const PLACE_GROUPS = [
  ['rowOf', 'below', 'above'],
  ['columnOf', 'after', 'before'],
];

export class PlaceShapesDefinition extends EditCommandDefinition<PlaceShapes> {
  readonly name = 'place' as const;
  readonly description = 'Diagram only: move shapes (rigid group) to the row and/or column of another element (= `bpmn place`).';
  override readonly diagramOnly = true;
  readonly fields: FieldsOf<PlaceShapes> = {
    ids: list('Shapes moved as one rigid group; the first id is the reference that lands on the target row / column. Boundary events, labels and the content of an expanded sub-process follow.', { minItems: 1 }),
    ...SELECTOR_FIELDS,
    rowOf: ref('Row: centre the reference vertically on this element.'),
    below: ref('Row: put the reference one row below this element.'),
    above: ref('Row: put the reference one row above this element.'),
    columnOf: ref('Column: centre the reference horizontally on this element.'),
    after: ref('Column: put the reference one gap right of this element.'),
    before: ref('Column: put the reference one gap left of this element.'),
    side: str('A boundary event (the only id, no row or column): the border of its host it moves to; its outgoing flow is routed again, and its exception path follows when it was drawn on the old side.', { values: BOUNDARY_SIDE_VALUES }),
  };
  readonly referenceKeys = ['ids', 'path', 'via', 'branch', 'rowOf', 'below', 'above', 'columnOf', 'after', 'before'];

  override check(command: CommandFieldCheck): void {
    command.selection(true);
    if (command.fields['side'] !== undefined) {
      const with_ = PLACE_GROUPS.flat().filter((placeKey) => command.fields[placeKey] !== undefined);
      if (with_.length) throw command.fail(`"side" moves a boundary event to a border of its host; it cannot be combined with ${with_.map((placeKey) => `"${placeKey}"`).join(', ')}`, 'Example: {"op":"place","ids":["Event_Overdue"],"side":"top"}.');
      if (command.hasSelector() || (command.fields['ids'] as string[] | undefined)?.length !== 1) throw command.fail('"side" takes exactly one id (the boundary event)', 'Example: {"op":"place","ids":["Event_Overdue"],"side":"top"}.');
      return;
    }
    command.groups(PLACE_GROUPS, 'nothing to do: give a row ("rowOf", "below" or "above") and/or a column ("columnOf", "after" or "before"), or "side" for a boundary event');
  }

  override schemaRules(): unknown[] {
    return [SELECTION_RULE, ...groupRules(PLACE_GROUPS)];
  }
}
