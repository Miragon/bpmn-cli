import { FLOW_NODE_FAMILIES, type Family } from '../../document/utils/kinds.js';
import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { alias, bool, ref, type FieldsOf } from '../utils/field-specs.js';
import { FLOW_FIELDS, NODE_FIELDS, PLACEMENT_FIELDS, TRIGGER_FIELDS } from '../utils/op-fields.js';
import { placementRules, defaultRule } from '../utils/schema-rules.js';
import type { AddElement } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class AddElementDefinition extends EditCommandDefinition<AddElement> {
  readonly name = 'add' as const;
  readonly description = 'Create one element and wire it in (= `bpmn add`).';
  readonly fields: FieldsOf<AddElement> = {
    kind: NODE_FIELDS.kind,
    name: NODE_FIELDS.name,
    id: NODE_FIELDS.id,
    as: NODE_FIELDS.as,
    flowAs: NODE_FIELDS.flowAs,
    outAs: alias('Batch alias of the flow the add creates out of the new node (a splice: to the old successor; a prepend: to the anchor; else to `to`); E_USAGE when it creates none or two.'),
    refAs: NODE_FIELDS.refAs,
    ...PLACEMENT_FIELDS,
    to: ref('Also connect the new node to this target (a branch that re-joins).'),
    lane: NODE_FIELDS.lane,
    ...FLOW_FIELDS,
    ...TRIGGER_FIELDS,
    collapsed: NODE_FIELDS.collapsed,
    ifAbsent: bool('With an explicit id: succeed without changes when the element already exists.'),
    doc: NODE_FIELDS.doc,
    set: NODE_FIELDS.set,
    process: NODE_FIELDS.process,
    blackBox: NODE_FIELDS.blackBox,
    text: NODE_FIELDS.text,
    members: NODE_FIELDS.members,
  };
  readonly referenceKeys = ['after', 'before', 'flow', 'in', 'on', 'to', 'lane', 'process', 'members'];
  override readonly aliasKeyOfNewId = { id: 'as', flowId: 'flowAs' };
  override readonly propertyMapKey = 'set';

  override check(command: CommandFieldCheck): void {
    this.checkOutAs(command, command.kind());
    command.placement();
    command.flowOptions(true);
    if (command.fields['ifAbsent'] === true && command.fields['id'] === undefined) throw command.fail('"ifAbsent" needs an explicit "id" to check for', 'Add "id": "<Prefix>_<Name>" or drop ifAbsent.');
  }

  override schemaRules(): unknown[] {
    return [...placementRules(), defaultRule(), { if: { required: ['ifAbsent'], properties: { ifAbsent: { const: true } } }, then: { required: ['id'] } }];
  }

  /** Refused up front where neither the kind nor the keys create a flow out of the new node. */
  private checkOutAs(command: CommandFieldCheck, family: Family | undefined): void {
    const out = command.fields;
    if (out['outAs'] === undefined) return;
    if (family && !FLOW_NODE_FAMILIES.has(family)) {
      throw command.fail(`"outAs": add ${out['kind']} creates no sequence flow out of it`, 'Drop "outAs"; name a connection with a connect op that has "as".');
    }
    if (out['after'] === undefined && out['before'] === undefined && out['flow'] === undefined && out['to'] === undefined) {
      throw command.fail('"outAs" names the flow out of the node and needs "after", "before", "flow" or "to"', 'With "in" or "on" alone no sequence flow leaves the node; give "to", or connect the node with a connect op that has "as".');
    }
  }
}
