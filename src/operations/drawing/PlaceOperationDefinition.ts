import { FieldSets, FieldValues, OperationDefinition, OperationField, RefusalWording, type OperationCheck, type OperationOf } from '../fields/index.js';

export type PlaceOperation = OperationOf<PlaceOperationDefinition>;

export class PlaceOperationDefinition extends OperationDefinition {
  private static readonly TARGET_GROUPS = [
    ['rowOf', 'below', 'above'],
    ['columnOf', 'after', 'before'],
  ];
  private static readonly SIDE_EXAMPLE = RefusalWording.onlyInBatch('Example: {"op":"place","ids":["event_overdue"],"side":"top"}.');

  readonly name = 'place';
  readonly description = 'Diagram only: move shapes (rigid group) to the row and/or column of another element (= `bpmn place`).';
  readonly fields = {
    ids: OperationField.optional(FieldValues.references(1), 'Shapes moved as one rigid group; the first id is the reference that lands on the target row / column. Boundary events, labels and the content of an expanded sub-process follow.'),
    ...FieldSets.selectors,
    rowOf: OperationField.optional(FieldValues.reference, 'Row: centre the reference vertically on this element.'),
    below: OperationField.optional(FieldValues.reference, 'Row: put the reference one row below this element.'),
    above: OperationField.optional(FieldValues.reference, 'Row: put the reference one row above this element.'),
    columnOf: OperationField.optional(FieldValues.reference, 'Column: centre the reference horizontally on this element.'),
    after: OperationField.optional(FieldValues.reference, 'Column: put the reference one gap right of this element.'),
    before: OperationField.optional(FieldValues.reference, 'Column: put the reference one gap left of this element.'),
    side: OperationField.optional(FieldValues.choice(['top', 'bottom']), 'A boundary event (the only id, no row or column): the border of its host it moves to; its outgoing flow is routed again, and its exception path follows when it was drawn on the old side.'),
  };
  override readonly referenceKeys = ['ids', 'path', 'branch', 'rowOf', 'below', 'above', 'columnOf', 'after', 'before'];
  override readonly schemaRules = [
    FieldSets.selectionRule,
    ...[['rowOf', 'below'], ['rowOf', 'above'], ['below', 'above'], ['columnOf', 'after'], ['columnOf', 'before'], ['after', 'before']].map((pair) => ({ not: { required: pair } })),
    { anyOf: [...PlaceOperationDefinition.TARGET_GROUPS.flat(), 'side'].map((key) => ({ required: [key] })) },
  ];

  protected override check(operation: OperationCheck): void {
    operation.selection();
    if (operation.fields['side'] !== undefined) {
      this.checkSide(operation);
      return;
    }
    operation.groups(PlaceOperationDefinition.TARGET_GROUPS, (key) => `nothing to do: give a row (${key('rowOf')}, ${key('below')} or ${key('above')}) and/or a column (${key('columnOf')}, ${key('after')} or ${key('before')}), or ${key('side')} for a boundary event`);
  }

  private checkSide(operation: OperationCheck): void {
    const targets = operation.present(PlaceOperationDefinition.TARGET_GROUPS.flat());
    if (targets.length) {
      throw operation.fail((key) => `${key('side')} moves a boundary event to a border of its host; it cannot be combined with ${targets.map(key).join(', ')}`, PlaceOperationDefinition.SIDE_EXAMPLE);
    }
    if (operation.hasSelector() || (operation.fields['ids'] as string[] | undefined)?.length !== 1) {
      throw operation.fail((key) => `${key('side')} takes exactly one id (the boundary event)`, PlaceOperationDefinition.SIDE_EXAMPLE);
    }
  }
}
