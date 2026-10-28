import type { EditSession } from '../../document/EditSession.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import type { El } from '../../document/utils/moddle.js';
import { usageError } from '../../document/utils/errors.js';
import { type FlowAttrs, SequenceFlows } from './SequenceFlows.js';
import { defaultWithConditionViolation } from '../../commands/utils/op-rules.js';
import type { ConnectElements, FlowOptions as FlowOptionValues } from '../../commands/types.js';

const FLAGS: ReadonlyArray<readonly [keyof FlowOptionValues, string]> = [
  ['flowName', '--flow-name'],
  ['flowId', '--flow-id'],
  ['condition', '--condition'],
  ['language', '--language'],
  ['default', '--default'],
];

/** The options of the sequence flow an op creates or splices a node into. */
export class FlowOptions {
  constructor(private readonly values: FlowOptionValues) {}

  static of(source: FlowOptionValues): FlowOptionValues {
    const out: Record<string, unknown> = {};
    for (const [key] of FLAGS) if (source[key] !== undefined) out[key] = source[key];
    return out as FlowOptionValues;
  }

  get flags(): string[] {
    return FLAGS.filter(([key]) => this.values[key] !== undefined && this.values[key] !== false).map(([, flag]) => flag);
  }

  assertConsistent(details: { element?: string; related?: string[] } = {}): void {
    const violation = defaultWithConditionViolation(!!this.values.default, this.values.condition !== undefined, (field) => `--${field}`);
    if (violation) throw usageError(violation.message, { ...details, hint: violation.hint });
  }

  /** `keepEmptyCondition`: an empty condition stays, for SequenceFlows.create to refuse. */
  toAttrs(keepEmptyCondition = false): FlowAttrs {
    const { flowId, flowName, condition, language } = this.values;
    return {
      ...(flowId ? { id: flowId } : {}),
      ...(flowName ? { name: flowName } : {}),
      ...(condition || (keepEmptyCondition && condition !== undefined) ? { condition } : {}),
      ...(language ? { language } : {}),
      ...(this.values.default ? { isDefault: true } : {}),
    };
  }

  toConnect(): Pick<ConnectElements, 'id' | 'name' | 'condition' | 'language' | 'default'> {
    const { flowId, flowName, condition, language } = this.values;
    return {
      ...(flowId ? { id: flowId } : {}),
      ...(flowName ? { name: flowName } : {}),
      ...(condition !== undefined ? { condition } : {}),
      ...(language ? { language } : {}),
      ...(this.values.default ? { default: true } : {}),
    };
  }

  /** For an existing flow (the one into a spliced node); reported as changed when one was given. */
  apply(edit: EditSession, flow: El, changes: ChangeSet): void {
    let touched = false;
    if (this.values.flowName !== undefined) {
      flow.set('name', this.values.flowName || undefined);
      touched = true;
    }
    if (this.values.condition !== undefined) {
      new SequenceFlows(edit).setCondition(flow, this.values.condition, this.values.language);
      touched = true;
    }
    if (this.values.default) {
      new SequenceFlows(edit).setDefault(flow, true);
      touched = true;
    }
    if (touched) changes.change(ChangeSet.flowEntryOf(flow));
  }
}
