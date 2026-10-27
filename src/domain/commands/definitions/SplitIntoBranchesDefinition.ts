import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { alias, bool, ref, str, type FieldsOf } from '../utils/field-specs.js';
import type { SplitIntoBranches } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class SplitIntoBranchesDefinition extends EditCommandDefinition<SplitIntoBranches> {
  readonly name = 'split' as const;
  readonly description = 'Macro: split gateway + branches + join gateway in one step (apply only; there is no split command).';
  readonly fields: FieldsOf<SplitIntoBranches> = {
    after: ref("Anchor id: the split gateway is placed after it (spliced into its single outgoing flow, or appended).", { required: true }),
    kind: ref('Gateway kind (default exclusiveGateway).'),
    name: str('Name of the split gateway (exclusive gateways: a question, e.g. "Invoice ok?").'),
    id: ref('Explicit id of the split gateway.'),
    as: alias('Batch alias of the split gateway.'),
    join: bool('Create a joining gateway of the same kind and connect every branch end to it (default true). A branch ending in an end event terminates there; with only one branch that continues no join is created (it runs on to the old successor).'),
    joinId: ref("Explicit id of the join gateway (default <gatewayId>_join in the file's case; <gatewayId>Join under a declared camelCase / PascalCase)."),
    joinAs: alias('Batch alias of the join gateway.'),
    joinName: str('Name of the join gateway.'),
    branches: { type: 'branches', required: true, minItems: 1, description: 'Branches in top-to-bottom order.' },
  };
  readonly referenceKeys = ['after'];
  override readonly aliasKeyOfNewId = { id: 'as', joinId: 'joinAs' };

  override check(command: CommandFieldCheck): void {
    command.kind('gateway');
  }
}
